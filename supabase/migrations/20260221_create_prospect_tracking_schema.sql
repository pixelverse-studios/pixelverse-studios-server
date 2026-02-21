-- PVS-409: Create prospect tracking schema and views
-- Epic: PVS-408 - Unified Prospect Tracking System
--
-- Creates a unified prospect hub linking leads, audit requests, and Calendly bookings
-- to a single prospect identity keyed by email address.

-- ============================================================
-- Table: prospects
-- Hub table; one row per unique email address
-- ============================================================
CREATE TABLE public.prospects (
    id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    email       text        NOT NULL,
    name        text        NOT NULL,
    source      text        NOT NULL,       -- 'details_form' | 'review_request' | 'calendly_call'
    status      text        NOT NULL DEFAULT 'new',  -- 'new' | 'contacted' | 'qualified' | 'closed'
    notes       text,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT prospects_email_unique UNIQUE (email)
);

CREATE INDEX prospects_source_idx     ON public.prospects (source);
CREATE INDEX prospects_status_idx     ON public.prospects (status);
CREATE INDEX prospects_created_at_idx ON public.prospects (created_at DESC);

-- ============================================================
-- Table: lead_submissions
-- Contact details form submissions (from /api/leads endpoint)
-- ============================================================
CREATE TABLE public.lead_submissions (
    id               uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    prospect_id      uuid        NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
    company_name     text        NOT NULL,
    phone            text,
    budget           text        NOT NULL,   -- '<1k' | '1-3k' | '3-6k' | '6-10k' | '10k+'
    timeline         text        NOT NULL,   -- 'ASAP' | '1-2mo' | '3-6mo' | '6+mo' | 'unsure'
    current_website  text,
    improvements     text[]      NOT NULL,
    brief_summary    text,
    created_at       timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX lead_submissions_prospect_id_idx ON public.lead_submissions (prospect_id);
CREATE INDEX lead_submissions_budget_idx      ON public.lead_submissions (budget);
CREATE INDEX lead_submissions_created_at_idx  ON public.lead_submissions (created_at DESC);

-- ============================================================
-- Table: calendly_bookings
-- Calendly invitee events captured via webhook
-- ============================================================
CREATE TABLE public.calendly_bookings (
    id                    uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    prospect_id           uuid        NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
    calendly_event_uri    text        UNIQUE NOT NULL,
    calendly_invitee_uri  text,
    event_type_name       text,
    event_start_at        timestamptz,
    event_end_at          timestamptz,
    cancel_url            text,
    reschedule_url        text,
    canceled              boolean     NOT NULL DEFAULT false,
    canceled_at           timestamptz,
    created_at            timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX calendly_bookings_prospect_id_idx ON public.calendly_bookings (prospect_id);
CREATE INDEX calendly_bookings_event_start_idx ON public.calendly_bookings (event_start_at DESC);

-- ============================================================
-- Alter: audit_requests
-- Add nullable prospect_id FK — old rows stay NULL
-- ============================================================
ALTER TABLE public.audit_requests
    ADD COLUMN IF NOT EXISTS prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS audit_requests_prospect_id_idx ON public.audit_requests (prospect_id);

-- ============================================================
-- View: v_prospects_all
-- All prospects with aggregated touch-point counts
-- ============================================================
CREATE OR REPLACE VIEW public.v_prospects_all AS
SELECT
    p.id,
    p.email,
    p.name,
    p.source,
    p.status,
    p.notes,
    p.created_at,
    p.updated_at,
    (SELECT COUNT(*) FROM public.lead_submissions ls  WHERE ls.prospect_id = p.id) AS lead_submission_count,
    (SELECT COUNT(*) FROM public.audit_requests ar    WHERE ar.prospect_id = p.id) AS audit_request_count,
    (SELECT COUNT(*) FROM public.calendly_bookings cb WHERE cb.prospect_id = p.id) AS calendly_booking_count
FROM public.prospects p
ORDER BY p.created_at DESC;

-- ============================================================
-- View: v_leads_detail
-- Prospects joined with their lead_submissions rows
-- ============================================================
CREATE OR REPLACE VIEW public.v_leads_detail AS
SELECT
    p.id AS prospect_id,
    p.email,
    p.name,
    p.status,
    p.created_at AS prospect_created_at,
    ls.id AS submission_id,
    ls.company_name,
    ls.phone,
    ls.budget,
    ls.timeline,
    ls.current_website,
    ls.improvements,
    ls.brief_summary,
    ls.created_at AS submitted_at
FROM public.prospects p
JOIN public.lead_submissions ls ON ls.prospect_id = p.id
ORDER BY ls.created_at DESC;

-- ============================================================
-- View: v_audits_detail
-- Prospects joined with their audit_requests rows
-- ============================================================
CREATE OR REPLACE VIEW public.v_audits_detail AS
SELECT
    p.id AS prospect_id,
    p.email,
    p.name,
    p.status,
    p.created_at AS prospect_created_at,
    ar.id AS audit_id,
    ar.website_url,
    ar.phone_number,
    ar.specifics,
    ar.acknowledged,
    ar.status AS audit_status,
    ar.created_at AS submitted_at
FROM public.prospects p
JOIN public.audit_requests ar ON ar.prospect_id = p.id
ORDER BY ar.created_at DESC;

-- ============================================================
-- View: v_calendly_detail
-- Prospects joined with their calendly_bookings rows
-- ============================================================
CREATE OR REPLACE VIEW public.v_calendly_detail AS
SELECT
    p.id AS prospect_id,
    p.email,
    p.name,
    p.status,
    p.created_at AS prospect_created_at,
    cb.id AS booking_id,
    cb.event_type_name,
    cb.event_start_at,
    cb.event_end_at,
    cb.canceled,
    cb.canceled_at,
    cb.cancel_url,
    cb.reschedule_url,
    cb.created_at AS booked_at
FROM public.prospects p
JOIN public.calendly_bookings cb ON cb.prospect_id = p.id
ORDER BY cb.event_start_at DESC;
