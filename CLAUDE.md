# CLAUDE.md - Pixelverse Studios Server

## Project Overview

**Pixelverse Studios Server** is a TypeScript Express.js REST API that manages client data, CMS content, contact forms, newsletter subscriptions, lead intake, audit requests, and website deployment tracking. The backend uses Supabase (PostgreSQL) and integrates with Gmail, Resend, and Discord for notifications.

**Architecture:** Layered MVC-inspired pattern with clear separation between routes, controllers, and services.

---

## ⚠️ CRITICAL: Branch & Deployment Discipline

**Environments and their branches:**

| Branch | Environment | Auto-deploys |
|---|---|---|
| `main` | **Production** | Yes — DigitalOcean App Platform |
| `staging` | **Staging** | Yes — DigitalOcean App Platform |
| `dev/{milestone-slug}` | Milestone integration (no deploy) | No |
| `epic/{epic-ticket-id}` | Epic rollup (no deploy) | No |
| `<ticket-id>` | Feature work (no deploy) | No |

**Hard rules:**

1. **NEVER push directly to `main` or `staging` without explicit approval from Phil.** Both branches auto-deploy. Any push is a production or staging deploy.
2. **NEVER merge PRs into `main` or `staging` without explicit approval from Phil.** Same reason.
3. **NEVER force-push, `git reset --hard`, or rewrite history on `main` or `staging`** under any circumstance.
4. **If a merge would go to `main` or `staging`, stop and ask first.** Phil orchestrates staging → production cutovers manually.

**Normal merge flow (allowed without asking — still confirm before executing):**

```
feature-branch → epic branch → dev/{milestone-slug} → (pause, await approval) → staging → (pause, await approval) → main
```

The last two hops are Phil's decision. Everything up to `dev/{milestone-slug}` is normal engineering flow.

---

## ⚠️ CRITICAL: Testing Protocol for Claude Code

**NEVER test on port 5001** — the production server is always running on this port.

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
- **Database:** Supabase (@supabase/supabase-js 2.45.4) — Postgres + Auth (HS256 JWT)
- **Auth:** Supabase JWT verified locally via `jsonwebtoken`; per-route `requireAuth` / `requireCmsAccess` / `requirePvsAdmin` middleware
- **Rate limiting:** `express-rate-limit` with per-tier limiters (public / authRead / authWrite / sensitive / webhookWrite) + a catch-all for non-CMS routes
- **Email:** nodemailer (Gmail App Password for transactional deployment/lead emails), Resend (optional alternate), Discord webhooks (ops notifications)
- **Image storage:** Cloudflare R2 (per-website `r2_config`, signed upload URLs)
- **Validation:** express-validator 7.2.0, zod 3.23.8
- **Durable webhook queue:** `pending_webhook_events` table + in-process poller (see DEV-701 / `src/lib/webhook-processor.ts`)
- **Dev Tools:** ts-node, nodemon, Prettier

### Project Structure
```
src/
├── controllers/      # Business logic organized by domain
│   ├── cms-pages.ts, cms-templates.ts, client-users.ts
│   ├── website-domains.ts, r2-uploads.ts
│   └── leads, audit, deployments, contact-forms, etc.
├── routes/           # Express route definitions + validation
│   ├── auth-middleware.ts  # requireAuth / requireCmsAccess / requirePvsAdmin
│   ├── rate-limits.ts      # per-tier limiters (DEV-663)
│   ├── cms-*.ts            # CMS routes (all authenticated)
│   └── ...
├── services/         # Supabase data access layer
├── lib/
│   ├── db.ts                # Supabase client + Tables/COLUMNS enums
│   ├── auth.ts              # Supabase JWT verification
│   ├── mailer.ts            # Gmail App Password transactional email
│   ├── resend-mailer.ts     # optional alternate sender
│   ├── r2.ts                # Cloudflare R2 signed upload URLs
│   └── webhook-processor.ts # DEV-701 durable queue + retry poller
├── utils/            # escapeHtml, http error handler, hostname, cms-validation, assert
├── media/            # Static assets (logos)
└── server.ts         # Express app bootstrap (trust proxy, routers, SIGTERM handler)

supabase/migrations/  # Applied forward-only. Never rewrite or reorder.
docs/audits/          # One-off audits (webhook durability, admin endpoint coverage, ...)
docs/runbooks/        # Operational runbooks (deploy-window, cms-provisioning, ...)
docs/postmortems/     # Incident postmortems
```

