# Domani feedback contract and coordinated delivery

Evidence date: 2026-09-17. Tickets: DEV-1391, DEV-1392, DEV-1393, DEV-1399. Repositories: pvs-site and pixelverse-studios-server. These changes are the first paired foundation slice, not completion of the full conversation milestone.

## Verified schema and current implementation

Domani product records live in project `exxnnlhxcjujxnnwwrxv`; staff authentication belongs to PixelVerse project `yhijvzfgsucanbydmsif`. Live schema, constraints and grouped counts were read without modifying records or retrieving message bodies. Both beta_feedback and support_requests have UUID id/user_id, email, category, message/description, status, created_at/updated_at and nullable platform/device/version metadata. Source records reference Domani profiles with deletion cascade. created_at and updated_at are nullable. The staff-role table named in the server documentation is absent in the PVS schema.

| Source values | Dashboard value | Writing dashboard status |
| --- | --- | --- |
| beta: bug_report / feature_idea / what_i_love / general | bug / feature / love / general | — |
| support: technical_issue / account_help / billing_question / other | support (original category retained) | — |
| beta: new / reviewed / actioned or archived | new / reviewed / resolved | new / reviewed / actioned |
| support: pending / in_progress / resolved or closed | new / reviewed / resolved | pending / in_progress / resolved |

Preserve original_category and original_status. A normalized no-op must not turn archived into actioned or closed into resolved. Unknown future values are labelled unknown; missing telemetry is not Android or a made-up date. Feedback identity is always `(source, id)`; identical UUIDs across source tables are independent.

The new security-invoker dashboard view and list/status RPCs are service-role-only. A status update locks the source row and inserts its staff audit in the same transaction. It does not send email or implicitly change any conversation state. RPCs use explicit grants, with no SECURITY DEFINER escalation.

## Access boundary

Browser requests go directly to the PVS server with the current Supabase session access token. Initial page data is still fetched directly from the API by Next.js server components after session verification. There is no Next.js feedback API route. Express independently validates the token with PVS Auth and checks exact normalized membership in `DOMANI_DASHBOARD_STAFF_EMAILS`. Empty configuration fails closed. No default staff address is silently authorized. User-editable metadata is not an authorization source. Browser Origin, if present, must match `PVS_DASHBOARD_ORIGINS`; the server validates every mutation and does not use cookies as API authentication. Browser requests omit cookies. Allowed CORS preflight responses may be cached for 600 seconds; actual requests always undergo origin and staff checks. Responses are no-store.

The guard covers the feedback prefix including future subroutes. Legacy support reads are protected too. Public unsubscribe and unrelated domains are unchanged. Existing Releases authorization is not silently rewritten. Users enrichment must reuse the verified staff guard and close legacy users bypasses in DEV-1407.

## Implemented HTTP contract

API base: `/api/domani/feedback` on the PVS server. Both browser and server-rendered page reads call the server directly. Browser origins must be explicitly listed in `PVS_DASHBOARD_ORIGINS`, including `http://localhost:3000` and `http://127.0.0.1:3000` for local development. Production and preview origins require their own explicit entries; do not use a wildcard.

- `GET /`: query fields category, status, platform, source, search (up to 200 chars), start_date, end_date, limit (1–100; default 50), offset (0–1,000,000), sort_by (created_at/status), sort_order (asc/desc). All filters apply before pagination and aggregate counts. Search is literal case-insensitive substring, not an SQL wildcard pattern. Unknown fields/arrays are rejected. Sort ties use created_at, source, id, with missing dates last.
- Date-only boundaries cover whole UTC dates: start means 00:00:00Z and end becomes the next midnight with an exclusive comparison, retaining PostgreSQL sub-millisecond precision. Explicit timestamp end bounds remain inclusive and require timezone. Existing date-range controls send date-only values. The API derives the internal end_date_exclusive RPC flag; clients cannot supply it. Invalid calendar dates and inverted ranges return 400.
- `GET /stats`: same filters, unpaginated aggregate stats.
- `GET /:source/:id`: one normalized item or 404.
- `PATCH /:source/:id/status`: JSON `{ "status": "new" | "reviewed" | "resolved" }`; verified actor supplied internally, never from client payload.
- Legacy upstream `GET /:id?source=...` and `PATCH /:id/status` with source in body remain protected compatibility forms. Source cannot be guessed from a UUID.

Example response (synthetic):

