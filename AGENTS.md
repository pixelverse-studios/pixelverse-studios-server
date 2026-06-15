# AGENTS

## Overview

-   Pixelverse Studios Server is an Express + TypeScript API that proxies CRUD operations to Supabase tables and sends transactional email via Gmail OAuth.
-   `src/server.ts` wires middleware and mounts routers for clients, newsletter, CMS, and contact-form submissions. Every route should call into a controller in `src/controllers`.
-   Supabase access is centralized in `src/lib/db.ts`, which exposes a preconfigured client plus `Tables`/`COLUMNS` enums so table and column names stay consistent.
-   Email notifications are generated in `src/lib/mailer.ts` and `src/utils/mailer`, primarily for contact-form submissions. Ops alerts for lead intake, audit requests, and Calendly bookings are sent to Slack through `src/lib/slack-notifier.ts`.

## Local Development

1. Install dependencies (already checked in via `package-lock.json`):
    ```bash
    npm install
    ```
2. Create a `.env` alongside `package.json` with the variables listed under **Environment Variables**.
3. Start the API:
    ```bash
    npm run start     # single-run with ts-node
    npm run serve     # live reload via nodemon
    ```
4. Server listens on `http://localhost:<PORT>` (defaults to `3000`). Supabase and Gmail credentials must be valid or requests will fail.

## Project Layout

-   `src/server.ts` – Express bootstrap, middleware, and error handler.
-   `src/routes/` – Route definitions + validation middleware. New endpoints should live here.
-   `src/controllers/` – Business logic per domain (clients, newsletter, CMS, contact-forms) pulling data through Supabase or services.
-   `src/services/` – Thin data-services for reusable Supabase queries (e.g., websites, contact-forms). Prefer adding shared queries here.
-   `src/lib/` – Infrastructure adapters (Supabase client, Gmail transporter).
-   `src/utils/` – Helper utilities (error handling, email templates, legacy token helpers).
-   `models/` – Legacy Mongoose schemas; currently unused but still referenced historically. Avoid modifying unless migrating back to Mongo.

## API Surface

All routes use JSON bodies and respond with JSON. Reuse `validateRequest` when adding inputs.

| Route | Method | Description | Controller |
| --- | --- | --- | --- |
| `/api/leads` | POST | Validate, persist, and notify ops about new lead submissions from the frontend honeypot form. | `controllers/leads.createLead` |
| `/api/clients` | GET | List all clients. | `controllers/clients.getAll` |
| `/api/clients/new` | POST | Create client (`client`, `client_slug`, `active`, `cms`). | `controllers/clients.add` |
| `/api/clients/:id` | PATCH | Update `client` or `active`. | `controllers/clients.edit` |
| `/api/clients/:id` | DELETE | Remove client. | `controllers/clients.remove` |
| `/api/newsletter` | GET | List newsletter subscribers. | `controllers/newsletter.getAll` |
| `/api/newsletter/:clientSlug` | POST | Add subscriber for client slug. | `controllers/newsletter.add` |
| `/api/cms` | GET | Fetch all CMS entries. | `controllers/cms.get` |
| `/api/cms/:clientSlug` | GET | Fetch CMS entries for client slug. | `controllers/cms.getById` |
| `/api/cms/:clientSlug/active` | GET | Active CMS entries for client slug. | `controllers/cms.getActiveById` |
| `/api/cms/:id` | POST | Add CMS page for client (param `id` is client id). | `controllers/cms.add` |
| `/api/cms/:id` | PATCH | Update CMS entry. | `controllers/cms.edit` |
| `/api/cms/:id` | DELETE | Delete CMS entry. | `controllers/cms.remove` |
| `/api/v1/contact-forms` | GET | Retrieve all submissions. | `controllers/contact-forms.getAll` |
| `/api/v1/contact-forms/:website_slug` | POST | Create submission and trigger email. | `controllers/contact-forms.addRecord` |
| `/api/audit` | POST | Capture Free Website Audit submissions, persist to Supabase, and notify ops. | `controllers/audit.createAuditRequest` |
| `/api/media-admin/auth/magic-link` | POST | Request a media admin magic link for approved emails without revealing approval status. | `controllers/media-admin-auth.requestMagicLink` |
| `/api/media-admin/auth/callback` | POST | Exchange a one-time magic-link token for an HTTP-only media admin session cookie. | `controllers/media-admin-auth.callback` |
| `/api/media-admin/auth/session` | GET | Return the current media admin session when the session cookie is valid. | `controllers/media-admin-auth.getSession` |
| `/api/media-admin/auth/logout` | POST | Revoke the current media admin session and clear the cookie. | `controllers/media-admin-auth.logout` |
| `/api/media/:websiteSlug/catalog` | GET | Fetch published media catalog items for a website. | `controllers/media.getPublicCatalog` |
| `/api/media/:websiteSlug/admin/catalog` | GET | Fetch full media catalog for authenticated media admins. | `controllers/media.getAdminCatalog` |
| `/api/media/:websiteSlug/admin/objects` | GET | List Cloudflare R2 objects by optional prefix for authenticated media admins. | `controllers/media.listObjects` |
| `/api/media/:websiteSlug/admin/revalidate` | POST | Trigger the configured frontend cache revalidation webhook for public media pages. | `controllers/media.revalidateCatalog` |
| `/api/media/:websiteSlug/admin/objects/check-destination` | POST | Check catalog and R2 destination collisions before moving media. | `controllers/media.checkDestination` |
| `/api/media/:websiteSlug/admin/items` | POST | Create a draft media catalog item after upload. | `controllers/media.createCatalogItem` |
| `/api/media/:websiteSlug/admin/items/batch` | POST | Create multiple draft media catalog items after direct uploads and return per-file success/failure results. | `controllers/media.batchCreateCatalogItems` |
| `/api/media/:websiteSlug/admin/items/:id/move` | POST | Safely move/rename a draft R2 object and update its catalog record. | `controllers/media.moveCatalogItem` |
| `/api/media/:websiteSlug/admin/items/:id` | PATCH | Update safe media catalog metadata for authenticated media admins. | `controllers/media.updateCatalogItem` |
| `/api/media/:websiteSlug/admin/uploads/presign` | POST | Create a protected, short-lived Cloudflare R2 direct-upload URL. | `controllers/media.presignUpload` |

