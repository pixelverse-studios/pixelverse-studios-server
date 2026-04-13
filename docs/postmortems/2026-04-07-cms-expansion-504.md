# Postmortem: CMS Expansion Deploy Failure (504 Gateway Timeout)

**Date of incident:** 2026-04-07
**Severity:** High (production endpoint unavailable)
**Duration:** ~9 hours (merge 10:13 AM EDT, revert 7:16 PM EDT)
**Affected endpoint:** `POST /api/deployments` (504 Gateway Timeout)
**Ticket:** DEV-697
**Related:** DEV-677 (restoration epic), PR #104 (merge), commit `03bf050` (revert)

---

## Timeline

| Time (EDT) | Event |
|------------|-------|
| Apr 6, 10:12 PM | PRs #89-#94 merged to `dev/cms-expansion` (DB schema, RLS, auth, branding, users, templates) |
| Apr 7, 6:05-9:58 AM | PRs #95-#103 merged to `dev/cms-expansion` (seeds, hostname resolver, R2 uploads, pages, route deprecation, sanitization, rate limiting) |
| Apr 7, 10:13 AM | PR #104 merges `dev/cms-expansion` into `main` (50 files, +8032 lines) |
| Apr 7, ~10:15 AM | DigitalOcean auto-deploy triggered |
| Apr 7, (unknown) | `POST /api/deployments` starts returning 504 Gateway Timeout |
| Apr 7, 7:16 PM | Revert commit `03bf050` restores service |

---

## What Changed in PR #104

The merge brought 15 PRs worth of changes into production simultaneously:

### New dependencies
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (~3.2MB + transitive deps)
- `express-rate-limit` v8.3.2
- `jsonwebtoken` v9.0.3

### New infrastructure
- `app.set('trust proxy', 1)` added to `server.ts`
- `generalApiLimit` rate limiter applied as global middleware (before all routes)
- 6 new route files (cms-users, cms-templates, cms-pages, website-domains, r2-uploads, auth-middleware)
- 2 new lib files (`src/lib/auth.ts`, `src/lib/r2.ts`)

### Import-time side effects
- `src/lib/r2.ts`: reads `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` at module load. Uses lazy `getClient()` so the S3Client is not instantiated until first use. **No crash on missing vars.**
- `src/lib/auth.ts`: reads `SUPABASE_JWT_SECRET` and `SUPABASE_URL` at module load. Returns empty strings on missing vars, defers error to runtime. **No crash on missing vars.**

---

## Root Cause Analysis

### Primary hypothesis: `trust proxy` + `generalApiLimit` interaction on DigitalOcean App Platform

**Confidence: HIGH**

The `generalApiLimit` middleware was applied globally in `server.ts` before all routes, including `POST /api/deployments`. This rate limiter uses the default `keyGenerator` which keys on `req.ip`.

The merge also added `app.set('trust proxy', 1)`, which tells Express to trust exactly one proxy hop when reading `X-Forwarded-For`. This changes how `req.ip` is resolved.

**The problem:** DigitalOcean App Platform uses a multi-layer proxy topology. Setting `trust proxy` to `1` assumes exactly one proxy between the client and the server. If DO uses 2+ proxy hops (load balancer + internal router), `req.ip` can resolve incorrectly or return `undefined` depending on how `X-Forwarded-For` is populated.

When `req.ip` is `undefined`:
- The default `keyGenerator` in `express-rate-limit` v7+ groups ALL requests under the same bucket (the string `"undefined"`)
- With `max: 200` per minute and all traffic sharing one bucket, legitimate requests quickly exhaust the limit
- Rate-limited requests receive a 429, but DigitalOcean's reverse proxy may surface this as a **504 Gateway Timeout** depending on how the response is interpreted by the health check and routing layer

**Evidence:**
- The `userOrIpKey` function explicitly guards against `undefined` req.ip with a throw, showing the developer was aware of this risk on CMS routes
- The `generalApiLimit` does NOT have this guard — it uses the default keyGenerator which silently accepts `undefined`
- The 504 specifically hit `POST /api/deployments`, which is a non-CMS route that goes through `generalApiLimit` but not the CMS-specific limiters
- The code comment on `trust proxy` mentions "Render/Fly/etc." but not DigitalOcean, suggesting the value was not validated against DO's topology

