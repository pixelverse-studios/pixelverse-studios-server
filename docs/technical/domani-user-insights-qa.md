# Domani user insights server QA

Evidence date: 2026-09-21. Tickets: DEV-1408 and companion DEV-1411.

## Result

The protected Users list, stats, and detail contract is ready for coordinated preview QA. Automated coverage verifies field semantics, global operations over more than 100 fixtures, staff authorization, safe errors, database grants, deterministic device provenance, and compatibility with the existing campaign and feedback routes. No customer accounts were changed and no email was sent.

## Verified behavior

- List filters, sorting, totals, and pagination execute inside the database before paging. The synthetic SQL harness uses 125 profiles and covers a second page, stable ID tie-breaking, literal wildcard search, providers, verification, account state, activity, platform, app version, and inclusive-start/exclusive-end UTC bounds.
- Missing auth produces `unknown`; missing confirmation produces `unverified`; profile deletion-pending, auth deletion, bans, and active accounts remain distinct. Future client activity is normalized to unknown until it is no longer in the future, so every non-deleted user belongs to exactly one activity filter.
- Latest device data is a whole historical feedback/support snapshot selected by user ID. Equal timestamps use the documented source/ID tie-breaker. An unrelated account with the same email cannot supply the device or feedback count.
- The RPC constructs an explicit top-level and nested-device response projection. Fixtures require exact key equality, so adding any view column cannot silently expand the browser response. `service_role` receives only the required auth columns, while `encrypted_password` remains inaccessible.
- Anonymous and ordinary authenticated roles cannot select the insights views or execute `list_dashboard_domani_users`. The RPC is `SECURITY INVOKER` with an empty search path; both insights views use `security_invoker=true`.
- API routes require a verified staff bearer token, return `Cache-Control: no-store`, bound limit/offset/sort inputs, return safe 401/403/400/503 responses, and preserve the legacy list envelope used by campaign recipients.

## Deployed schema evidence

Read-only checks against Domani project `exxnnlhxcjujxnnwwrxv` confirmed migrations `domani_user_insights` and `domani_feedback_user_filter` are present. Both insights views deny `anon` and `authenticated` and allow `service_role`; the RPC follows the same execution boundary. `service_role` has SELECT only on `auth.identities(user_id, provider)` and the six approved `auth.users` metadata columns, not `encrypted_password`.

The aggregate-only RPC response at `2026-09-21T15:11:41Z` reported 97 profiles, 90 non-deleted, seven deleted, zero recorded activity in 30 days, and 97 without recorded app activity. This confirms that the current dashboard must say “not recorded” rather than “never” and must not imply general device or activity coverage.

Supabase security and performance advisors were also reviewed. They did not flag `list_dashboard_domani_users` or either insights view. Workspace-level findings on unrelated legacy tables/functions remain outside DEV-1408 and should be handled separately rather than broadening this QA ticket.

## Commands

```sh
env PATH=/Users/phil/.nvm/versions/node/v24.14.1/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin npm test -- --run test/domani-users.test.ts test/domani-staff-auth.test.ts test/domani-feedback.test.ts test/mini-session-campaign-controller.test.ts test/mini-session-campaign-routes.test.ts test/mini-session-campaign-service.test.ts
bash supabase/tests/domani_users_test.sh
env PATH=/Users/phil/.nvm/versions/node/v24.14.1/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin npm test
env PATH=/Users/phil/.nvm/versions/node/v24.14.1/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin npm run build
```

## Deployment and rollback

1. Keep the previously deployed migrations in place, then apply `20260921160406_harden_domani_user_activity_projection.sql`.
2. Deploy the server story branch before or together with the UI story branch. Confirm the API has its Domani service credential and PVS staff allowlist/origin configuration.
3. Check list, stats, and detail as an allowed staff user; then verify missing, expired, and nonstaff tokens return 401/403 without database details.
4. Check Users search/filter/sort/page operations and campaign recipient paging. Confirm responses remain `no-store` and contain no tokens, password material, raw identity payloads, IPs, or sessions.
5. Deploy the UI and run the companion preview checklist.

Rollback the API and UI together. Do not undo the restricted grants or reopen the views/RPC to browser roles. The follow-up migration preserves the response shape, only tightens its construction, and can safely remain because it does not mutate source records. If the UI precedes the API, its contract guard fails visibly instead of inventing counts.

## Controlled preview checklist

- [ ] Allowed staff receives list, stats, and detail responses in the deployed preview.
- [ ] Expired token returns 401 and a nonstaff token returns 403.
- [ ] Search, filters, sorting, page 2, totals, and empty results agree with the UI.
- [ ] Campaign recipient selection still pages and searches normally.
- [ ] Browser network payloads contain only the documented projection and `Cache-Control: no-store`.
- [ ] Server logs contain operation/error codes only, never response rows, credentials, or raw identity payloads.

The unchecked items require the coordinated deployed preview and authenticated browser session; local and live-schema verification does not fabricate that evidence.
