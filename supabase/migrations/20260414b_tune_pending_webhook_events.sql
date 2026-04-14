-- DEV-701 follow-up: drop the unused (event_type, status) index.
-- The poller's only hot query is `status='pending' AND next_retry_at<=now`,
-- which is served by idx_pending_webhook_events_due. No current query
-- filters by event_type, so the second index just adds write overhead.
-- Recreate it if/when an admin dashboard queries the table by type.

DROP INDEX IF EXISTS public.idx_pending_webhook_events_event_type;
