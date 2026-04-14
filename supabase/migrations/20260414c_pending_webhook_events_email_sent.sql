-- DEV-701 follow-up: prevent duplicate email on retry.
-- If processDeploymentEvent sends the email successfully but crashes
-- before markDone, the next retry would re-send the same email.
-- Tracking email_sent_at lets the processor skip the email block on
-- retry when it already succeeded.

ALTER TABLE public.pending_webhook_events
    ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.pending_webhook_events.email_sent_at IS
    'Set when the notification email succeeded. Retries skip the email send when non-null. See DEV-701.';
