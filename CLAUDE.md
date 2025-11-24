# CLAUDE.md - Pixelverse Studios Server

## Project Overview

**Pixelverse Studios Server** is a TypeScript Express.js REST API that manages client data, CMS content, contact forms, newsletter subscriptions, lead intake, audit requests, and website deployment tracking. The backend uses Supabase (PostgreSQL) and integrates with Gmail, Resend, and Discord for notifications.

**Architecture:** Layered MVC-inspired pattern with clear separation between routes, controllers, and services.

---

## ⚠️ CRITICAL: Testing Protocol for Claude Code

**NEVER test on port 5001** - The production server is always running on this port.

When testing code changes:
1. Change `.env` PORT to a test port (5002, 5003, etc.)
2. Start your test server on the test port
3. Run your tests
4. **ALWAYS kill the test server when done**
5. Restore `.env` PORT back to 5001

See [Testing for Claude Code Agents](#testing-for-claude-code-agents) for detailed instructions.

---

## Quick Reference

### Tech Stack
- **Runtime:** Node.js with TypeScript (ES6 target, CommonJS modules)
- **Framework:** Express.js 4.21.0
- **Database:** Supabase (@supabase/supabase-js 2.45.4)
- **Email:** nodemailer (Gmail OAuth2), Resend, Discord webhooks
- **Validation:** express-validator 7.2.0, zod 3.23.8
- **Dev Tools:** ts-node, nodemon, Prettier

### Project Structure
```
src/
├── controllers/      # Business logic organized by domain
├── routes/           # Express route definitions + validation
├── services/         # Supabase data access layer
├── lib/              # Infrastructure (db client, mailer)
├── utils/            # Helper functions (error handling, emails)
│   └── mailer/       # Email template generation
├── media/            # Static assets (logos)
└── server.ts         # Express app bootstrap
```

### Scripts
```bash
npm run start         # Development with nodemon + ts-node
npm test              # Not implemented (placeholder)
```

---

## Coding Standards

### File Naming & Organization
- **Files:** kebab-case (`contact-forms.ts`, `audit-requests.ts`)
- **Directories:** kebab-case (`contact-forms/`, `utils/`)
- **One controller per domain** (clients, cms, newsletter, leads, etc.)

### Code Style (Prettier Enforced)
```typescript
// 4-space tabs (not 2)
// Single quotes
// No semicolons
// Trailing commas in multiline

const example = {
    property: 'value',
    another: 'value',
}
```

### Naming Conventions
| Type | Pattern | Example |
|------|---------|---------|
| Functions | camelCase | `getClientEmail`, `buildLeadHtml` |
| Variables | camelCase | `clientId`, `userAgent` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_NOTIFY_TO`, `BRAND.primary` |
| Interfaces | PascalCase | `LeadRecord`, `ContactSubmissionEmailParams` |
| Types | PascalCase | `FormSubmissionEmailProps` |
| Route paths | kebab-case | `/api/contact-forms`, `/api/cms` |

### TypeScript Patterns

**Prefer:**
```typescript
// Named exports for reusable functions
export const functionName = async (params) => { ... }

// Object export for controllers
export default { createLead, getAll, deleteLead }

// Async/await consistently
const { data, error } = await db.from(table).select()
if (error) throw error

// Destructuring
const { id, name } = req.params
const { email, status = 'pending' } = req.body

// Null coalescing & optional chaining
const value = payload.optional ?? 'default'
const email = recipient?.email || ''

// Interface definitions for type safety
interface PayloadType {
    field: string
    optional?: number
}
```

**Avoid:**
- Callbacks (use async/await)
- Default exports for utilities
- String literals for table/column names (use `Tables` and `COLUMNS` enums)
- Unvalidated user input

---

## Architecture & Layering

### Request Flow
```
Client Request
    ↓
Express Route (validation middleware)
    ↓ (validateRequest)
Controller (business logic)
    ↓ (async operations)
Service / Lib (data access / infrastructure)
    ↓
External APIs (Supabase, Gmail, Resend, Discord)
```

### Layer Responsibilities

**1. Routes (`src/routes/`)**
- Define HTTP endpoints
- Apply validation middleware (express-validator or zod)
- Extract request parameters
- Delegate to controllers

```typescript
import { Router } from 'express'
import { body, param, validationResult } from 'express-validator'
import controller from '../controllers/example'

const router = Router()

router.post(
    '/api/example',
    [
        body('email').isEmail(),
        body('name').isString().notEmpty(),
    ],
    controller.create
)

export default router
```

**2. Controllers (`src/controllers/`)**
- Orchestrate business logic
- Call services/lib for data access
- Handle errors with try/catch
- Format responses

```typescript
import { Request, Response } from 'express'
import { validationResult } from 'express-validator'
import service from '../services/example'
import { handleGenericError } from '../utils/http'

const create = async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { email, name } = req.body
        const record = await service.insert({ email, name })

        return res.status(201).json(record)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { create }
```

**3. Services (`src/services/`)**
- Thin data access layer for Supabase
- Use `Tables` and `COLUMNS` enums from `src/lib/db.ts`
- Return `{ data, error }` or throw errors
- No business logic here

```typescript
import { db, Tables, COLUMNS } from '../lib/db'

const insert = async (payload: { email: string; name: string }) => {
    const { data, error } = await db
        .from(Tables.EXAMPLE)
        .insert([payload])
        .select()
        .single()

    if (error) throw error
    return data
}

const getById = async (id: string) => {
    const { data, error } = await db
        .from(Tables.EXAMPLE)
        .select('*')
        .eq('id', id)
        .single()

    if (error) throw error
    return data
}

export default { insert, getById }
```

**4. Lib (`src/lib/`)**
- Infrastructure adapters (database client, mailer service)
- Singleton instances
- Configuration

```typescript
// src/lib/db.ts
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const db = createClient(SUPABASE_URL, SUPABASE_KEY)

export const Tables = {
    CLIENTS: 'clients',
    CMS: 'cms',
    LEADS: 'leads',
    // ... add more as needed
}

export const COLUMNS = {
    CLIENT_ID: 'client_id',
    SLUG: 'client_slug',
    // ... add more as needed
}
```

---

## Database Access Patterns

### Always Use Enums for Tables/Columns
```typescript
import { db, Tables, COLUMNS } from '../lib/db'

// ✅ CORRECT
const { data, error } = await db
    .from(Tables.CLIENTS)
    .select('*')
    .eq(COLUMNS.SLUG, slug)

// ❌ WRONG (string literals)
const { data, error } = await db
    .from('clients')
    .select('*')
    .eq('client_slug', slug)
```

### Handle Errors Explicitly
```typescript
const { data, error } = await db.from(Tables.EXAMPLE).select()

if (error) {
    // Option 1: Throw (caught by handleGenericError)
    throw error

    // Option 2: Custom error
    throw { status: 404, message: 'Record not found' }
}

return data
```

### Common Query Patterns
```typescript
// Select all
const { data, error } = await db
    .from(Tables.CLIENTS)
    .select('*')

// Select single by ID
const { data, error } = await db
    .from(Tables.CLIENTS)
    .select('*')
    .eq('id', id)
    .single()

// Select with filter
const { data, error } = await db
    .from(Tables.CMS)
    .select('*')
    .eq(COLUMNS.CLIENT_ID, clientId)
    .eq('active', true)

// Insert
const { data, error } = await db
    .from(Tables.NEWSLETTER)
    .insert([{ email, firstname, lastname, client_id }])
    .select()
    .single()

// Update
const { data, error } = await db
    .from(Tables.CLIENTS)
    .update({ active })
    .eq('id', id)
    .select()
    .single()

// Delete
const { error } = await db
    .from(Tables.CLIENTS)
    .delete()
    .eq('id', id)
```

---

## API Design Standards

### RESTful Conventions
```typescript
GET    /api/resource              // List all
GET    /api/resource/:id          // Get by ID (UUID)
POST   /api/resource/new          // Create new (avoid POST to collection)
PATCH  /api/resource/:id          // Update by ID
DELETE /api/resource/:id          // Delete by ID
GET    /api/resource/:slug        // Get by slug/identifier
```

### Validation Middleware (express-validator)
```typescript
import { body, param, validationResult } from 'express-validator'

// In route definition
router.post(
    '/api/example',
    [
        body('email').isEmail().withMessage('Invalid email'),
        body('name').isString().notEmpty().withMessage('Name required'),
        body('age').optional().isInt({ min: 0 }),
    ],
    controller.create
)

// UUID validation for route parameters
router.get(
    '/api/clients/:id',
    [
        param('id').isUUID().withMessage('Client ID must be a valid UUID')
    ],
    validateRequest,
    controller.getById
)

// In controller
const errors = validationResult(req)
if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
}
```

### Validation with Zod (complex schemas)
```typescript
import { z, ZodError } from 'zod'

