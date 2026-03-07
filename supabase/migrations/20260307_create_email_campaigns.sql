-- ============================================================
-- Migration: Create email_campaigns table
-- Tracks sent email campaigns from the PVS dashboard
-- Used by the Domani email campaign system
-- ============================================================

CREATE TABLE public.email_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_type TEXT NOT NULL DEFAULT 'version_release',
    subject TEXT NOT NULL,
    html_content TEXT NOT NULL,
    recipient_count INTEGER NOT NULL,
    successful INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    recipients JSONB NOT NULL DEFAULT '[]',
    sent_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
