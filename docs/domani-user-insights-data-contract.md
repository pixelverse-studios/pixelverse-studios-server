# Domani user insights — discovery and proposed contract

Evidence date: 2026-09-17. Scope: DEV-1406, supporting DEV-1404 and DEV-1405.

This is a read-only discovery of Domani Supabase project `exxnnlhxcjujxnnwwrxv`, the PVS website/server checkouts, and the local Domani mobile checkout. Only schema definitions, grants, policies, and aggregate coverage were queried. No customer record dumps, production mutations, email sends, or mobile changes were made. Proposed fields below are not implemented API guarantees.

## Verified coverage

| Source | Aggregate observation |
| --- | --- |
| `profiles` | 88 records; all have creation timestamps; 5 have `deleted_at`; 81 have `signup_method` (43 Apple, 38 Google), 7 null |
| `profiles.last_active_at` | 0 of 88 populated |
| `auth.users` | 88 records; all have `last_sign_in_at` and `email_confirmed_at`; no current bans or auth-level deletions |
| `auth.identities` | 50 Apple and 39 Google identities; one user has multiple providers |
| `beta_feedback` | 26 records, all with user ID, device model, and app version; 14 distinct users |
| `support_requests` | 7 records, all with user ID, device model, and app version; 3 distinct users |
| Combined feedback/support device coverage | 14 distinct users; not a general device inventory |
| Profile/auth creation times | All differ slightly, maximum about 83 milliseconds; no difference over one minute currently |

The current `profiles_dashboard` definition selects profile ID, email, name, signup cohort/method, timezone, profile creation/deletion/activity timestamps and auth last sign-in through an inner join on user ID. All current auth users have profiles. The view does not contain verification state, linked providers, device metadata, or auth account state.

## Existing behavior and gaps

The server's `src/services/domani.ts#getUsers` selects `*` from `profiles_dashboard`, orders by profile creation descending, and supports cohort, deleted visibility, limit and offset. The website declares user detail/stats helpers but the inspected server Domani router has no matching user detail/stats routes. The website types omit the view's `last_sign_in_at`.

The UI already displays Joined (date only), Last Active, Signup, Cohort, Name and Email. Cohort/search operate on the loaded page, the activity count is only the loaded nondeleted records, and date parameters are sent but not handled by the inspected server service. Expanding columns without correcting server filtering would preserve misleading totals. Unknown activity is currently labeled “Never”; this is incorrect with zero telemetry coverage.

The mobile `src/hooks/useActivityTracking.ts` defines an app-open/foreground update, throttled to one hour using a process-local ref. Its timestamps come from the client, failures are ignored, and the throttle advances before success. A search across mobile `src` found no imports or calls of this hook. This is a concrete wiring gap in the inspected checkout, consistent with the empty live column; it does not prove the contents of every released build. `profiles.updated_at`, task updates, and auth refresh timestamps must not be substituted as app usage.

Mobile `src/utils/deviceInfo.ts` collects platform, OS version, device brand/model, native app version/build, and screen dimensions. `useFeedback.ts` and `useSupportRequests.ts` attach that snapshot when submitting a message. It intentionally excludes personal device names. No general user-device table was found among public schema tables. Device details from a message describe the device at submission time, not a user's current device or their only device.

## Proposed server contract

Use one staff-authorized users endpoint with global filters, stable sorting, exact filtered totals and pagination. Preserve existing fields for compatibility; add explicit fields rather than changing the meaning of `created_at` silently. Return ISO 8601 timestamps in UTC and nullable values where unavailable.

| Field | Authoritative source and semantics |
| --- | --- |
| `id`, `email`, `full_name` | Existing profile projection; avoid exposing raw auth metadata |
| `created_at` | Existing profile creation timestamp retained for compatibility |
| `joined_at` | `auth.users.created_at`: account creation, not first purchase or first app activity |
| `profile_created_at` | Profile creation, useful for recovery/debugging; profile recovery can create it later than auth signup |
| `last_sign_in_at` | `auth.users.last_sign_in_at`, nullable; do not call this last app use |
| `last_active_at` | Existing foreground observation, nullable; display Unknown when absent |
| `activity_source` | `app_foreground` when a known observation exists, otherwise null; current telemetry remains client-observed and may be stale |
| `signup_method` | Nullable historical profile field; do not replace it with current linked providers |
| `login_providers` | Sorted unique `auth.identities.provider` values; preserve unknown future provider labels; supports linked accounts |
| `email_confirmed_at` | Nullable auth confirmation timestamp; distinguishes confirmed state from mail deliverability |
| `email_verification_status` | `verified`, `unverified`, or `unknown` if auth enrichment is unavailable; do not translate failed enrichment to false |
| `account_status` | Explicit `active`, `deletion_pending`, `deleted`, `banned`, or `unknown`, with documented precedence and source; inactivity is separate |
| `deleted_at`, `deletion_scheduled_for` | Profile soft-deletion lifecycle fields; do not infer auth deletion from a profile flag |
| `banned_until` | Nullable auth ban timestamp; computed current ban uses server time |
| `timezone`, `signup_cohort` | Existing profile data; nullable/fallback rendering for legacy values |
| `latest_device_observation` | Nullable object containing platform, brand/model, OS, app version/build, `observed_at`, `source` (`feedback`/`support` initially), and source record ID |
| `data_as_of` | Server response timestamp for freshness context |