const schema = z.object({
    email: z.string().email(),
    budget: z.enum(['Under $5k', '$5k-$15k', '$15k-$30k', 'Over $30k']),
    honeypot: z.string().length(0), // Bot detection
})

try {
    const parsed = schema.parse(req.body)
    // Use parsed data
} catch (error) {
    if (error instanceof ZodError) {
        return res.status(400).json({
            error: 'Invalid payload',
            details: error.flatten(),
        })
    }
    throw error
}
```

### Response Patterns
```typescript
// Success (creation)
res.status(201).json(data)

// Success (retrieval)
res.status(200).json(data)

// Validation error
res.status(400).json({ error: 'Invalid input', errors: [...] })

// Conflict (duplicate)
res.status(409).json({
    error: 'Already exists',
    message: 'Detailed message',
    supportEmail: 'support@example.com',
})

// Not found
res.status(404).json({ error: 'Not found' })

// Server error (let handleGenericError handle)
throw error
```

---

## Deployment Tracking API

The deployment tracking system records website deployments, tracks changed URLs needing Google Search Console re-indexing, and sends email notifications to clients.

### Database Schema

**Table:** `website_deployments`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key (auto-generated) |
| website_id | UUID | Foreign key to websites table (CASCADE delete) |
| changed_urls | TEXT[] | Array of URLs needing re-indexing |
| summary | TEXT | Markdown summary of changes |
| created_at | TIMESTAMPTZ | Deployment timestamp (auto-set) |
| indexed_at | TIMESTAMPTZ | When re-indexed in GSC (nullable) |

### Endpoints

#### 1. Create Deployment
**POST /api/deployments**

Records a new deployment and sends email notification to the website's contact email.

**Request Body:**
```json
{
  "website_id": "uuid-here",
  "changed_urls": [
    "https://example.com/page1",
    "https://example.com/page2"
  ],
  "summary": "- Updated homepage hero\n- Added new features section"
}
```

**Validation:**
- `website_id`: Must be a valid UUID of an existing website
- `changed_urls`: Non-empty array of valid URLs
- `summary`: Non-empty string (markdown format)

**Response:** `201 Created`
```json
{
  "id": "deployment-uuid",
  "website_id": "website-uuid",
  "changed_urls": ["https://..."],
  "summary": "...",
  "created_at": "2025-11-24T00:17:37.328336+00:00",
  "indexed_at": null
}
```

**Behavior:**
- Verifies website exists (returns 404 if not found)
- Creates deployment record
- Sends email to `website.contact_email` if set (fails gracefully if email errors)
- Email includes markdown summary (converted to HTML) and list of changed URLs

**Implementation:** `src/controllers/deployments.ts:13`

---

#### 2. Get Deployment History by Website
**GET /api/websites/:websiteId/deployments**

Retrieves all deployments for a specific website with pagination.

**Query Parameters:**
- `limit` (optional): 1-100, defaults to 20
- `offset` (optional): Non-negative integer, defaults to 0

**Response:** `200 OK`
```json
{
  "website_id": "uuid",
  "website_title": "Website Name",
  "total": 42,
  "limit": 20,
  "offset": 0,
  "deployments": [
    {
      "id": "uuid",
      "website_id": "uuid",
      "changed_urls": ["..."],
      "summary": "...",
      "created_at": "...",
      "indexed_at": "..."
    }
  ]
}
```

**Implementation:** `src/controllers/deployments.ts:78`

---

#### 3. Get Single Deployment
**GET /api/deployments/:id**

Retrieves a specific deployment by ID.

**Response:** `200 OK` or `404 Not Found`
```json
{
  "id": "uuid",
  "website_id": "uuid",
  "changed_urls": ["..."],
  "summary": "...",
  "created_at": "...",
  "indexed_at": null
}
```

**Implementation:** `src/controllers/deployments.ts:123`

---

#### 4. Mark Deployment as Indexed
**PATCH /api/deployments/:id/indexed**

Marks a deployment as indexed in Google Search Console by setting `indexed_at` to current timestamp.

**Response:** `200 OK` or `404 Not Found`
```json
{
  "id": "uuid",
  "website_id": "uuid",
  "changed_urls": ["..."],
  "summary": "...",
  "created_at": "...",
  "indexed_at": "2025-11-24T00:18:59.087+00:00"
}
```

**Implementation:** `src/controllers/deployments.ts:143`

---

#### 5. Get Unindexed Deployments
**GET /api/deployments/unindexed**

Retrieves all deployments where `indexed_at` is null (pages not yet re-indexed in GSC).

**Query Parameters:**
- `limit` (optional): 1-100, defaults to 50

**Response:** `200 OK`
```json
{
  "total": 3,
  "deployments": [
    {
      "id": "uuid",
      "website_id": "uuid",
      "changed_urls": ["..."],
      "summary": "...",
      "created_at": "...",
      "indexed_at": null
    }
  ]
}
```

**Implementation:** `src/controllers/deployments.ts:172`

**Important:** This route must come BEFORE `/api/deployments/:id` in route definitions to avoid "unindexed" being treated as a UUID parameter.

---

### Email Templates

Deployment emails are sent using the existing Gmail OAuth2 infrastructure.

**Template Location:** `src/utils/mailer/emails.ts`

**Functions:**
- `generateDeploymentEmailHtml()`: HTML version with styled layout
- `generateDeploymentEmailText()`: Plain text fallback

**Email Content:**
- Website title
- Deployment timestamp
- Markdown summary (converted to HTML list)
- Changed URLs list (clickable links in HTML version)
- Branded styling using BRAND constants

**Example Usage:**
```typescript
await sendEmail({
    to: website.contact_email,
    subject: `New Deployment: ${website.title} - ${date}`,
    html: generateDeploymentEmailHtml({ websiteTitle, changedUrls, summary, deployedAt }),
    text: generateDeploymentEmailText({ websiteTitle, changedUrls, summary, deployedAt })
})
```

---

### Service Layer

**Location:** `src/services/deployments.ts`

**Methods:**
- `createDeployment(payload)`: Insert new deployment
- `getDeploymentsByWebsiteId(websiteId, limit, offset)`: Get paginated history
- `getDeploymentById(id)`: Get single deployment
- `markAsIndexed(id, updates)`: Update indexed_at timestamp
- `getUnindexedDeployments(limit)`: Get deployments needing indexing

**Pattern:**
```typescript
const { data, error } = await db.from(Tables.DEPLOYMENTS).select()
if (error) throw error
return data
```

---

### Integration Example

**Typical workflow from GitHub Actions / Netlify webhook:**

```bash
# After deployment succeeds, POST to API
curl -X POST https://api.pixelversestudios.io/api/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "website_id": "uuid-from-config",
    "changed_urls": [
      "https://example.com/updated-page-1",
      "https://example.com/updated-page-2"
    ],
    "summary": "- Fixed bug in contact form\n- Updated team photos\n- Added new service offering"
  }'
