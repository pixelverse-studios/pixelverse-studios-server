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

| Role | Scope | Can View | Can Edit Pages | Can Manage Templates | Can Manage Users |
|------|-------|----------|----------------|---------------------|-----------------|
| **PVS Admin** | All clients | Yes | Yes | Yes | Yes |
| **Editor** | Assigned client only | Yes | Yes | No | No |
| **Viewer** | Assigned client only | Yes | No | No | No |

### PVS Admin

- `is_pvs_admin: true` in `client_users`, with `role: "admin"` and `client_id: null`
- Access is global across all clients
- Can create/edit/delete templates for any client
- Can invite/manage users for any client
- Can create/edit/publish/delete pages for any client
- Phil and Sami are the initial PVS admins

### Editor

- `role: "editor"` with a specific `client_id`, `is_pvs_admin: false`
- Can view templates for their client
- Can create, edit, publish, and delete pages for their client
- Cannot modify templates or manage users
- A user can be an editor for multiple clients (separate `client_users` rows)

### Viewer

- `role: "viewer"` with a specific `client_id`, `is_pvs_admin: false`
- Can view templates and pages for their client
- Cannot create, edit, or delete anything
- Useful for clients who want visibility but PVS manages content

### Note on the `admin` Role Value

The `role` enum includes `"admin"`, but it is **reserved exclusively for PVS admin rows** (paired with `is_pvs_admin: true`). Client-scoped users will only ever have `role: "editor"` or `role: "viewer"`. The database enforces this via a CHECK constraint: `NOT is_pvs_admin OR role = 'admin'`.

The frontend can simplify role display logic:
- If `is_pvs_admin: true` → "PVS Admin" badge
- Otherwise, use `role` directly (`editor` or `viewer`)

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
      },
      "websites": [
        {
          "id": "website-uuid",
          "title": "Acme Portfolio",
          "domain": "acme.com"
        }
      ]
    }
  ]
}
```

**Frontend logic:**
- If `is_pvs_admin: true` → show admin dashboard (all clients, template management, user management)
- If `assignments` has entries → show client dashboard scoped to those clients
- If `is_pvs_admin: false` and `assignments` is empty → show "no access" screen
- If a user has multiple assignments → show a client picker
- The `websites` array on each assignment is the source of truth for `:websiteId` parameters used by the upload endpoints — if the user has access to a client, they have access to all of that client's websites

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
**Purpose:** Get current user's identity, admin status, client assignments, and accessible websites

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
      },
      "websites": [
        {
          "id": "uuid",
          "title": "Acme Portfolio",
          "domain": "acme.com"
        }
      ]
    }
  ]
}
```