Select the latest device observation by `user_id` across both message tables, with deterministic timestamp/source/ID ordering. Never join by email or infer a device from Apple/Google provider. Keep the whole snapshot together; do not combine OS from one record with app version from another. Label the column “Last reported device” and expose observation source/date. Users without observations remain Unknown (74 users at discovery time).

For list filtering, support search, cohort, signup date range, linked provider, verification state, account state, platform, and observed app version only when server projections support them. Define inclusive start/exclusive end timestamps; apply filters before pagination and counting. Sort allowlisted fields with a stable ID tie-breaker and explicit null placement. Detail responses can show full timestamps, login providers, source/freshness, and historical device observations without exposing secrets.

## Security and enrichment route

The inspected `profiles_dashboard` view is owned by `postgres`, has no `security_invoker` option, and grants SELECT to both `anon` and `authenticated`. Its base profiles table has RLS, but default owner-executed views can bypass it. This is a verified database grant/design concern; this audit did not test anonymous HTTP access or change grants. Do not add richer auth fields to this broadly granted view. Restrict the existing dashboard projection to server-only access as part of the server work, check dependent consumers, and verify anon/authenticated denial afterward.

The inspected Domani router does not declare staff authentication for users. Apply verified PVS staff authorization before returning enriched user data, including list, detail and aggregate endpoints. PVS staff identity and Domani customer identity are separate. Do not authorize using customer-controlled user metadata.

For a first bounded page, the server can enrich known profile IDs through the Auth admin API and return only an allowlisted projection; explicitly handle missing/deleted auth users and enrichment errors. However, provider/state filtering and sorting must cover the whole dataset. Prefer a server-only database projection/RPC for those global operations rather than N+1 auth calls or filtering an already paginated list. Keep any privileged RPC scoped, grant execution only to the server role, and do not expose tokens, credentials, provider identity blobs, raw session/user agents, IPs, push tokens or password fields. Raw auth sessions are unnecessary for these user insights.

## Missing telemetry and coordinated delivery

1. **UI/server pair:** protect and correct users listing; add canonical join time, last sign-in, verification, linked providers and account lifecycle; implement server filtering/counts; make nulls truthful and provide configurable columns plus details.
2. **UI/server pair:** add historical device snapshots from feedback/support, clearly dated and labeled. This is available without a mobile release, but coverage is limited.
3. **Mobile follow-up required:** wire foreground tracking and confirm it persists on actual devices; handle retries/errors and account switching; use server-received observation time where feasible. Neither PVS project alone can produce missing mobile events.
4. **Mobile/server/schema follow-up:** introduce authenticated, rate-limited device observations if broad device coverage is desired. Define per-install versus per-user latest semantics, observation timestamps, version/build, consent/retention and deletion behavior. Avoid permanent hardware identifiers or personal device names. Existing PostHog code is not an established SQL-backed dashboard source in this audit; integrating analytics requires separate source/coverage validation.

## Validation contract

Test null legacy signup method, multiple providers, missing auth/profile, soft-deleted versus banned accounts, exact dates/timezones, stale/sparse device data, tied timestamps, and global search/filter totals across multiple pages. Verify staff allowlist/role denial, response field allowlists, cache isolation and database grants. Use seeded local fixtures; do not use customer records as snapshots. Validate future activity/device instrumentation on cold open, foreground resume, long sessions, failed/offline writes and account switch. Do not mark telemetry complete solely because columns exist.

## Evidence paths

- Website: `lib/api/domani-users.ts`, `lib/types/domani-users.ts`, `app/dashboard/domani/users/components/users-page-client.tsx`, `users-table.tsx`.
- Server: `src/services/domani.ts`, `src/routes/domani.ts`, `src/lib/domani-db.ts` in `pixelverse-studios-server`.
- Mobile: `src/hooks/useActivityTracking.ts`, `src/hooks/useFeedback.ts`, `src/hooks/useSupportRequests.ts`, `src/utils/deviceInfo.ts`, `supabase/migrations/043_add_last_active_at.sql`, `supabase/migrations/050_add_profile_recovery_rpc.sql` in `/Users/phil/PVS-local/Projects/domani/domani-app`.
- Live SQL: `information_schema.columns`, `pg_get_viewdef`, `pg_class` owner/options, `information_schema.table_privileges`, `pg_policies`, and aggregate counts against profiles/auth identities/users/feedback/support. Results describe the discovery snapshot, not ongoing production guarantees.