```

**Result:**
1. Deployment record created in database
2. Email sent to client with deployment summary
3. Changed URLs tracked for manual Google Search Console re-indexing
4. Deployment appears in unindexed list until marked as indexed

---

## Error Handling

### Centralized Error Handler
All controllers should use the `handleGenericError` utility:

```typescript
import { handleGenericError } from '../utils/http'

const someController = async (req: Request, res: Response) => {
    try {
        // Business logic
    } catch (err) {
        return handleGenericError(err, res)
    }
}
```

### Error Throwing Patterns
```typescript
// Supabase errors (automatically logged by handleGenericError)
if (error) throw error

// Custom status codes
if (duplicate) {
    throw {
        status: 409,
        message: 'Subscriber already exists',
    }
}

// Validation errors (handled before reaching catch block)
const errors = validationResult(req)
if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
}
```

### Logging
```typescript
// Success logs
console.log('✅ Email sent successfully:', { result, sentTo })
console.log('Lead inserted', { id: lead.id, email: lead.email })

// Error logs (automatic in handleGenericError)
console.error('❌ Error sending email:', error)
console.error('Unhandled error:', err.message, err.stack)
```

---

## Email & Notifications

### Email Services Available
1. **Gmail (nodemailer + OAuth2):** Contact form submissions
2. **Resend:** Lead notifications (optional, flag-controlled)
3. **Discord Webhooks:** Lead/audit notifications (alternative to email)

### Email Template Pattern
```typescript
// src/utils/mailer/emails.ts