> `routes/recaptcha.ts` is currently a placeholder; wire it before exposing any verification endpoint.

## Data + External Services

-   **Supabase**
    -   Tables in use: `clients`, `cms`, `newsletter`, `contact_form_submissions`, `websites`, `leads`, `audit_requests`, `media_r2_configs`, `media_catalog_items`, `media_audit_logs`, `media_admin_magic_links`, `media_admin_sessions`.
    -   Always import `Tables` and `COLUMNS` from `src/lib/db.ts` to avoid string literals.
    -   Use `db.from(...).select()` and `.eq(...)` rather than raw SQL. Controllers typically `await` and throw Supabase errors so `handleGenericError` can respond with `500`.
-   **Email (Gmail OAuth2)**
    -   `sendContactSubmissionEmail` in `src/lib/mailer.ts` requests an access token from Google and dispatches HTML + plaintext using templates from `src/utils/mailer/emails.ts`.
    -   `process.env.NODE_ENVIRONMENT === 'development'` forces contact-form mail to `info@pixelversestudios.io`; adjust if changing environment semantics.
-   **Slack Ops Notifications**
    - Lead submissions, audit requests, and Calendly bookings send non-blocking ops alerts through `src/lib/slack-notifier.ts`. Configure `OPS_NOTIFY_SLACK_WEBHOOK` with the incoming webhook URL for the shared intake alerts channel.
    - Slack alert content should stay customer-facing. Do not include internal ids, prospect ids, attribution JSON, or reporting metadata unless a ticket explicitly changes that requirement.
-   **Resend Campaign Email**
    - Email campaign sends use the Resend API through `src/lib/resend-mailer.ts`. Configure `RESEND_API_KEY` when using campaign email features.
-   **Lead Intake Flow**
    - `/api/leads` persists prospect and lead submission data before dispatching a non-blocking Slack notification. Keep Slack notification content customer-facing unless internal attribution/reporting fields are intentionally added.
-   **Prospect Attribution Reporting**
    - Campaign attribution is internal-only. Inspect full sanitized JSON on nested conversion rows returned by `GET /api/prospects/:id` and in `v_leads_detail`, `v_audits_detail`, and `v_calendly_detail`.
    - `v_prospects_all` exposes only lightweight latest-attribution scalar fields for list/reporting views: source, medium, campaign, and conversion type.
-   **Legacy Nodemailer Utilities**
    -   Files in `src/utils/mailer/**` and `src/utils/token.js` are CommonJS modules dating back to the Mongo implementation. Confirm usage before refactoring; some may be dead code.