### Scripts
```bash
npm run dev           # Development with nodemon + ts-node (auto-reload)
npm run build         # Compile TypeScript to dist/
npm run start         # Production: run compiled JS (requires build first)
npm run start:ts      # Run directly via ts-node (no build needed)
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

## CMS, Auth, Rate Limiting & Webhook Queue

### CMS multi-controller architecture

The `/api/cms/*` namespace is driven by separate controllers by concern, all authenticated:

| Module | Responsibility |
|---|---|
| `cms-templates` | Per-client schema definitions (fields, types, validation) |
| `cms-pages` | Content instances bound to a template; draft/published/archived state machine |
| `cms-users` (`client_users`) | Per-client access with roles (`admin`/`editor`/`viewer`); `is_pvs_admin` flag grants cross-client superadmin |
| `website-domains` | `hostname → website_id` mapping; public resolve-hostname returns branding + `cms_slug` |
| `r2-uploads` | Signed upload URLs for image fields in CMS pages |

### Authentication middleware

Located in `src/routes/auth-middleware.ts`. Supabase HS256 JWTs verified locally via `src/lib/auth.ts` using `SUPABASE_JWT_SECRET`.

- `requireAuth` — rejects missing/invalid JWT with 401
- `requireCmsAccess` — `requireAuth` + the authenticated user has a matching `client_users` row for the `clientId` path param (or is `is_pvs_admin`)
- `requirePvsAdmin` — `requireAuth` + `is_pvs_admin = true`

### Rate limiting tiers

`src/routes/rate-limits.ts` — each tier is an `express-rate-limit` instance with the right `keyGenerator`:

| Tier | Window / limit | Keyed by | Use on |
|---|---|---|---|
| `publicReadLimit` | 1m / 120 | IP | Unauthenticated reads |
| `authReadLimit` | 1m / 300 | auth `uid` | Authenticated reads (mount AFTER `requireAuth`) |
| `authWriteLimit` | 1m / 30 | auth `uid` | Authenticated writes (mount AFTER `requireAuth`) |
| `sensitiveWriteLimit` | 5m / 10 | auth `uid` | Privileged ops (user invites, role changes, template delete) |
| `webhookWriteLimit` | 1m / 10 | IP | Public write webhooks that persist durable state (e.g. `/api/deployments`) |
| `generalApiLimit` | 1m / 200 | IP | App-level catch-all for non-CMS routes |

Development bypasses all limiters (see `baseSkip`). Internal service-to-service calls with a valid `X-Blast-Secret` header also bypass.

### Hostname-based tenant resolution

`website_domains.hostname` → `website_id`. The CMS dashboard (separate repo) hits a public resolve-hostname endpoint on boot with its current hostname; the response returns the website's branding blob and (post-DEV-734) `cms_slug`. The dashboard's `BrandingProvider` caches these.

### Durable webhook queue (DEV-701)

`pending_webhook_events` table + in-process poller in `src/lib/webhook-processor.ts`.

- **Purpose:** irrecoverable webhook payloads (currently: `POST /api/deployments` from client CI/CD) are persisted before any fallible processing, so server restarts or handler failures don't drop the payload.
- **Flow:** controller INSERTs row → attempts inline processing → on success updates to `status='done'` with `result_ref` + `email_sent_at` idempotency markers; on transient failure schedules retry at 1m / 5m / 30m with jitter; on retry exhaustion marks `status='failed'` with a sanitized `last_error` taxonomy.
- **Background:** `setInterval` poller (60s) picks up `status='pending'` rows with `next_retry_at <= now`. Concurrency 3. 24h cleanup removes `done > 30d` and `failed > 90d`.
- **Scaling:** gated by `WEBHOOK_PROCESSOR_ENABLED` env flag — set to `false` on all but one instance if scaling horizontally.
- **Reference:** `docs/audits/webhook-durability-audit.md`, `docs/runbooks/deploy-window.md`.

### `cms_slug` / dashboard subdomains

Pattern: `{cms_slug}.cms.pixelversestudios.io` (e.g. `jpwnj.cms.pixelversestudios.io`). DEV-734 adds a `websites.cms_slug` column that auto-provisions the corresponding `website_domains` row. Netlify domain alias provisioning is a separate step (DEV-736 — manual CLI script for now).

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

Records website deployments from client CI/CD, tracks changed URLs through a three-state GSC re-indexing workflow, and sends email notifications.

**Endpoints** — see `src/routes/deployments.ts` for the authoritative list and validators.

**Three-state indexing** (per-URL and deployment-level):

| State | Meaning |
|---|---|
| `pending` | Fresh, needs GSC indexing request |
| `requested` | Submitted to GSC, awaiting indexing |
| `indexed` | Confirmed indexed |

Forward-only (`pending` → `requested` → `indexed`). Deployment-level status is computed from URLs: `pending` if any URL is pending, `requested` if any is requested and none pending, `indexed` only when all are indexed.

**Durability (DEV-701):** `POST /api/deployments` is a fire-and-forget webhook from client CI/CD — payload cannot be reconstructed if dropped. The controller writes to `pending_webhook_events` first, then attempts inline processing. On transient failure, the background poller retries at 1m / 5m / 30m. See `src/lib/webhook-processor.ts` and `docs/runbooks/deploy-window.md`.

**Service layer:** `src/services/deployments.ts` exposes CRUD + state-transition helpers. URL payloads are auto-normalized between legacy `{ url, indexed_at }` and the three-state shape.

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

### Services

- **Gmail (nodemailer + App Password)** — all PVS transactional email (deployment notifications, leads, audits, contact forms). Entry point: `src/lib/mailer.ts`.
- **Resend** — optional alternate transport for lead notifications (flag-controlled via `LEAD_NOTIFY_USE_RESEND`) and email blasts. Entry point: `src/lib/resend-mailer.ts`.
- **Discord webhooks** — ops alerts and alternate lead/audit notification path.
- **Nylas** — Domani email blasts only, not PVS transactional.

### Non-obvious rules

- **Always `escapeHtml` before interpolating user input into email HTML.** The helper lives next to the templates in `src/utils/mailer/`. DEV-733 tracks a gap where `markdownToHtml` doesn't escape — fix that before using markdown fields in any new template.
- **Always provide a plain-text fallback** alongside HTML (better deliverability, fewer spam flags).
- **Use brand constants** (`#3f00e9` primary, `#c947ff` secondary, gradient `linear-gradient(90deg, #3f00e9, #c947ff)`) rather than hardcoded hex.
- **Discord payloads follow a fixed embed shape** (`username`, `content`, `embeds[{description, color, timestamp, footer}]`); see `src/controllers/leads.ts` for a reference call.

Canonical examples: `src/utils/mailer/emails.ts` (template builders), `src/lib/mailer.ts` (send), `src/controllers/leads.ts` (Discord).

---

## Configuration & Environment

### Required Environment Variables

Authoritative list lives in `.env.example`. Summary of the important groups:

```bash
# Server
PORT=5001                              # Production port — DO NOT use for testing (5002+ for tests)
NODE_ENVIRONMENT=development           # development | staging | production

# Supabase (PVS)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxx
SUPABASE_JWT_SECRET=xxx                # HS256 secret from Supabase → Settings → API → JWT Settings.
                                       # Required for CMS auth (requireAuth middleware).

# Supabase (Domani App) — read-only for dashboard visibility
DOMANI_SUPABASE_URL=https://...
DOMANI_SUPABASE_SERVICE_KEY=xxx

# Gmail (App Password — NOT OAuth2 anymore)
GMAIL_USER=info@pixelversestudios.io
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx

# Webhook processor (DEV-701)
WEBHOOK_PROCESSOR_ENABLED=true         # Set to false on all but one instance when scaling horizontally

# Cloudflare R2 (CMS image uploads)
R2_ACCOUNT_ID=xxx
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_DEFAULT_BUCKET=pvs-cms-default
R2_DEFAULT_PUBLIC_BASE_URL=https://pub-xxxxxxxx.r2.dev

# Internal service-to-service secret (used by skipBlastSecret in rate-limits)
BLAST_SECRET=xxx                       # Generate with: openssl rand -hex 32

# Resend (optional — email blasts / alternate transport)
RESEND_API_KEY=re_xxx

# Calendly (booking webhook)
CALENDLY_API_TOKEN=xxx

# Nylas (Domani email blasts — NOT for PVS transactional; see note below)
NYLAS_API_KEY=xxx
NYLAS_GRANT_ID=xxx

# Discord (ops notifications, optional)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxx

# Lead notifications
LEAD_NOTIFY_TO=ops@pixelversestudios.io,info@pixelversestudios.io
LEAD_NOTIFY_USE_RESEND=false
LEAD_NOTIFY_LOGO_URL=https://...
```

**Note on email services:** PVS transactional email (deployment notifications, lead notifications) runs through `src/lib/mailer.ts` using Gmail App Password via nodemailer — Nylas was removed from PVS transactional paths. Nylas vars above are for Domani-specific email flows only.

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

### Canonical examples in-repo

Rather than duplicate a walkthrough that will drift, read existing domains for the pattern:

| Use case | Read |
|---|---|
| Simplest public endpoint (service + controller + route + zod validation) | `src/{services,controllers,routes}/leads.ts` |
| Authenticated CMS endpoint with `requireAuth` / `requirePvsAdmin` and rate-limit tiers | `src/{services,controllers,routes}/cms-templates.ts` + `src/routes/cms-templates.ts` |
| Hostname-resolved public endpoint with branding lookup | `src/{services,controllers,routes}/website-domains.ts` |
| Durable webhook with retry queue | `src/controllers/deployments.ts` + `src/lib/webhook-processor.ts` |

---

## Known Issues & Gaps

### Security
- ⚠️ **Mixed endpoint authentication** — CMS endpoints under `/api/cms/*` use Supabase JWT auth via `requireAuth` / `requireCmsAccess` / `requirePvsAdmin`. Legacy public endpoints (clients, websites, contact-forms, leads, audit-requests, deployments) intentionally remain unauthenticated or rate-limit-only; admin-coverage audit tracked in DEV-735.
- ✅ **Rate limiting** — Per-route tier limiters (publicReadLimit, authReadLimit, authWriteLimit, sensitiveWriteLimit, webhookWriteLimit) on CMS/webhook routes; `generalApiLimit` catch-all on non-CMS routes. See `src/routes/rate-limits.ts`.
- ⚠️ **Email markdown renderer** — `src/lib/mailer.ts` `markdownToHtml` doesn't HTML-escape before markdown regex. Tracked in DEV-733.
- ⚠️ **Body-parser global limit not explicit** — defaults to 100kb. Tracked in DEV-732.
- ⚠️ **Distributed-attacker flood on leaked `website_id`** — per-IP `webhookWriteLimit` is shallow defense. Tracked in DEV-731.

### Testing
- ❌ **No automated test suite** — `npm test` exits with error. Manual testing only (Postman/Insomnia, or the test-port protocol below).

### Code Quality
- ⚠️ **Some CommonJS utilities** — `src/utils/token.js` is legacy
- ⚠️ **Inconsistent service patterns** — `services/clients.getClientEmail` logs but doesn't return data

### Documentation
- Update this file when patterns change
- Document new environment variables inline in `.env.example`
- Use `docs/audits/` for audit outputs, `docs/runbooks/` for operational procedures

---

## Development Workflow

### Starting the Server
```bash
npm run dev
# Server runs on http://localhost:5001 (configured in .env)
# Uses nodemon + ts-node — auto-reloads on file changes
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
   npm run start:ts
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
npm run start:ts

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

## Linear Ticket Creation

When creating Linear tickets for this project:

| Field    | Value               |
| -------- | ------------------- |
| Team     | `Development`       |
| Assignee | `me`                |
| Project  | `PVS Api`           |
| Priority | Medium (3)          |

**Labels:** Always apply one from each sub-label group:

- **Environment:** `Front End`, `Fullstack`, `Server`
- **Scope:** `Ticket`, `Epic`
- **Task:** `Feature`, `Bug`, `Improvement`, `Refactor`, `Maintenance`, `Research`

**Description format:**

- `## Summary` - what and why
- `## Current State` / `## Target State` - when applicable
- `## Implementation` - files to modify, code snippets
- `## Acceptance Criteria` - checkbox list

## Best Practices

### Do's ✅
- Ask Phil before merging to `main` or `staging`
- Use TypeScript types and interfaces
- Validate all user input (express-validator for simple shape checks; zod for complex schemas)
- Use `Tables` and `COLUMNS` enums for database access
- Escape HTML in email templates (`escapeHtml` helper)
- Handle `{ data, error }` from Supabase explicitly
- Log important events and errors
- Return appropriate HTTP status codes
- Keep controllers thin (business logic only)
- Keep services focused (data access only)
- For irrecoverable webhook payloads, persist to `pending_webhook_events` before any fallible processing (see DEV-701 pattern)
- For authenticated CMS routes, use the existing `requireAuth` / `requireCmsAccess` / `requirePvsAdmin` middleware — don't invent new auth schemes

### Don'ts ❌
- **Don't push to `main` or `staging` without explicit approval from Phil** — both auto-deploy
- **Don't merge PRs into `main` or `staging` without explicit approval from Phil**
- **Don't force-push or rewrite history on `main` or `staging`** under any circumstance
- Don't use string literals for table/column names (use `Tables` / `COLUMNS` enums)
- Don't ignore Supabase errors — handle `{ data, error }` explicitly
- Don't commit `.env` file
- Don't skip validation middleware
- Don't use `any` type without good reason
- Don't add authentication without documenting it in this file
- Don't use synchronous file operations in request handlers
- Don't mount `requireAuth`-keyed rate limiters before `requireAuth` (keying falls back to IP, defeating the purpose)
- **Don't test on port 5001** — always use a different test port (5002, 5003, etc.) and kill it when done

---

## Resources

- **`docs/audits/`** — webhook-durability-audit, admin-endpoint-audit, etc.
- **`docs/runbooks/`** — deploy-window, cms-provisioning, etc.
- **`docs/postmortems/`** — incident writeups (e.g. 2026-04-07 CMS expansion 504)
- **Supabase Docs** — https://supabase.com/docs
- **Express.js Docs** — https://expressjs.com
- **express-validator** — https://express-validator.github.io
- **Zod** — https://zod.dev

---

## Summary

This project prioritizes:
1. **Type safety** - Strict TypeScript configuration
2. **Clear architecture** - Layered separation of concerns
3. **Consistent patterns** - Predictable code organization
4. **Maintainability** - Readable, documented code

When in doubt, follow existing patterns in the codebase. Prioritize consistency over cleverness.