// HTML version (with inline styles)
const buildLeadHtml = (lead: LeadRecord): string => {
    const summary = escapeHtml(lead.brief_summary).replace(/\n/g, '<br />')

    return `<!doctype html>
    <html>
    <head>
        <style>
            body { font-family: system-ui, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>New Lead Submission</h1>
            <p><strong>Name:</strong> ${escapeHtml(lead.name)}</p>
            <p><strong>Email:</strong> ${escapeHtml(lead.email)}</p>
            <p><strong>Summary:</strong><br>${summary}</p>
        </div>
    </body>
    </html>`
}

// Plain text version (fallback)
const buildLeadText = (lead: LeadRecord): string => {
    return [
        'New Lead Submission',
        '',
        `Name: ${lead.name}`,
        `Email: ${lead.email}`,
        `Summary: ${lead.brief_summary}`,
    ].join('\n')
}

// ALWAYS escape HTML to prevent XSS
const escapeHtml = (value: string): string => {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}
```

### Sending Email (Gmail)
```typescript
import { sendEmail } from '../lib/mailer'

await sendEmail({
    to: recipient.email,
    subject: 'Subject line',
    html: buildHtmlTemplate(data),
    text: buildTextTemplate(data),
})
```

### Discord Webhooks
```typescript
const response = await fetch(process.env.DISCORD_WEBHOOK_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        username: 'Bot Name',
        content: 'Title',
        embeds: [{
            description: message,
            color: 0x3f00e9,
            timestamp: new Date().toISOString(),
            footer: { text: 'Footer text' },
        }],
    }),
})

