# AGENTS

## Overview

- Pixelverse Studios Server is a TypeScript + Express REST API backed by Supabase.
- The server manages clients, CMS content, contact forms, newsletter subscribers, leads, audit requests, website domains, deployment tracking, and related notifications.
- Architecture is layered: routes -> controllers -> services/lib.
- `src/server.ts` mounts routers and shared middleware. New endpoints should be registered there before the error handler.

## Critical Rules

### Branches and Deploys

- `main` auto-deploys to production via DigitalOcean App Platform.
- `staging` auto-deploys to staging via DigitalOcean App Platform.
- Never push directly to `main` or `staging` without explicit approval from Phil.
- Never merge into `main` or `staging` without explicit approval from Phil.
- Never force-push, rewrite history, or run destructive git recovery on `main` or `staging`.
- Normal engineering flow is feature branch -> epic branch -> `dev/{milestone-slug}`. Promotion to `staging` and `main` is Phil's decision.

### Local Testing Protocol

- Port `5001` is treated as the normal running app port. Do not use it for agent-driven test runs.
- For manual test runs, temporarily switch `.env` `PORT` to `5002` or another unused test port.
- Start the app on the test port, exercise the endpoint, then kill the test server and restore `.env` to `5001`.
- `npm test` is still a placeholder and does not provide automated coverage.

## Project Layout

- `src/server.ts` - Express bootstrap, trust proxy, router mounting, error handling, shutdown hooks.
- `src/routes/` - Express routes, validation, auth middleware, rate-limit wiring.
- `src/controllers/` - Business logic per domain.
- `src/services/` - Thin Supabase data-access layer and reusable domain queries.
- `src/lib/` - Infrastructure adapters such as Supabase, auth, mailer, R2, and webhook processing.
- `src/utils/` - Shared helpers like `escapeHtml`, hostname parsing, validation helpers, and HTTP error utilities.
- `supabase/migrations/` - Forward-only schema changes. Do not rewrite or reorder old migrations.
- `docs/audits/`, `docs/runbooks/`, `docs/postmortems/` - Operational references and incident history.

## Core Stack

- Runtime: Node.js + TypeScript
- Framework: Express 4
- Database: Supabase / Postgres
- Auth: Supabase JWT verified locally
- Validation: `express-validator` and `zod`
- Email: Gmail via nodemailer App Password, optional Resend, optional Discord alerts
- Storage: Cloudflare R2 for CMS image uploads
- Durable webhooks: `pending_webhook_events` + `src/lib/webhook-processor.ts`

## Routing and Layering

- Keep the flow `route -> controller -> service/lib`.
- Routes define endpoints and validation middleware only.
- Controllers orchestrate business logic, call services/lib, and shape responses.
- Services handle Supabase access and shared domain queries. Keep them thin.
- Prefer `async/await` consistently. Do not mix callbacks or Promise chains unless required by a dependency.
- Use `handleGenericError` for centralized error responses.

## Authentication and Rate Limiting

- `src/routes/auth-middleware.ts` contains the shared CMS auth middleware:
  - `requireAuth`
  - `requireCmsAccess`
  - `requirePvsAdmin`
- CMS routes are no longer universally public. Do not assume the whole API is unauthenticated.
- `src/routes/rate-limits.ts` defines limiter tiers including:
  - `publicReadLimit`
  - `authReadLimit`
  - `authWriteLimit`
  - `sensitiveWriteLimit`
  - `webhookWriteLimit`
  - `generalApiLimit`
- Mount auth-keyed limiters after `requireAuth`, otherwise the limiter falls back to IP-based keying.

## Current API Surface

The repo contains legacy public routes plus newer authenticated CMS and deployment endpoints. Check `src/routes/` for the authoritative surface. Key domains include:

- `clients`
- `newsletter`
- `cms`
- `contact-forms`
- `leads`
- `audit-requests`
- `deployments`
- `website-domains`
- `cms-pages`
- `cms-templates`
- `client-users`
- `r2-uploads`

When documenting or extending routes, prefer pointing at the route files instead of duplicating full endpoint tables that can drift.

## Data and External Services

### Supabase

- Import `db`, `Tables`, and `COLUMNS` from `src/lib/db.ts`.
- Do not introduce string literals for table or column names when enums already exist.
- Prefer chained query builders like `.select()`, `.eq()`, `.insert()`, `.update()`, `.delete()`.
- Always inspect `{ data, error }` and throw or handle errors explicitly.

### Durable Webhook Queue

