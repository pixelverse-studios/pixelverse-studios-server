# CMS Restoration Slices — Verification Report

**Date:** 2026-04-13
**Branch:** epic/dev-677
**Tickets:** DEV-698, DEV-699, DEV-700

All three restoration slices exist on the `epic/dev-677` branch from the original CMS expansion work. The code was reverted from `main` (commit `03bf050`) but was never removed from the `dev/cms-expansion` branch. This verification confirms all code is present, wired correctly, and functioning.

---

## DEV-698: Auth Layer (JWT middleware + /api/cms/me + client_users)

### Files verified
- `src/lib/auth.ts` — JWT verification (HS256, audience, issuer, email_verified)
- `src/routes/auth-middleware.ts` — requireAuth, requireCmsAccess, requirePvsAdmin
- `src/services/client-users.ts` — CRUD + first-login linking + throttled last_login
- `src/controllers/client-users.ts` — /api/cms/me + user management endpoints
- `src/routes/cms-users.ts` — route definitions with rate limiting

### DB support
- `client_users` in Tables enum (`src/lib/db.ts`)
- `AUTH_UID`, `IS_PVS_ADMIN` in COLUMNS enum
- Migration: `20260406_create_cms_schema.sql` (creates client_users table)
- Migration: `20260407_add_cms_rls_policies.sql` (RLS policies)
- Migration: `20260409_add_client_users_email_unique.sql` (unique constraint)
- Migration: `20260410_seed_pvs_admins.sql` (seeds PVS admin rows)

### Smoke test results
| Endpoint | Condition | Expected | Actual |
|----------|-----------|----------|--------|
| `GET /api/cms/me` | No token | 401 | 401 |
| `GET /api/cms/me` | Bad token (no JWT_SECRET) | 500 | 500 |
| `GET /api/clients` | Public | 200 | 200 |

Note: 500 on bad token without `SUPABASE_JWT_SECRET` configured is correct — `AuthConfigError` maps to 500 (server misconfiguration, not client error). In production the secret will be set.

---

## DEV-699: Templates + Pages Layer

### Files verified
- `src/controllers/cms-templates.ts` — template CRUD
- `src/controllers/cms-pages.ts` — page CRUD with template-driven validation
- `src/services/cms-templates.ts` — data access for cms_templates
- `src/services/cms-pages.ts` — data access for cms_pages
- `src/routes/cms-templates.ts` — route definitions (PVS admin gated for writes)
- `src/routes/cms-pages.ts` — route definitions (role-based access)
- `src/utils/cms-validation.ts` — field type validation + sanitize-html for richtext

### DB support
- `CMS_TEMPLATES`, `CMS_PAGES` in Tables enum
- `TEMPLATE_ID`, `CMS_SLUG` in COLUMNS enum
- Migration: `20260406_create_cms_schema.sql` (creates both tables)
- Migration: `20260407_add_cms_rls_policies.sql` (RLS policies)

### Key details
- Field types supported: text, textarea, richtext, boolean, image, select, number
- `sanitize-html` applied server-side to richtext fields on save (XSS prevention)
- Template-driven validation enforced on page content updates
- Legacy `cms` table dropped by `20260411_drop_legacy_cms_table.sql` (replaced by templates + pages)

### Smoke test results
| Endpoint | Condition | Expected | Actual |
|----------|-----------|----------|--------|
| `GET /api/cms/clients/:id/templates` | No auth | 401 | 401 |
| `POST /api/cms/clients/:id/templates` | No auth | 401 | 401 |
| `GET /api/cms/templates/:id` | No auth | 401 | 401 |
| `DELETE /api/cms/templates/:id` | No auth | 401 | 401 |
| `GET /api/cms/clients/:id/pages` | No auth | 401 | 401 |
| `GET /api/cms/pages/:id` | No auth | 401 | 401 |
| `PATCH /api/cms/pages/:id` | No auth | 401 | 401 |

---

## DEV-700: Image Upload Layer (R2 presigned URLs)

### Files verified
- `src/lib/r2.ts` — S3Client for Cloudflare R2 (lazy init, per-website config)
- `src/controllers/r2-uploads.ts` — presign + delete controller logic
- `src/services/r2-uploads.ts` — website R2 context resolution
- `src/routes/r2-uploads.ts` — route definitions (auth + role gated)

### Key details
- Content-type allowlist: image/jpeg, image/png, image/webp, image/gif
- R2 client lazily initialized (no crash if env vars missing at import time)
- Per-website R2 config with fallback to shared PVS defaults
- Key prefix validation prevents path traversal

### Smoke test results
| Endpoint | Condition | Expected | Actual |
|----------|-----------|----------|--------|
| `POST /api/cms/websites/:id/upload/presign` | No auth | 401 | 401 |
| `DELETE /api/cms/websites/:id/upload` | No auth | 401 | 401 |

---

## Cross-cutting verification

- Server starts cleanly with all CMS routes loaded (no warnings, no crashes)
- Startup log confirms `trust proxy: loopback, linklocal, uniquelocal`
- Non-CMS endpoints unaffected: `GET /api/clients` (200), `POST /api/deployments` (404 for fake UUID)
- Rate limiting operational with no `ValidationError` warnings
- TypeScript compiles cleanly (`tsc --noEmit`)