```json
{
  "items": [{
    "id": "00000000-0000-4000-8000-000000000001",
    "source": "beta_feedback", "user_id": "10000000-0000-4000-8000-000000000001",
    "email": "fixture@example.test", "category": "bug", "original_category": "bug_report",
    "message": "Example feedback", "status": "new", "original_status": "new",
    "platform": null, "app_version": null, "app_build": null,
    "device_brand": null, "device_model": null, "os_version": null,
    "created_at": null, "updated_at": null
  }],
  "total": 1, "feedback_count": 1, "support_count": 0,
  "stats": {"total": 1, "by_status": {"new": 1, "reviewed": 0, "resolved": 0, "unknown": 0}, "by_category": {"bug": 1}, "by_platform": {"unknown": 1}},
  "limit": 50, "offset": 0
}
```

Errors: 400 invalid request, 401 invalid/missing session, 403 nonstaff/forbidden origin, 404 missing record, 503 missing staff configuration/auth or database unavailable. Server shape is `{error:{code,message},message}` (validation adds details). The API emits sanitized errors; the browser client displays safe access/session/service messages.

## Subsequent conversation slices (specified, not implemented here)

DEV-1393 continues with Domani-owned conversation, message, send-attempt/outbox and per-staff read-cursor tables. Each conversation references exactly one source using nullable beta_feedback_id/support_request_id foreign keys plus an XOR constraint and uniqueness for each source. PVS staff IDs are external actor snapshots, not foreign keys into Domani Auth. Source deletion cascades private conversation content; account deletion and retention behavior must be tested before enabling sends. Status audit contains no customer email or message content; staff identity remains restricted operational data.

`GET /:source/:id/messages` will return ordered paginated messages with direction, safe body, subject, staff author or inbound participant, timestamps, delivery evidence and retry capability. Stable cursors include time + message ID. `POST /:source/:id/messages` accepts subject (1–200 chars), text (1–20,000 chars), and UUID request key, with recipient and sender resolved server-side. Preserve immutable sender/recipient/content snapshots, provider ID, RFC message ID and references. `PATCH /:source/:id/read` advances only the verified staff member's cursor monotonically to a message in that conversation; no cross-conversation IDs. Unread summaries are unavailable in this foundation, not reported as zero.

Create the message and outbox intent in one transaction before dispatch. Unique `(conversation_id, request_key)` makes a repeated identical request idempotent; changed payload with the same key returns 409. Worker claims must be transactional with bounded leases. Reuse the provider idempotency key for an identical attempt; after its retention window expires, reconcile uncertain outcomes rather than blindly resend. Sending never automatically resolves feedback.

Delivery model: queued → sending → accepted → delivered, with failed/bounced/complained and unknown/uncertain outcomes represented independently from feedback lifecycle. Only verified delivery events establish delivered. Failed requests preserve the authored message; retry eligibility is server-owned. Incoming replies create unread activity without automatically reopening resolved feedback. Read state belongs to each staff member.

Mailbox routing proposal for DEV-1396/1397: keep visible From as `Domani <hello@domani-app.com>` and preserve existing hello mailbox/MX. Use opaque, high-entropy conversation aliases on a dedicated inbound subdomain, with verified provider webhooks, if sender/mailbox/Apple-relay readiness confirms compatibility. Do not assume this DNS/provider configuration already exists. If not compatible, use verified existing-mailbox ingestion instead; record that decision before implementing inbound. No MX or provider configuration changes are part of this branch. Reject/quarantine unmatched or spoofed mail; do not correlate on subject alone. Retain deduplication IDs, sanitize mail content, block remote images/active HTML, and prevent responder loops. No attachments or bulk campaigns are included.

## Deployment and verification

1. Apply `20260917185008_domani_feedback_dashboard_foundation.sql` to the **Domani** database only, after review. This branch has not applied it remotely.
2. Configure PVS server `DOMANI_DASHBOARD_STAFF_EMAILS` with the intended staff accounts. Configure `PVS_DASHBOARD_ORIGINS` for the actual dashboard origin(s); this is required for direct browser requests. No secrets in browser env.
3. Deploy paired server and site branches in a coordinated window. The old site does not forward authentication, so do not roll out server protection while leaving the old site as the only UI. Prefer validate both in staging, then deploy site/server together; the brief incompatible interval must fail closed with an error, not expose data.
4. Verify ordinary signed-in and anonymous callers cannot read either feedback source; verify authorized staff can filter/list/detail/status and see a persisted audit. Use controlled data.
5. Keep the additive migration/audit on app rollback. Avoid reverting the server to unprotected legacy reads; disable the feature or retain the guard when rolling back UI. No email feature is enabled in this slice.

Automated coverage: 126 synthetic records across both sources, colliding source IDs, category/raw-status mapping, >100 pagination, exact counts, literal search, date boundaries, empty results, archived no-op, invalid source, atomic audit, anon/authenticated privilege denial, auth middleware and authenticated HTTP/client contract tests. The local SQL harness creates its own temporary PostgreSQL cluster and never connects to live projects.
