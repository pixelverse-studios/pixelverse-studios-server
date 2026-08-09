# Mini Sessions server domain

The Mini Sessions domain stores CMS-managed seasonal campaign presentation in
Supabase while leaving real scheduling and deposit collection to Cal.com and
Stripe. The Iffer's Pictures website must consume the Pixelverse API and must
not read these tables directly.

## Tables

- `mini_session_campaigns` stores tenant-scoped campaign copy, offer details,
  pricing in integer cents, policies, media selection, promotion copy, SEO
  overrides, lifecycle state, and optimistic-concurrency timestamps.
- `mini_session_booking_options` stores up to six ordered, tenant-scoped Cal.com
  booking links. Supported states are `open`, `sold_out`, and `hidden`.
- `mini_session_campaign_audit_logs` records lifecycle and content actions with
  the administrator actor and bounded old/new summaries. Audit failures are
  logged without rolling back a successful campaign mutation.

All three tables have RLS enabled. `anon` and `authenticated` table privileges
are explicitly revoked. The Pixelverse server's service-role client is the only
application data-access path.

## Database guarantees

- Composite foreign keys keep campaigns, booking options, hero media, and audit
  rows inside one website/client tenant pair.
- A partial unique index allows only one `live` or `sold_out` campaign for a
  website.
- Check constraints enforce lifecycle values, integer-cent price/deposit rules,
  duration, copy bounds, option ordering, supported Cal.com HTTPS hosts, and
  bounded inclusion/option collections.
- `updated_at` triggers provide the optimistic-concurrency token expected by
  every mutation.
- `save_mini_session_campaign` atomically saves editable campaign content and
  replaces its ordered options without accepting lifecycle state.
- `duplicate_mini_session_campaign` atomically copies content and options into a
  new draft while clearing publication fields.
- `publish_mini_session_campaign` validates publication readiness, closes any
  currently public campaign, and publishes the target in one transaction.

The database functions use invoker security. Execution is revoked from
`PUBLIC`, `anon`, and `authenticated`, and granted only to `service_role`.

## Service responsibilities

`src/services/mini-session-campaigns.ts` resolves the website/client tenant,
validates structured inputs, enforces supported transitions, verifies hero
media, performs CRUD/domain operations, maps stale writes to a structured
domain error, and produces separate admin and public projections.

The public projection returns only `live` or `sold_out` campaigns, filters
hidden booking options, omits actor/internal/tenant data, and includes hero
media only while it remains published. Express routing, authentication, cache
headers, and revalidation are delivered separately by DEV-1098.

## Migration verification

Before deployment, apply
`supabase/migrations/20260809143427_create_mini_session_campaigns.sql` to a safe
database and verify:

1. Cross-tenant hero and booking-option writes fail.
2. Deposits above total price fail.
3. A second public campaign for one website fails.
4. Publishing closes the previous campaign atomically.
5. Duplication creates a draft and copies options.
6. A stale save is rejected.
7. RLS and server-only grants match the migration.

Do not apply or test this migration against production without an approved
release operation.
