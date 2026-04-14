-- DEV-701: Deploy-window resilience for irrecoverable webhook payloads.
-- Durable queue for webhook payloads (currently only POST /api/deployments).
-- Insert-first, process-second pattern: the payload is persisted before any
-- fallible processing runs, so server crashes or mid-handler failures can
-- resume work from this table instead of dropping client data.

CREATE TABLE IF NOT EXISTS public.pending_webhook_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error      TEXT,
    result_ref      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ,
    CONSTRAINT chk_status CHECK (status IN ('pending', 'done', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_pending_webhook_events_due
    ON public.pending_webhook_events(next_retry_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pending_webhook_events_event_type
    ON public.pending_webhook_events(event_type, status);

COMMENT ON TABLE public.pending_webhook_events IS
    'Durable queue for webhook payloads that cannot be recovered if dropped (e.g. client CI/CD deploy summaries). See DEV-701.';
COMMENT ON COLUMN public.pending_webhook_events.event_type IS
    'Discriminator for the payload shape. Currently: deployment.';
COMMENT ON COLUMN public.pending_webhook_events.result_ref IS
    'FK-like reference to the successfully-created downstream record (e.g. website_deployments.id) for traceability.';
