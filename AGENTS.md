# AGENTS

## Overview

-   Pixelverse Studios Server is an Express + TypeScript API that proxies CRUD operations to Supabase tables and sends transactional email via Gmail OAuth.
-   `src/server.ts` wires middleware and mounts routers for clients, newsletter, CMS, and contact-form submissions. Every route should call into a controller in `src/controllers`.
-   Supabase access is centralized in `src/lib/db.ts`, which exposes a preconfigured client plus `Tables`/`COLUMNS` enums so table and column names stay consistent.
-   Email notifications are generated in `src/lib/mailer.ts` and `src/utils/mailer`, primarily for contact-form submissions.

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
| `/api/leads` | POST | Validate, persist, and email new lead submissions from the frontend honeypot form. | `controllers/leads.createLead` |
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

> `routes/recaptcha.ts` is currently a placeholder; wire it before exposing any verification endpoint.

## Data + External Services

-   **Supabase**
    -   Tables in use: `clients`, `cms`, `newsletter`, `contact_form_submissions`, `websites`, `leads`.
    -   Always import `Tables` and `COLUMNS` from `src/lib/db.ts` to avoid string literals.
    -   Use `db.from(...).select()` and `.eq(...)` rather than raw SQL. Controllers typically `await` and throw Supabase errors so `handleGenericError` can respond with `500`.
-   **Email (Gmail OAuth2)**
    -   `sendContactSubmissionEmail` in `src/lib/mailer.ts` requests an access token from Google and dispatches HTML + plaintext using templates from `src/utils/mailer/emails.ts`.
    -   `process.env.NODE_ENVIRONMENT === 'development'` forces contact-form mail to `info@pixelversestudios.io`; adjust if changing environment semantics.
-   **Resend Notifications**
    - Lead submissions use the Resend API (`src/controllers/leads.ts`) to notify the ops team. Configure `RESEND_API_KEY`, `LEAD_NOTIFY_TO`, and optionally `LEAD_NOTIFY_FROM`.
-   **Lead Intake Flow**
    - `/api/leads` intentionally bypasses shared services and calls Supabase REST + Resend directly from the controller for clarity. Keep that file in sync if you expand lead handling.
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
| `NODE_ENVIRONMENT` | Controls dev-mode email fallback (set to `development` locally). |
| `TOKEN_SECRET` | Shared secret for JWT helpers in `src/utils/token.js` (legacy). |
| `TOKEN_EXPIRE` | Lifetime for generated JWTs (legacy, defaults to `24hr`). |
| `GOOGLE_OAUTH_ID`, `GOOGLE_OAUTH_SECRET`, `GOOGLE_REFRESH_TOKEN`, `EMAIL_USER` | Required only if using legacy CommonJS mailer utilities. |
| `RESEND_API_KEY` | Resend API token for lead notifications. |
| `LEAD_NOTIFY_TO` | Comma-separated recipient list for lead notifications (defaults to ops@pixelversestudios.io). |
| `LEAD_NOTIFY_FROM` | Optional override for the Resend “from” address. |

Store secrets outside version control. For Supabase service keys, restrict to necessary tables.

## Testing & Validation

-   No automated tests ship with this repo (`npm test` exits). Use Postman/Insomnia or curl to exercise routes and inspect Supabase tables for persistence.
-   When modifying email flows, run locally with test credentials and monitor console logs from nodemailer.
-   For new features, document manual test steps in PR descriptions until a testing strategy is added.

## Known Gaps / TODOs

-   `services/clients.getClientEmail` logs results but does not return anything; verify intent before using.
-   `routes/recaptcha.ts` lacks implementation.
-   Legacy `models/` and some utilities point to MongoDB and JWT flows that are not wired into the current Supabase-based server. Remove or update once migrations are complete.
-   No rate limiting or authentication is currently guarding endpoints; exercise caution when exposing publicly.

## Audit Trail

-   Lead creation logs `id` and `email` to STDOUT after the Supabase insert succeeds; aggregate these logs centrally if compliance requires retention.
-   Supabase’s `leads` table records `ip`, `user_agent`, and `created_at`, providing a persistent trail for submissions.
-   Email notifications via Resend include the lead id and timestamp so operators can cross-reference inbox events with database records.

## When Adding Features

1. Extend or create a controller and route under `src/routes` with appropriate validation.
2. Touch Supabase via `src/services` or directly in the controller, handling `{ data, error }` results explicitly.
3. Add/update email templates if user-facing communication changes.
4. Document any new environment variables in this file and the deployment environment.
5. Smoke-test using `npm run start` and manual API calls.

Keep this document up to date whenever the API surface, environment requirements, or workflows change.
