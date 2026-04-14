# Deploy Window Runbook

**Owner:** Phil
**Related:** [DEV-701](https://linear.app/pixelverse-studios/issue/DEV-701), [postmortem](../postmortems/2026-04-07-cms-expansion-504.md), [webhook audit](../audits/webhook-durability-audit.md)

## Why this exists

When our server is restarting (deploys, crashes, config changes), nothing is listening on the socket. For most endpoints that's annoying-but-recoverable (a browser user sees an error and retries). For `POST /api/deployments` it was catastrophic pre-DEV-701 because client CI/CD pipelines are fire-and-forget — the payload is dropped and cannot be reconstructed.

DEV-701 added a durable queue for `/api/deployments` (see [audit](../audits/webhook-durability-audit.md)) which shrinks the window dramatically — payloads are persisted the moment the request body arrives, before any fallible processing runs. But there is still a ~1-second window during the restart where the Node process isn't accepting connections at all. This runbook covers the human-process mitigations for that residual risk.

## Known client deploy windows

> ⚠️ **TODO:** Fill in actual deploy windows as we learn them. Ask each client's dev contact or inspect their deploy schedule.

| Client | Typical deploy window | Source |
|---|---|---|
| *TBD* | *TBD* | *TBD* |

Until this table is filled out, treat "any weekday, business hours ET" as a possible client deploy window and schedule our own deploys accordingly.

## Pre-merge checklist

Before merging any PR to `main` (which triggers a production deploy on DigitalOcean App Platform):

- [ ] Confirm we are **not** inside a known client deploy window (see table above).
- [ ] Verify the current production server is healthy:
  ```bash
  curl -sSf https://api.pixelversestudios.io/api/clients > /dev/null && echo "OK"
  ```
  If that fails, investigate before adding more change on top.
- [ ] Confirm the `pending_webhook_events` queue is empty (or at least not backed up):
  ```sql
  SELECT status, count(*)
  FROM pending_webhook_events
  WHERE created_at > now() - interval '24 hours'
  GROUP BY status;
  ```
  If there's a backlog of `pending` events with `attempts > 0`, something is failing retries — debug before deploying again.
- [ ] If the PR touches `webhook-processor`, `pending-webhook-events`, or `deployments` code paths, test locally first (see [CLAUDE.md testing protocol](../../CLAUDE.md#testing-for-claude-code-agents)).

## Post-merge checklist

Within 2 minutes of the merge triggering a DigitalOcean deploy:

- [ ] Confirm the new deploy finished and the server is accepting traffic:
  ```bash
  curl -sSf https://api.pixelversestudios.io/api/clients > /dev/null && echo "OK"
  ```
- [ ] Confirm the webhook processor started (check DO runtime logs for `🚀 webhook-processor started`).
- [ ] Tail logs for `⚠️  webhook event` or `❌ webhook-processor tick failed` for the next 10 minutes.
- [ ] Sanity-check `pending_webhook_events`:
  ```sql
  SELECT id, event_type, status, attempts, next_retry_at, last_error
  FROM pending_webhook_events
  WHERE created_at > now() - interval '10 minutes'
  ORDER BY created_at DESC;
  ```
  Expected: new rows (if any) reach `status = 'done'` within their retry window. `status = 'failed'` is a page-worthy alert.

## Incident response

### "A client says their deploy email never arrived"

1. Find the event by website:
   ```sql
   SELECT e.id, e.status, e.attempts, e.last_error, e.created_at, e.processed_at
   FROM pending_webhook_events e
   WHERE e.event_type = 'deployment'
     AND e.payload->>'website_id' = '<website-uuid>'
     AND e.created_at > now() - interval '48 hours'
   ORDER BY e.created_at DESC;
   ```
2. If `status = 'failed'`: read `last_error`, fix the underlying cause, then manually re-queue if appropriate (`UPDATE ... SET status = 'pending', attempts = 0, next_retry_at = now()`).
3. If `status = 'pending'` with high `attempts`: the processor is still trying. Watch logs for the next tick.
4. If no row exists: the request was dropped **before** it reached our DB. That's the residual restart-window risk. Ask the client's CI to re-trigger the deploy (or reconstruct the summary manually and POST it ourselves). This is the case DEV-701 could not fully eliminate — document it and add the client's deploy window to the table above so we can avoid it next time.

### "Lots of `failed` events piling up"

That means retries are exhausting for a real reason (website deleted, DB schema drift, email service outage). Check `last_error`, fix the root cause, then re-queue the affected rows by setting `status = 'pending'` and `next_retry_at = now()`.

## Related code

- `src/lib/webhook-processor.ts` — poller + per-event processor
- `src/services/pending-webhook-events.ts` — queue service layer
- `src/controllers/deployments.ts` — insert-first request handler
- `supabase/migrations/20260414_create_pending_webhook_events.sql` — schema