if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Discord webhook failed (${response.status}): ${errorText}`)
}
```

### Brand Constants
```typescript
const BRAND = {
    primary: '#3f00e9',
    secondary: '#c947ff',
    gradient: 'linear-gradient(90deg, #3f00e9, #c947ff)',
    background: '#ffffff',
    surface: '#f7f7fb',
    text: '#111111',
    muted: '#666666',
    border: '#e6e6ef',
}
```

---

## Configuration & Environment

### Required Environment Variables
```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx

# Gmail (OAuth2)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_CLIENT_ID=xxx.apps.googleusercontent.com
SMTP_CLIENT_SECRET=xxx
SMTP_REFRESH_TOKEN=xxx
SMTP_FROM_EMAIL=info@pixelversestudios.io

# Resend (optional)
RESEND_API_KEY=re_xxx

# Discord (optional)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxx

# Lead notifications
LEAD_NOTIFY_TO=ops@pixelversestudios.io,info@pixelversestudios.io
LEAD_NOTIFY_USE_RESEND=false
LEAD_NOTIFY_LOGO_URL=https://...

# Environment
NODE_ENVIRONMENT=development
PORT=5001  # Production server port - DO NOT use for testing (use 5002+ for tests)
```

### Configuration Patterns
```typescript
// Boolean flags
const shouldUseResend = (): boolean => {
    const flag = process.env.LEAD_NOTIFY_USE_RESEND || 'false'
    const normalized = flag.trim().toLowerCase()
    return ['true', '1', 'on', 'yes'].includes(normalized)
}

// Comma-separated lists
const getRecipients = (): string[] => {
    const value = process.env.LEAD_NOTIFY_TO || 'default@example.com'
    return value.split(',').map(r => r.trim()).filter(Boolean)
}

// Environment-aware overrides
const email = process.env.NODE_ENVIRONMENT === 'development'
    ? 'test@example.com'
    : configuredEmail
```