- Deployment webhooks are treated as irrecoverable inputs.
- Persist webhook payloads to `pending_webhook_events` before fallible processing when following the deployment pattern.
- Retry behavior and polling live in `src/lib/webhook-processor.ts`.
- `WEBHOOK_PROCESSOR_ENABLED` should be used carefully if the app is scaled horizontally.

### Email and Notifications

- PVS transactional email uses `src/lib/mailer.ts` with Gmail App Password credentials.
- Resend is available for optional alternate sending paths.
- Discord webhooks are used for some ops notifications and fallback alerting.
- Always escape user-provided values before injecting them into HTML email templates.
- Always provide plaintext email content alongside HTML.
- Legacy CommonJS mailer/token utilities still exist; confirm usage before refactoring them.

### Website Domains and CMS

- `website_domains` maps hostnames to websites and supports tenant resolution for the CMS dashboard.
- `cms_slug` is used for dashboard subdomains like `{cms_slug}.cms.pixelversestudios.io`.
- Cloudflare R2 signed upload URLs are used for CMS asset flows.

## Coding Guidelines for Agents

- Default to TypeScript for anything under `src/`.
- Follow existing naming and file patterns. This repo uses kebab-case filenames under `src/`.
- Reuse existing middleware and helpers before inventing new patterns.
- Validate all incoming data. Use `express-validator` for straightforward request validation and `zod` for more complex payloads.
- Keep controllers thin and move reusable Supabase logic into `src/services`.
- Keep `Tables` and `COLUMNS` in sync before referencing new schema elements.
- Preserve centralized error handling and explicit HTTP status behavior.
- Do not add new auth or permission behavior without documenting it here and in `CLAUDE.md`.
- Do not use synchronous file operations in request handlers.

## Canonical Implementation References

Use existing domains as patterns instead of copying large examples into this file:

- Simple public endpoint with service/controller/route pattern: `src/{services,controllers,routes}/leads.ts`
- Authenticated CMS route pattern: `src/{services,controllers,routes}/cms-templates.ts`
- Hostname resolution pattern: `src/{services,controllers,routes}/website-domains.ts`
- Durable webhook pattern: `src/controllers/deployments.ts` and `src/lib/webhook-processor.ts`

## Environment Variables

The authoritative list is `.env.example`. The most important groups are:

- Server: `PORT`, `NODE_ENVIRONMENT`
- Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
- Gmail: `GMAIL_USER`, `GMAIL_APP_PASSWORD`
- Webhook processor: `WEBHOOK_PROCESSOR_ENABLED`
- R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_DEFAULT_BUCKET`, `R2_DEFAULT_PUBLIC_BASE_URL`
- Internal bypass/ops: `BLAST_SECRET`, `DISCORD_WEBHOOK_URL`
- Optional senders/integrations: `RESEND_API_KEY`, `CALENDLY_API_TOKEN`, `NYLAS_API_KEY`, `NYLAS_GRANT_ID`
- Lead notifications: `LEAD_NOTIFY_TO`, `LEAD_NOTIFY_USE_RESEND`, `LEAD_NOTIFY_LOGO_URL`

Store secrets outside version control. When adding a new variable, update both `.env.example` and this file.

## Testing and Validation

- No automated test suite currently ships with the repo.
- Use Postman, Insomnia, or curl against a non-5001 test port.
- Verify persistence in Supabase when changing write paths.
- When changing email flows, verify logs and outbound delivery behavior.
- When changing deployment tracking or webhook durability behavior, inspect `pending_webhook_events` and the retry path, not just the immediate HTTP response.

## Known Gaps

- Some legacy CommonJS utilities remain in `src/utils/`.
- `services/clients.getClientEmail` has historically logged results without returning them; confirm behavior before building on it.
- Public/admin boundary coverage remains mixed across older endpoints and newer CMS flows.
- `src/lib/mailer.ts` `markdownToHtml` has a known escaping gap; be cautious with new markdown-backed email content.
- Body size and webhook abuse hardening are still tracked operational concerns.

## When Adding Features

1. Add or extend a service in `src/services/`.
2. Add or extend a controller in `src/controllers/`.
3. Add or extend a route in `src/routes/` with validation.
4. Register the router in `src/server.ts`.
5. Update templates or notifications if the feature changes user-facing email or alerts.
6. Add any new env vars to `.env.example`, `AGENTS.md`, and `CLAUDE.md`.
7. Manually test on a non-5001 port and inspect downstream systems.

## Documentation Rule

- `CLAUDE.md` is the detailed source-of-truth operator manual.
- `AGENTS.md` should remain the concise companion document for agents.
- When project workflows, auth, deployment behavior, or environment requirements change, update both files together so they do not drift again.