**Note:** `assignments[].websites` is the list of websites the user can manage CMS content for. Use these `id` values as the `:websiteId` parameter on the R2 upload endpoints. PVS admins receive a top-level `assignments` array containing all clients and their websites.

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
    },
    {
      "key": "cta_style",
      "label": "CTA Button Style",
      "type": "select",
      "required": false,
      "options": ["primary", "secondary", "ghost"],
      "default": "primary"
    },
    {
      "key": "max_features",
      "label": "Max Features to Show",
      "type": "number",
      "required": false,
      "min": 1,
      "max": 12,
      "default": 6
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

**Response 200:** Full updated page object (same shape as `GET /api/cms/pages/:id`), with `status: "published"`, `published_at` set, and `published_by` set to the current user's auth_uid.

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
  role:          "admin" | "editor" | "viewer"   -- "admin" only valid when is_pvs_admin = true
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
  config:        object | undefined  -- type-specific config (currently only image_gallery; see Image Gallery Field section)
}
```

### Image Item (inside image_gallery groups)

```
{
  src:           string            -- public URL of the image (returned from R2 presign)
  alt:           string | undefined -- accessibility text, optional
  aspect_ratio:  string | undefined -- free-form metadata set on upload (e.g., "portrait", "landscape", "square")
  r2_key:        string | undefined -- R2 object key, used for delete operations
  sort_order:    number            -- position within the group
}
```

Note: the standalone `image` field type stores just a string URL in content (e.g., `"hero_image": "https://..."`). Only `image_gallery` items use this richer object structure.

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
| `image_gallery` | `{ groups: ImageGroup[] }` | Grouped image grid with drag-drop, upload, reorder, alt-text editing. See [Image Gallery Field](#image-gallery-field). |

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

## Image Gallery Field

The `image_gallery` field is a first-class type for grouped image collections (portfolios, event galleries, product catalogs).

### Field Definition

The `image_gallery` field uses the standard `FieldDefinition` shape with a type-specific `config` object:

```json
{
  "key": "gallery_images",
  "label": "Portfolio Gallery",
  "type": "image_gallery",
  "required": false,
  "description": "Drag to reorder. Organize by sub-category.",
  "config": {
    "max_images": 200,
    "allowed_types": ["image/jpeg", "image/png", "image/webp"],
    "sub_categories": true
  }
}
```

**`config` properties (image_gallery only):**

| Key | Type | Notes |
|-----|------|-------|
| `max_images` | number | Total cap across all groups |
| `allowed_types` | string[] | MIME types accepted on upload |
| `sub_categories` | boolean | If true, the dashboard renders grouped sections; if false, a single flat group |

### Content Value Shape

```json
{
  "gallery_images": {
    "groups": [
      {
        "name": "Baby Shower",
        "slug": "baby-shower",
        "sort_order": 0,
        "images": [
          {
            "src": "https://pub-....r2.dev/<website-id>/events/baby-shower/1712345678-baby-shower-01.jpg",
            "alt": "Mother-to-be opening gifts",
            "aspect_ratio": "portrait",
            "r2_key": "<website-id>/events/baby-shower/1712345678-baby-shower-01.jpg",
            "sort_order": 0
          }
        ]
      },
      {
        "name": "Bridal Shower",
        "slug": "bridal-shower",
        "sort_order": 1,
        "images": [ ... ]
      }
    ]
  }
}
```

### Validation Rules

| Rule | Error |
|------|-------|
| Total images across all groups exceeds `config.max_images` | 400 "Exceeds maximum of {max_images} images" |
| Image `src` is missing or not a valid URL | 400 field-level error |
| Group missing `name` or `slug` | 400 field-level error |
| Group `slug` not lowercase/safe chars | 400 field-level error |

`aspect_ratio` and `alt` are optional metadata — set by the dashboard on upload, no enum validation.

### Dashboard Rendering

- Collapsible sub-category sections
- Drag-drop image grid per section
- Upload button per section (auto-assigns folder based on group slug)
- Drag to reorder within a group, move images between groups
- Inline alt-text editing
- Aspect ratio auto-detected on upload

---

## Image Uploads (R2 Presigned URLs)

Image uploads bypass the server entirely. The dashboard requests a presigned URL, then uploads directly to R2.

### Upload Flow

```
1. Dashboard calls POST /api/cms/websites/:websiteId/upload/presign
2. Server returns { presigned_url, public_url, r2_key, expires_in }
3. Dashboard PUTs the file directly to presigned_url with the correct Content-Type header
4. Dashboard stores public_url as the value in the CMS content field
```

### `POST /api/cms/websites/:websiteId/upload/presign`
**Auth:** Editor or Admin for the website's client

**Request Body:**
```json
{
  "filename": "baby-shower-15.jpg",
  "content_type": "image/jpeg",
  "folder": "events/baby-shower"
}
```

**Response 201:**
```json
{
  "presigned_url": "https://<account>.r2.cloudflarestorage.com/...",
  "public_url": "https://pub-....r2.dev/<website-id>/events/baby-shower/1712345678-baby-shower-15.jpg",
  "r2_key": "<website-id>/events/baby-shower/1712345678-baby-shower-15.jpg",
  "expires_in": 900
}
```

**Notes:**
- Allowed content types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- `folder` must be lowercase, alphanumeric + hyphens + slashes (e.g., `events/baby-shower`); no leading/trailing slash
- Presigned URL expires in 15 minutes
- Filenames are sanitized server-side to prevent unsafe characters
- **Final r2_key structure:** `<website-id>/<folder>/<timestamp>-<sanitized-filename>` — the website ID is always automatically prefixed by the server (the dashboard does not include it), the timestamp prevents collisions, and the folder comes from the request body
- **Permission check:** the server resolves the website's `client_id` and verifies the caller has `editor` or `admin` access to that client. Frontend can preflight by checking `assignments[].websites` from `/api/cms/me`

### `DELETE /api/cms/websites/:websiteId/upload`
**Auth:** Editor or Admin for the website's client

**Request Body:**
```json
{
  "r2_key": "<website-id>/events/baby-shower/1712345678-baby-shower-15.jpg"
}
```

**Response 200:** Success
**Response 403:** `r2_key` does not start with this website's ID (cross-tenant prevention)

---

## Hostname Resolution & White-Labeled Dashboard

The dashboard supports custom per-website domains (e.g., `dashboard.ifferspictures.com`). On initial load, the dashboard resolves the current hostname to a website + branding before login.

### `GET /api/cms/resolve-hostname?hostname=dashboard.ifferspictures.com`
**Auth:** None (public)

**Response 200:**
```json
{
  "website_id": "uuid",
  "website_title": "Iffer's Pictures Portfolio",
  "client": {
    "id": "uuid",
    "company_name": "Iffer's Pictures"
  },
  "branding": {
    "logo_url": "https://...",
    "favicon_url": "https://...",
    "primary_color": "#1a9b8e",
    "secondary_color": "#...",
    "accent_color": "#...",
    "font_family": "Inter",
    "heading_font_family": "Playfair Display"
  },
  "purpose": "dashboard"
}
```

**Response 404:** Hostname not recognized

**Caching:** Response is cached for 5 minutes (`Cache-Control: public, max-age=300`).

**`purpose` values:**

| Value | Meaning |
|-------|---------|
| `dashboard` | The hostname serves the CMS dashboard UI (e.g., `dashboard.ifferspictures.com`) |
| `production` | The hostname serves the live client website (e.g., `ifferspictures.com`) |
| `staging` | A staging/preview environment for the website |
| `preview` | An ephemeral preview deployment (PR previews, etc.) |

The dashboard frontend should expect `purpose: "dashboard"` for normal access. Other values exist so the same `website_domains` table can be reused for non-CMS hostname tracking.

### Frontend Flow

```
1. Dashboard loads at https://dashboard.ifferspictures.com
2. Calls GET /api/cms/resolve-hostname?hostname=dashboard.ifferspictures.com
3. If 200: apply branding (logo, colors, fonts) to the entire UI before login
4. If 404: fall back to default PVS branding
5. After login, the resolved website_id scopes the user's CMS access
```

### Branding Object

| Field | Type | Notes |
|-------|------|-------|
| `logo_url` | string | Header logo |
| `favicon_url` | string | Browser tab icon |
| `primary_color` | string (hex) | Main brand color |
| `secondary_color` | string (hex) | Secondary brand color |
| `accent_color` | string (hex) | Accent for buttons, highlights |
| `font_family` | string | Body font |
| `heading_font_family` | string | Heading font |

If a website has no `branding` set, the response uses PVS default theme values.

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