---

## Common Patterns

### Slug-Based Lookup
```typescript
// Many endpoints use client/website slugs for lookups
const clientId = await clientsService.getIdBySlug(clientSlug)
if (!clientId) {
    return res.status(404).json({ error: 'Client not found' })
}
```

### IP & User-Agent Extraction
```typescript
const getClientIp = (req: Request): string | null => {
    const headerValue = req.headers['x-forwarded-for'] || req.headers['x-real-ip']
    if (Array.isArray(headerValue)) {
        return headerValue[0] || null
    }
    if (typeof headerValue === 'string') {
        const [first] = headerValue.split(',').map(v => v.trim())
        return first || null
    }
    return null
}

const userAgent = typeof req.headers['user-agent'] === 'string'
    ? req.headers['user-agent']
    : null
```

### Honeypot Bot Detection
```typescript
const schema = z.object({
    // Other fields...
    honeypot: z.string().length(0), // Must be empty
})

// Bots will fill this hidden field, legitimate users won't
```

### Duplicate Prevention
```typescript
// Check for existing record
const existingLead = await service.findByEmail(email)
if (existingLead) {
    return res.status(409).json({
        error: 'Lead already submitted',
        message: 'You have already submitted a lead request.',
        supportEmail: 'support@pixelversestudios.io',
    })
}
```

---

## Adding New Features

### Checklist for New Endpoints

1. **Create Service** (`src/services/your-feature.ts`)
   - Add table to `Tables` enum in `src/lib/db.ts`
   - Implement CRUD operations
   - Use `{ data, error }` pattern consistently

2. **Create Controller** (`src/controllers/your-feature.ts`)
   - Import service
   - Implement business logic
   - Use `handleGenericError` for error handling
   - Export object with functions

3. **Create Route** (`src/routes/your-feature.ts`)
   - Define endpoints with validation middleware
   - Import controller
   - Export router

4. **Register Route** (`src/server.ts`)
   - Import router
   - Add `app.use(yourRouter)` before error handler

5. **Add Email Templates** (if needed)
   - Create HTML and text versions in `src/utils/mailer/emails.ts`
   - Escape all user input with `escapeHtml`
   - Use brand constants for styling

6. **Update Environment** (if needed)
   - Add new variables to `.env`
   - Document in this file and `AGENTS.md`

7. **Test Manually**
   - Use Postman/Insomnia
   - Verify Supabase records
   - Check email delivery
   - Test error cases

### Example: Adding a New Resource

```typescript
// 1. src/services/testimonials.ts
import { db, Tables } from '../lib/db'

const getAll = async () => {
    const { data, error } = await db.from(Tables.TESTIMONIALS).select('*')
    if (error) throw error
    return data
}

const insert = async (payload: { author: string; content: string }) => {
    const { data, error } = await db
        .from(Tables.TESTIMONIALS)
        .insert([payload])
        .select()
        .single()
    if (error) throw error
    return data
}

export default { getAll, insert }

// 2. src/controllers/testimonials.ts
import { Request, Response } from 'express'
import { validationResult } from 'express-validator'
import service from '../services/testimonials'
import { handleGenericError } from '../utils/http'

const getAll = async (req: Request, res: Response) => {
    try {
        const testimonials = await service.getAll()
        return res.status(200).json(testimonials)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

const create = async (req: Request, res: Response) => {
    try {
        const errors = validationResult(req)
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() })
        }

        const { author, content } = req.body
        const testimonial = await service.insert({ author, content })
        return res.status(201).json(testimonial)
    } catch (err) {
        return handleGenericError(err, res)
    }
}

export default { getAll, create }

// 3. src/routes/testimonials.ts
import { Router } from 'express'
import { body } from 'express-validator'
import controller from '../controllers/testimonials'

const router = Router()

router.get('/api/testimonials', controller.getAll)

router.post(
    '/api/testimonials/new',
    [
        body('author').isString().notEmpty(),
        body('content').isString().notEmpty(),
    ],
    controller.create
)

export default router

// 4. src/server.ts
import testimonialsRouter from './routes/testimonials'
app.use(testimonialsRouter)
```

