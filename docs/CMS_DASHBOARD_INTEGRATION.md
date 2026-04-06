# CMS Dashboard Integration Guide

Reference documentation for building the client CMS dashboard frontend. Covers auth flow, API contract, roles, and data shapes.

---

## Table of Contents

1. [Authentication Flow](#authentication-flow)
2. [Roles & Permissions](#roles--permissions)
3. [Auth State on the Frontend](#auth-state-on-the-frontend)
4. [API Endpoints](#api-endpoints)
5. [Data Shapes](#data-shapes)
6. [Template Field Types](#template-field-types)
7. [Content Validation Rules](#content-validation-rules)
8. [Error Response Format](#error-response-format)
9. [Typical UI Flows](#typical-ui-flows)

---

## Authentication Flow

### How It Works

The server uses **Supabase Auth with Google OAuth**. The frontend handles the sign-in flow via the Supabase client SDK. The server never initiates auth — it only verifies tokens.

```
1. User clicks "Sign in with Google" on the dashboard
2. Supabase client SDK handles Google OAuth redirect
3. On success, Supabase SDK stores a session with an access_token (JWT)
4. Every API call to the server includes:
       Authorization: Bearer <access_token>
5. Server verifies the JWT locally (no round-trip to Supabase)
6. Server extracts user identity (uid + email) from the token
7. Server looks up the user's role in `client_users` table
```

### First-Login Linking

When a PVS admin invites a client user, only their **email** is stored. The user doesn't exist in Supabase Auth yet.

```
1. PVS admin invites client@example.com with role "editor" for Client X
2. A `client_users` row is created: { email: "client@example.com", auth_uid: null, role: "editor", client_id: "..." }
3. Client signs in with Google (using client@example.com)
4. On their first authenticated API call, the server:
   a. Verifies the JWT
   b. Sees no `client_users` row matching this auth_uid
   c. Looks up by email instead
   d. Finds the pre-created row, populates auth_uid
   e. From now on, lookup is by auth_uid (fast)
```

**Frontend implication:** After first Google sign-in, call `GET /api/cms/me` to confirm the user has access. If the response is empty (no assignments), show an "access denied" or "contact your admin" screen.

### Token Refresh

Supabase client SDK handles token refresh automatically. The access token is short-lived (~1 hour). The SDK refreshes it using the refresh token before expiry. No special handling needed on API calls — just always use `supabase.auth.getSession()` to get the current token before each request.

### Sign Out

Call `supabase.auth.signOut()` on the frontend. No server endpoint needed.

---

## Roles & Permissions

### Role Hierarchy

| Role | Scope | Can View | Can Edit | Can Manage Templates | Can Manage Users |
|------|-------|----------|----------|---------------------|-----------------|
| **PVS Admin** | All clients | Yes | Yes | Yes | Yes |
| **Editor** | Assigned client only | Yes | Yes | No | No |
| **Viewer** | Assigned client only | Yes | No | No | No |

### PVS Admin

- `is_pvs_admin: true` in `client_users`
- Has **no client_id** — access is global across all clients
- Can create/edit/delete templates for any client
- Can invite/manage users for any client
- Can create/edit/publish/delete pages for any client
- Phil and Sami are the initial PVS admins

### Editor

- `role: "editor"` with a specific `client_id`
- Can view templates for their client
- Can create, edit, publish, and delete pages for their client
- Cannot modify templates or manage users
- A user can be an editor for multiple clients (separate `client_users` rows)

### Viewer

- `role: "viewer"` with a specific `client_id`
- Can view templates and pages for their client
- Cannot create, edit, or delete anything
- Useful for clients who want visibility but PVS manages content

### How to Check Roles on the Frontend

Call `GET /api/cms/me` after login. The response tells you everything:

```json
{
  "user": {
    "uid": "auth-uid",
    "email": "phil@pixelversestudios.io"
  },
  "is_pvs_admin": true,
  "assignments": [
    {
      "id": "client-user-row-id",
      "client_id": "client-uuid",
      "role": "editor",
      "client": {
        "id": "client-uuid",
        "firstname": "John",
        "lastname": "Doe",
        "company_name": "Acme Corp"
      }
    }
  ]
}
```

**Frontend logic:**
- If `is_pvs_admin: true` → show admin dashboard (all clients, template management, user management)
- If `assignments` has entries → show client dashboard scoped to those clients
- If `is_pvs_admin: false` and `assignments` is empty → show "no access" screen
- If a user has multiple assignments → show a client picker

---

## Auth State on the Frontend

### Recommended Auth Context Shape

```
AuthContext:
  session: Supabase session (contains access_token)
  user: { uid, email }
  isPvsAdmin: boolean
  assignments: array of { client_id, role, client }
  activeClient: { client_id, role } | null   (selected client for the current view)
  isLoading: boolean
```

### Request Helper Pattern

Every authenticated API call should:
1. Get the current session from Supabase SDK
2. Extract the access_token
3. Include it as `Authorization: Bearer <token>`
4. Handle 401 (token expired/invalid) → redirect to login
5. Handle 403 (insufficient permissions) → show "not authorized" message

---

## API Endpoints

### Identity

#### `GET /api/cms/me`
**Auth:** Required
**Purpose:** Get current user's identity, admin status, and client assignments

**Response 200:**
```json
{
  "user": { "uid": "uuid", "email": "user@example.com" },
  "is_pvs_admin": false,
  "assignments": [
    {
      "id": "uuid",
      "client_id": "uuid",
      "role": "editor",
      "client": {
        "id": "uuid",
        "firstname": "John",
        "lastname": "Doe",
        "company_name": "Acme Corp"
      }
    }
  ]
}
```

---

### User Management (PVS Admin Only)

#### `GET /api/cms/clients/:clientId/users`
**Auth:** PVS Admin
**Purpose:** List all users assigned to a client

**Response 200:**
```json
[
  {
    "id": "uuid",
    "auth_uid": "uuid | null",
    "email": "user@example.com",
    "display_name": "Jane Smith",
    "role": "editor",
    "active": true,
    "last_login": "2026-04-06T...",
    "invited_at": "2026-04-01T..."
  }
]
```

#### `POST /api/cms/clients/:clientId/users`
**Auth:** PVS Admin
**Purpose:** Invite a user to a client's CMS

**Request Body:**
```json
{
  "email": "client@example.com",
  "role": "editor",
  "display_name": "Jane Smith"
}
```

**Response 201:** Created user row
**Response 409:** Email already assigned to this client

#### `PATCH /api/cms/users/:id`
**Auth:** PVS Admin
**Purpose:** Update a user's role

**Request Body:**
```json
{
  "role": "viewer"
}
```

**Response 200:** Updated user row

#### `DELETE /api/cms/users/:id`
**Auth:** PVS Admin
**Purpose:** Remove a user's CMS access

**Response 200:** Success

---

### Templates (PVS Admin manages, all roles can read)

#### `GET /api/cms/clients/:clientId/templates`
**Auth:** Any role with access to this client
**Purpose:** List all templates for a client

**Response 200:**
```json
[
  {
    "id": "uuid",
    "client_id": "uuid",
    "slug": "homepage",
    "label": "Home Page",
    "description": "Main landing page content",
    "fields": [ ... ],
    "version": 3,
    "active": true,
    "created_at": "2026-04-01T..."
  }
]
```

#### `GET /api/cms/templates/:id`
**Auth:** Any role with access to the template's client
**Purpose:** Get a single template with full field definitions

**Response 200:** Single template object (same shape as above)

#### `POST /api/cms/clients/:clientId/templates`
**Auth:** PVS Admin only
**Purpose:** Create a new template

**Request Body:**
```json
{
  "slug": "homepage",
  "label": "Home Page",
  "description": "Main landing page sections",
  "fields": [
    {
      "key": "hero_title",
      "label": "Hero Title",
      "type": "text",
      "required": true,
      "max_length": 120,
      "description": "Main headline on the hero section"
    },
    {
      "key": "hero_image",
      "label": "Hero Background Image",
      "type": "image",
      "required": true
    },
    {
      "key": "show_cta",
      "label": "Show Call-to-Action Button",
      "type": "boolean",
      "required": false,
      "default": true
    }
  ]
}
```

**Response 201:** Created template
**Response 409:** Slug already exists for this client

#### `PATCH /api/cms/templates/:id`
**Auth:** PVS Admin only
**Purpose:** Update template fields/metadata. Auto-increments `version`.

**Request Body:** Partial — any combination of `slug`, `label`, `description`, `fields`, `active`

**Response 200:** Updated template with new version number

#### `DELETE /api/cms/templates/:id`
**Auth:** PVS Admin only
**Purpose:** Delete a template

**Response 200:** Success
**Response 409:** Cannot delete — pages still reference this template

---

### Pages (Editors can write, Viewers can read)

#### `GET /api/cms/clients/:clientId/pages`
**Auth:** Any role with access to this client
**Purpose:** List all pages for a client

**Query Params:**
- `status` (optional): `draft`, `published`, `archived` — filter by status

**Response 200:**
```json
[
  {
    "id": "uuid",
    "client_id": "uuid",
    "template_id": "uuid",
    "slug": "homepage",
    "content": { "hero_title": "Welcome to Acme", "hero_image": "https://...", "show_cta": true },
    "status": "published",
    "template_version": 3,
    "published_at": "2026-04-05T...",
    "published_by": "uuid",
    "last_edited_by": "uuid",
    "created_at": "2026-04-01T...",
    "updated_at": "2026-04-05T...",
    "template": {
      "slug": "homepage",
      "label": "Home Page",
      "fields": [ ... ]
    }
  }
]
```

#### `GET /api/cms/pages/:id`
**Auth:** Any role with access to this page's client
**Purpose:** Get a single page with its template

**Response 200:** Single page object (same shape as list item above)

#### `POST /api/cms/clients/:clientId/pages`
**Auth:** Editor or Admin
**Purpose:** Create a new page

**Request Body:**
```json
{
  "template_id": "uuid",
  "slug": "homepage",
  "content": {
    "hero_title": "Welcome to Acme",
    "hero_image": "https://cdn.example.com/hero.jpg",
    "show_cta": true
  },
  "status": "draft"
}
```

**Response 201:** Created page
**Response 400:** Content validation failed (see [Content Validation Rules](#content-validation-rules))
**Response 409:** Slug already exists for this client

#### `PATCH /api/cms/pages/:id`
**Auth:** Editor or Admin
**Purpose:** Update page content or metadata

**Request Body:** Partial — any combination of `content`, `slug`, `status`

**Response 200:** Updated page
**Response 400:** Content validation failed

#### `POST /api/cms/pages/:id/publish`
**Auth:** Editor or Admin
**Purpose:** Publish a page (sets status to published, records who published and when)

**Response 200:**
```json
{
  "id": "uuid",
  "status": "published",
  "published_at": "2026-04-06T...",
  "published_by": "auth-uid"
}
```

#### `DELETE /api/cms/pages/:id`
**Auth:** Editor or Admin
**Purpose:** Delete a page

**Response 200:** Success

---

### Public Endpoint (No Auth)

#### `GET /api/cms/clients/:clientId/pages/:slug/published`
**Auth:** None
**Purpose:** Fetch published page content for client websites to consume

**Response 200:**
```json
{
  "id": "uuid",
  "slug": "homepage",
  "content": { "hero_title": "Welcome to Acme", ... },
  "template": {
    "slug": "homepage",
    "label": "Home Page",
    "fields": [ ... ]
  },
  "published_at": "2026-04-06T...",
  "updated_at": "2026-04-06T..."
}
```

**Response 404:** Page not found or not published

---

## Data Shapes

### Client User

```
{
  id:            UUID
  auth_uid:      UUID | null       -- null until first login
  client_id:     UUID | null       -- null for PVS admins
  email:         string
  display_name:  string | null
  role:          "admin" | "editor" | "viewer"
  is_pvs_admin:  boolean
  active:        boolean
  last_login:    ISO timestamp | null
  invited_at:    ISO timestamp
  invited_by:    UUID | null
}
```

### CMS Template

```
{
  id:            UUID
  client_id:     UUID
  slug:          string            -- lowercase, alphanumeric + hyphens (e.g., "homepage")
  label:         string            -- display name (e.g., "Home Page")
  description:   string | null
  fields:        FieldDefinition[] -- see below
  version:       integer           -- auto-increments on update
  active:        boolean
  created_by:    UUID | null
  created_at:    ISO timestamp
  updated_at:    ISO timestamp
}
```

### CMS Page

```
{
  id:                UUID
  client_id:         UUID
  template_id:       UUID
  slug:              string
  content:           object         -- key-value pairs matching template fields
  status:            "draft" | "published" | "archived"
  template_version:  integer        -- which template version this was authored against
  published_at:      ISO timestamp | null
  published_by:      UUID | null
  last_edited_by:    UUID | null
  created_at:        ISO timestamp
  updated_at:        ISO timestamp
}
```

### Field Definition (inside template.fields array)

```
{
  key:           string            -- unique within template, used as content key
  label:         string            -- display label for the form field
  type:          FieldType         -- see "Template Field Types" below
  required:      boolean           -- whether this field must have a value
  default:       any | undefined   -- default value if not provided
  description:   string | undefined -- help text shown below the field
  max_length:    number | undefined -- for text/richtext
  min:           number | undefined -- for number
  max:           number | undefined -- for number
  options:       string[] | undefined -- for select type
}
```

---

## Template Field Types

These are the field types PVS admins can use when defining a template. Each maps to a specific input in the dashboard:

| Type | Content Value | Dashboard Input |
|------|--------------|-----------------|
| `text` | string | Single-line text input. Respects `max_length`. |
| `richtext` | string (HTML) | Rich text editor (Tiptap, Slate, etc.). Respects `max_length`. |
| `image` | string (URL) | Image URL input or upload widget. Must be a valid URL. |
| `number` | number | Number input. Respects `min` and `max`. |
| `boolean` | boolean | Toggle/checkbox. |
| `select` | string | Dropdown. Options defined in `field.options` array. |
| `array` | any[] | Repeatable list of items. |
| `json` | any | Raw JSON editor (for advanced/structured data). |

### Dynamic Form Rendering

The dashboard should **dynamically render edit forms** from the template's `fields` array:

```
For each field in template.fields:
  1. Read field.type to determine which input component to render
  2. Use field.label as the form label
  3. Use field.description as help text
  4. Use field.key as the form field name (maps to content[key])
  5. Apply field.required for validation
  6. Apply field.default as the initial value on new pages
  7. Apply type-specific constraints (max_length, min, max, options)
```

This means the dashboard does NOT need to know what each client's content looks like at build time. It reads the template and builds the form at runtime.

---

## Content Validation Rules

When creating or updating a page, the server validates `content` against the template's `fields`:

| Rule | HTTP Response |
|------|--------------|
| Required field missing or empty | 400 with field-level error |
| Key in content not defined in template | 400 "unknown field" |
| Wrong type (e.g., string where number expected) | 400 with field-level error |
| `text`/`richtext` exceeds `max_length` | 400 with field-level error |
| `number` outside `min`/`max` range | 400 with field-level error |
| `select` value not in `options` array | 400 with field-level error |
| `image` is not a valid URL | 400 with field-level error |

### Error Response Shape for Validation Failures

```json
{
  "error": "Content validation failed",
  "details": {
    "fieldErrors": {
      "hero_title": ["Required"],
      "hero_image": ["Must be a valid URL"],
      "budget_amount": ["Must be between 0 and 100000"]
    }
  }
}
```

The frontend can map `fieldErrors` keys directly to form field names (they match `field.key`).

---

## Error Response Format

All error responses follow this shape:

| Status | Meaning | Body Shape |
|--------|---------|------------|
| 400 | Validation error | `{ error: string, details?: object, errors?: array }` |
| 401 | Not authenticated | `{ error: "Unauthorized" }` |
| 403 | Insufficient permissions | `{ error: "Forbidden" }` |
| 404 | Resource not found | `{ error: "Not found" }` |
| 409 | Conflict (duplicate) | `{ error: string, message: string }` |
| 500 | Server error | `{ error: "Internal server error" }` |

---

## Typical UI Flows

### Flow 1: PVS Admin Sets Up a Client's CMS

```
1. Admin navigates to a client in the dashboard
2. Admin goes to "CMS Templates" section
3. Admin creates a template:
   - Picks a slug (e.g., "homepage")
   - Adds field definitions (hero_title: text, hero_image: image, etc.)
   - Saves → POST /api/cms/clients/:clientId/templates
4. Admin creates a page using that template:
   - Selects template from dropdown
   - Form renders dynamically based on template fields
   - Fills in content
   - Saves as draft → POST /api/cms/clients/:clientId/pages
5. Admin previews and publishes:
   - Reviews content
   - Publishes → POST /api/cms/pages/:id/publish
6. Admin invites the client:
   - Enters client's email and role
   - Saves → POST /api/cms/clients/:clientId/users
```

### Flow 2: Client Edits Their Content

```
1. Client visits dashboard, clicks "Sign in with Google"
2. Supabase handles OAuth, returns session
3. Dashboard calls GET /api/cms/me
4. Response shows client has "editor" role for one client
5. Dashboard loads that client's pages → GET /api/cms/clients/:clientId/pages
6. Client selects a page to edit
7. Dashboard loads the page → GET /api/cms/pages/:id
8. Dashboard reads page.template.fields and renders the edit form
9. Client modifies content, saves → PATCH /api/cms/pages/:id
10. Client publishes → POST /api/cms/pages/:id/publish
```

### Flow 3: Client Website Consumes CMS Content

```
1. Client website (Next.js, Gatsby, etc.) fetches content at build time or on request
2. Calls GET /api/cms/clients/:clientId/pages/homepage/published
3. No auth needed — this is a public endpoint
4. Response includes content + template field metadata
5. Website renders the content
```

### Flow 4: PVS Admin Manages Users

```
1. Admin navigates to client's user management
2. Sees list of assigned users → GET /api/cms/clients/:clientId/users
3. Can see who has logged in (last_login) vs. who is still pending (auth_uid: null)
4. Can change roles → PATCH /api/cms/users/:id
5. Can revoke access → DELETE /api/cms/users/:id
```

### Flow 5: Template Version Drift

```
1. Admin updates a template (adds a new required field)
2. Template version increments from 3 to 4
3. Existing pages still have template_version: 3
4. Dashboard can detect drift: page.template_version < template.version
5. Dashboard shows a warning: "This page was created with an older template version"
6. Editor opens the page, sees the new field is empty
7. Editor fills in the new field, saves → content now valid against v4
8. Server updates template_version to 4 on save
```

---

## Dashboard Page Structure (Suggested)

### PVS Admin Views

- **Client List** — all clients, with indicator of which have CMS enabled
- **Client Detail > CMS Templates** — list/create/edit templates for a client
- **Client Detail > CMS Pages** — list/create/edit/publish pages for a client
- **Client Detail > CMS Users** — invite/manage users for a client

### Client User Views

- **My Pages** — list of pages for their assigned client(s)
- **Page Editor** — dynamic form rendered from template fields
- **Page Preview** — view published content

### Shared Components

- **Dynamic Form Renderer** — reads `template.fields`, renders appropriate inputs
- **Status Badge** — draft (gray), published (green), archived (muted)
- **Version Drift Warning** — shown when `page.template_version < template.version`
- **Role Badge** — admin (red), editor (blue), viewer (gray)
- **Pending Invite Indicator** — shown when `auth_uid` is null (user hasn't logged in yet)