## Coding Guidelines for Agents

-   Default to TypeScript within `src/`. When touching CommonJS utilities, ensure interop does not break ts-node.
-   Follow existing layering: routes → controllers → services/lib. Keep controllers thin and move cross-cutting Supabase logic into `src/services`.
-   Validate all incoming data using `express-validator` and re-use `validateRequest`.
-   Preserve centralized error handling by throwing or returning errors to `handleGenericError`.
-   When adding Supabase queries, prefer `.select().eq()` chaining and always handle `error` alongside `data`.
-   Use `async/await` consistently; avoid mixing Promise chains.
-   Keep `Tables`/`COLUMNS` enums in sync with Supabase schema before referencing new columns.
-   Update or add email templates alongside business logic when new notifications are required.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `PORT` | Express listen port (defaults to `3000`). |
| `SUPABASE_URL` | Supabase project REST URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Preferred service-role key for Supabase access (falls back to `SUPABASE_SERVICE_ROLE_KEY`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Legacy Supabase anon key fallback. |
| `GMAIL_USER` | Gmail address used as sender. |
| `GMAIL_CLIENT_ID` | Google OAuth client id. |
| `GMAIL_CLIENT_SECRET` | Google OAuth client secret. |
| `GMAIL_REFRESH_TOKEN` | Refresh token for Gmail OAuth workflow. |
| `GMAIL_APP_PASSWORD` | Gmail app password used by the current Nodemailer transporter. |
| `NODE_ENVIRONMENT` | Controls dev-mode email fallback (set to `development` locally). |
| `TOKEN_SECRET` | Shared secret for JWT helpers in `src/utils/token.js` (legacy). |
| `TOKEN_EXPIRE` | Lifetime for generated JWTs (legacy, defaults to `24hr`). |
| `GOOGLE_OAUTH_ID`, `GOOGLE_OAUTH_SECRET`, `GOOGLE_REFRESH_TOKEN`, `EMAIL_USER` | Required only if using legacy CommonJS mailer utilities. |
| `RESEND_API_KEY` | Resend API token for email campaign sends. |
| `OPS_NOTIFY_SLACK_WEBHOOK` | Slack incoming webhook URL for shared ops intake alerts covering leads, audit requests, and Calendly bookings. |
| `R2_ACCESS_KEY_ID` | Server-only Cloudflare R2 S3 access key for future media manager object operations. |
| `R2_SECRET_ACCESS_KEY` | Server-only Cloudflare R2 S3 secret key for future media manager object operations. |
| `R2_ACCOUNT_ID` | Cloudflare account id for future R2 S3-compatible API calls. |
| `R2_BUCKET_NAME` | Fallback Cloudflare R2 bucket name for media manager features when no per-client config exists. |
| `R2_PUBLIC_BASE_URL` | Fallback public base URL for R2 media objects when no per-client config exists. |
| `R2_PRESIGN_EXPIRES_SECONDS` | Optional R2 presigned upload expiry; defaults to 900 seconds. |
| `R2_CONNECTION_TIMEOUT_MS` | Optional R2 S3 connection timeout; defaults to 2000ms. |
| `R2_REQUEST_TIMEOUT_MS` | Optional R2 S3 request timeout; defaults to 8000ms. |
| `MEDIA_MAX_UPLOAD_BYTES` | Optional maximum media upload size; defaults to 25MB. |
| `MEDIA_UPLOAD_BATCH_MAX_ITEMS` | Optional maximum batch draft-completion item count; defaults to 10. |
| `MEDIA_DB_LATENCY_WARN_MS` | Optional Supabase media mutation DB latency warning threshold; defaults to 1000ms. |
| `MEDIA_ADMIN_EMAILS` | Comma-separated approved media manager admin email addresses. |
| `MEDIA_ADMIN_APP_BASE_URL` | Frontend base URL used when generating media admin magic links. |
| `MEDIA_ADMIN_MAGIC_LINK_TTL_MINUTES` | Optional magic-link expiry window; defaults to 15 minutes. |
| `MEDIA_ADMIN_MAGIC_LINK_REQUEST_COOLDOWN_SECONDS` | Optional cooldown for suppressing duplicate magic-link sends while returning the generic public response; defaults to 60 seconds. |
| `MEDIA_ADMIN_MAGIC_LINK_RATE_LIMIT_SECONDS` | Optional email-level magic-link request rate limit; defaults to disabled. |
| `MEDIA_ADMIN_MAGIC_LINK_CLOCK_SKEW_SECONDS` | Optional grace window for magic-link expiry checks; defaults to 120 seconds. |
| `MEDIA_ADMIN_SESSION_TTL_HOURS` | Optional media admin session duration; defaults to 12 hours. |
| `MEDIA_ADMIN_REQUEST_MIN_RESPONSE_MS` | Optional minimum response time for media admin magic-link requests; defaults to 350ms to reduce email approval probing. |
| `MEDIA_ADMIN_COOKIE_DOMAIN` | Optional session cookie domain for cross-subdomain deployments. |
| `MEDIA_ADMIN_COOKIE_SAME_SITE` | Optional session cookie SameSite value (`lax`, `strict`, or `none`); defaults to `lax`. |
| `MEDIA_REVALIDATION_WEBHOOK_URL` | Optional frontend webhook URL called after public media catalog changes or manual admin revalidation. |
| `MEDIA_REVALIDATION_SECRET` | Optional bearer token sent to the frontend revalidation webhook. |
| `MEDIA_REVALIDATION_TIMEOUT_MS` | Optional revalidation webhook timeout; defaults to 5000ms. |
| `MEDIA_PUBLIC_CATALOG_MAX_AGE_SECONDS` | Optional public catalog `Cache-Control` max-age; defaults to 60 seconds. |
| `MEDIA_PUBLIC_CATALOG_STALE_WHILE_REVALIDATE_SECONDS` | Optional public catalog stale-while-revalidate window; defaults to 300 seconds. |

Store secrets outside version control. For Supabase service keys, restrict to necessary tables.

## Testing & Validation

-   Run `npm test` to execute the Vitest suite once. Tests live under `test/**/*.test.ts` and use `test/setup.ts` to reset external-service environment variables and block unmocked `fetch` calls by default.
-   Run `npm run build` to verify the TypeScript compile.
-   Pull requests targeting `main`, `dev/**`, or `dev-*` run the `API CI` GitHub Actions workflow. CI installs with `npm ci`, then runs `npm run build` and `npm test`.
-   Slack/webhook tests must mock network calls and must not use real webhook URLs or secrets. Use test-only URLs such as `https://hooks.slack.test/...`.
-   Supabase, Gmail, Resend, Calendly, and Slack integrations should be mocked in unit and controller tests unless a ticket explicitly scopes live-environment QA.
-   For manual endpoint QA, use Postman/Insomnia or curl with test payloads and inspect Supabase only when the ticket explicitly requires persistence verification.

## Known Gaps / TODOs

-   `services/clients.getClientEmail` logs results but does not return anything; verify intent before using.
-   `routes/recaptcha.ts` lacks implementation.
-   Legacy `models/` and some utilities point to MongoDB and JWT flows that are not wired into the current Supabase-based server. Remove or update once migrations are complete.
-   No rate limiting or authentication is currently guarding endpoints; exercise caution when exposing publicly.

## Audit Trail

-   Lead creation logs `id` and `email` to STDOUT after the Supabase insert succeeds; aggregate these logs centrally if compliance requires retention.
-   Supabase’s `leads` table records `ip`, `user_agent`, and `created_at`, providing a persistent trail for submissions.
-   Slack notifications intentionally include customer-facing submission details only; internal ids and attribution metadata stay in Supabase/reporting views unless explicitly added to an alert.
-   Media catalog mutations attempt non-blocking inserts into `media_audit_logs` through `src/services/media-audit.ts`. Audit write failures are logged to STDERR and do not roll back the already-completed media mutation.
-   Public media catalog mutations trigger a non-blocking frontend revalidation webhook through `src/services/media-revalidation.ts` when `MEDIA_REVALIDATION_WEBHOOK_URL` is configured. Webhook failures are logged to STDERR and do not roll back the already-completed media mutation.

## When Adding Features

1. Extend or create a controller and route under `src/routes` with appropriate validation.
2. Touch Supabase via `src/services` or directly in the controller, handling `{ data, error }` results explicitly.
3. Add/update email templates if user-facing communication changes.
4. Document any new environment variables in this file and the deployment environment.
5. Run `npm test` and `npm run build`; add or update focused tests for changed behavior.
6. Smoke-test using `npm run start` and manual API calls when the change needs live route validation.

Keep this document up to date whenever the API surface, environment requirements, or workflows change.