## Implemented contract — DEV-1407 / DEV-1409

September 20 recheck: 94 profiles, all 94 auth sign-in timestamps present, no app activity observations, historical message device coverage for 16 user IDs. These are aggregate discovery observations, not backfilled data.

`GET /api/domani/users` retains `{items,total,limit,offset}` and adds `stats` and `data_as_of`. `GET /api/domani/users/:id` returns the same allowlisted item plus freshness; unknown IDs return 404. `GET /api/domani/users/stats` returns full-directory totals (including deleted accounts), `non_deleted`, `deleted`, `active_30d`, `activity_unknown`, `activity_window_days:30`, and `data_as_of`. All reads require the existing verified PVS staff bearer token and use no-store. Browser clients call the API directly; server-rendered overview/campaign pages forward their verified session. There is no new Next.js endpoint.

List queries: `search` (literal, case-insensitive name/email substring), `cohort`, `provider` (linked provider), `account_status`, `verification`, `platform` (last reported), `app_version` (exact last reported value), `activity` (`recent`, `older`, `unknown`), `include_deleted`, `start_date`, `end_date`, `limit` 1–100, `offset` 0–1,000,000, `sort_by`, `sort_order`. Sort keys are joined_at, created_at, last_sign_in_at, last_active_at, email, full_name and account_status. Nulls sort last; IDs break ties. Calendar start/end dates use UTC; a date-only end includes that calendar day, while timestamp end bounds are exclusive. Every filter applies before pagination and aggregates. Offset pagination is stable within a database snapshot; concurrent account additions can shift later pages.

The directory is profile-based: orphaned auth rows without a profile are excluded; profiles missing auth remain visible with unknown auth-derived fields and an empty provider array. Account status precedence is auth deleted, profile deletion_pending, missing-auth unknown, current auth ban, active. Active is an account state, never engagement. Recent activity means a non-banned, non-deleted active account with a recorded foreground timestamp in the preceding 30 days, excluding future timestamps. `activity_unknown` counts absent observations; zero recent activity does not prove zero use.

Device selection preserves a whole snapshot, ordered by timestamp descending (unknown timestamps last), then source and source ID. Device sources are `feedback` and `support`; `feedback_count` counts source records by user ID. No email joins or raw message content. Both views use security_invoker; only service_role receives access. Auth enrichment grants that role SELECT on the exact necessary auth columns rather than all auth fields. Existing broadly granted profiles_dashboard is restricted to service_role; source/profile/auth records are not mutated or copied.

Examples: an Apple+Google user has `login_providers:["apple","google"]` while `signup_method` remains its original value. A user with no device or activity has `latest_device_observation:null,last_active_at:null`. Missing auth gives `joined_at:null,email_verification_status:"unknown",account_status:"unknown"`; missing email confirmation on an existing auth row gives `unverified`. Apple relay email is retained as stored without inferring deliverability or hardware. Device observations remain historical even if old. Per-staff browser preferences store only selected column IDs.

Rollout: apply `20260920181147_domani_user_insights.sql` to Domani, deploy the protected API and coordinated UI, then verify normal staff, nonstaff, Users/overview and campaign recipient paging. The migration is prepared and tested locally, not applied to live by this ticket. Keep restricted grants on rollback; revert API/UI together rather than reopening anonymous access. Missing RPCs fail visibly with 503. Mobile activity/device instrumentation and the user-detail drawer UI remain separate follow-ups.

Validation: `bash supabase/tests/domani_users_test.sh` uses only isolated synthetic PostgreSQL fixtures (125 profiles), including grants, literal search, global paging/filtering, linked providers, missing auth, bans, deletion, and email-collision device isolation. API tests mock external services; user-content and credentials are not test snapshots.

## User detail and feedback links — DEV-1410

The Users table opens a staff-only detail drawer using `/api/domani/users/:id`; unknown values remain explicit. Only the latest device snapshot is available. The user ID copy action copies only the stable ID. Related feedback opens a separate tab with `?user_id=<uuid>` to preserve the current table state. The feedback page validates that ID and retains it across filtering, pagination, retry and refresh.

The feedback API accepts optional UUID `user_id`, applied before totals/paging to both feedback and support records. It never associates by email. The SQL response echoes the scope; the server rejects missing or mismatched scope rather than accepting an old RPC that ignored the filter. Apply server migration `20260920190254_domani_feedback_user_filter.sql` after the existing feedback foundation, then deploy the API and UI. The preceding Users insights migration remains required. Neither migration is applied by this ticket.