---

## Known Issues & Gaps

### Security
- ❌ **No endpoint authentication/authorization** - All endpoints are publicly accessible
- ❌ **No rate limiting** - Vulnerable to abuse
- ⚠️ **reCAPTCHA not implemented** - `routes/recaptcha.ts` is a placeholder
- ⚠️ **CSRF protection not implemented**

### Testing
- ❌ **No automated test suite** - `npm test` exits with error
- Manual testing only (Postman/Insomnia)

### Code Quality
- ⚠️ **Legacy code exists** - `models/` directory contains unused Mongoose schemas
- ⚠️ **Some CommonJS utilities** - `src/utils/token.js` is legacy
- ⚠️ **Inconsistent service patterns** - `services/clients.getClientEmail` logs but doesn't return data

### Documentation
- Keep `AGENTS.md` in sync with new features
- Document new environment variables
- Update this file when patterns change

---

## Development Workflow

### Starting the Server
```bash
npm run start
# Server runs on http://localhost:5001 (configured in .env)
```

### Testing for Claude Code Agents

**IMPORTANT:** When Claude Code needs to test endpoints:

1. **Never use port 5001** - This is the production server port that's already running
2. **Use a test port** - Temporarily change the PORT in `.env` to a different port (e.g., 5002, 5003)
3. **Start test server:**
   ```bash
   # Kill any process on test port first
   lsof -ti:5002 | xargs kill -9 2>/dev/null

   # Start server on test port (after changing .env PORT to 5002)
   npm run start
   ```
4. **Test the endpoints** on the test port (e.g., `http://localhost:5002`)
5. **ALWAYS kill the test server when done:**
   ```bash
   lsof -ti:5002 | xargs kill -9 2>/dev/null
   ```
6. **Restore .env** - Change PORT back to 5001

**Example Test Flow:**
```bash
# 1. Change .env PORT from 5001 to 5002
# 2. Start test server
npm run start

# 3. Test endpoints
curl http://localhost:5002/api/clients

# 4. Kill test server when done
lsof -ti:5002 | xargs kill -9
```

### Making Changes
1. Create/modify files in `src/`
2. Nodemon will auto-reload on save (if server is running)
3. Test with Postman/Insomnia or via Claude Code test server
4. Verify database changes in Supabase dashboard
5. Check console logs for errors

### Debugging
- Console logs are your friend (no debugger configured)
- Check Supabase logs for database errors
- Verify email delivery in Gmail sent folder or Resend dashboard
- Discord webhooks show errors in HTTP response

### Code Quality
```bash
# Prettier will format on save (if configured in editor)
# No linter configured - rely on TypeScript compiler errors
```

---

## Best Practices

### Do's ✅
- Use TypeScript types and interfaces
- Validate all user input
- Use `Tables` and `COLUMNS` enums for database access
- Escape HTML in email templates
- Handle `{ data, error }` from Supabase explicitly
- Log important events and errors
- Return appropriate HTTP status codes
- Keep controllers thin (business logic only)
- Keep services focused (data access only)

### Don'ts ❌
- Don't use string literals for table/column names
- Don't ignore Supabase errors
- Don't commit `.env` file
- Don't skip validation middleware
- Don't use `any` type without good reason
- Don't create new MongoDB schemas (legacy)
- Don't add authentication without documenting it
- Don't use synchronous file operations in request handlers
- **Don't test on port 5001** - Always use a different test port (5002, 5003, etc.) and kill it when done

---

## Resources

- **AGENTS.md** - Comprehensive project documentation for AI agents
- **Supabase Docs** - https://supabase.com/docs
- **Express.js Docs** - https://expressjs.com
- **TypeScript Handbook** - https://www.typescriptlang.org/docs
- **express-validator** - https://express-validator.github.io
- **Zod** - https://zod.dev

---

## Summary

This project prioritizes:
1. **Type safety** - Strict TypeScript configuration
2. **Clear architecture** - Layered separation of concerns
3. **Consistent patterns** - Predictable code organization
4. **Maintainability** - Readable, documented code

When in doubt, follow existing patterns in the codebase. Prioritize consistency over cleverness.