### Secondary hypothesis: Build OOM / slow startup from `@aws-sdk/client-s3`

**Confidence: MEDIUM**

`@aws-sdk/client-s3` is a heavy dependency (~3.2MB direct, 50+ transitive packages). On DigitalOcean's default build container:
- `npm install` takes significantly longer
- The build may OOM on memory-constrained containers
- Even if the build succeeds, the increased `node_modules` size may slow cold starts past DO's health check timeout

If the app failed to start within DO's health check window, the platform would route traffic to a stale container or return 504 to all incoming requests.

**Evidence:**
- No build/deploy logs were captured to confirm or deny
- The `@aws-sdk` packages are known to cause OOM on constrained CI/CD environments
- The server uses `ts-node` for production (`npm run start` = `ts-node src/server.ts`), meaning TypeScript compilation happens at startup, compounding the cold-start penalty

### Tertiary hypothesis: Missing environment variables causing silent failures

**Confidence: LOW**

The new code requires several env vars not present in the pre-CMS deployment:
- `SUPABASE_JWT_SECRET` (auth middleware)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (R2 uploads)
- `BLAST_SECRET` (rate limit bypass for internal services)

However, all of these fall back to empty strings or `undefined` gracefully at import time. They would only cause errors when the new CMS endpoints are actually called, not on existing endpoints like `POST /api/deployments`.

**This hypothesis is unlikely to explain the 504 on its own** but could compound with other issues.

---

## Recommended Fix

### Before any restoration slice ships:

1. **Validate `trust proxy` against DigitalOcean App Platform**
   - Deploy a minimal test app with `trust proxy` set to `1`, `true`, and `'loopback, linklocal, uniquelocal'`
   - Log `req.ip`, `req.ips`, and `req.headers['x-forwarded-for']` for each setting
   - Determine the correct value for DO's proxy topology
   - Alternatively, use DO's documentation or support to confirm the proxy hop count

2. **Guard the `generalApiLimit` keyGenerator against `undefined` req.ip**
   ```typescript
   // In generalApiLimit config, add explicit keyGenerator:
   keyGenerator: (req: Request): string => {
       return req.ip || req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || 'unknown'
   }
   ```

3. **Add a startup health check log** to `server.ts` that logs `trust proxy` config and confirms the server is ready before DO's health check runs.

4. **Consider pre-compiling TypeScript** instead of using `ts-node` in production. Add a `build` script (`tsc`) and a `start:prod` script (`node dist/server.js`) to reduce cold-start time and memory usage.

### Restoration order (per DEV-677):

Each slice should be deployed and verified before the next. The rate limiting fix (trust proxy + keyGenerator guard) should be applied in the **first** slice (DEV-698, auth layer) since it affects all routes.

---

## Verification Plan

Before re-deploying:

1. Set up a staging DO app that mirrors production config
2. Apply the `trust proxy` fix
3. Deploy with the first restoration slice
4. Smoke test: `POST /api/deployments`, `GET /api/clients`, `POST /api/leads/new`
5. Monitor for 30 minutes: memory, CPU, error rate, response times
6. Confirm `req.ip` resolves correctly in logs

---

## Lessons Learned

1. **Never merge 15 PRs worth of changes in a single deploy.** The CMS expansion was developed entirely on a dev branch with no incremental production deployments. When it hit production, the blast radius was too large to diagnose quickly.

2. **Validate proxy topology before deploying rate limiters.** `trust proxy` behavior varies significantly across hosting platforms. A value that works on one platform can break another.

3. **Production should not use `ts-node`.** TypeScript compilation at startup adds memory overhead and increases cold-start time, making health check timeouts more likely.

4. **Deploy logs must be captured.** The investigation was hampered by the lack of DO deploy logs. Set up log retention or alerting for deploy failures.
