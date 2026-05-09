-- ============================================================
-- Migration: Add attribution metadata to conversion records
-- DEV-822
--
-- Stores sanitized first-party attribution metadata on individual
-- conversion rows. Nullable by design so existing and unattributed
-- submissions continue to work unchanged.
-- ============================================================

ALTER TABLE public.lead_submissions
    ADD COLUMN IF NOT EXISTS attribution jsonb DEFAULT NULL;

ALTER TABLE public.audit_requests
    ADD COLUMN IF NOT EXISTS attribution jsonb DEFAULT NULL;

ALTER TABLE public.calendly_bookings
    ADD COLUMN IF NOT EXISTS attribution jsonb DEFAULT NULL;

-- ============================================================
-- Refresh v_leads_detail to expose attribution
-- ============================================================
DROP VIEW IF EXISTS public.v_leads_detail;
CREATE VIEW public.v_leads_detail AS
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
    ls.interested_in,
    ls.brief_summary,
    ls.promo_code,
    ls.attribution,
    ls.created_at AS submitted_at
FROM public.prospects p
JOIN public.lead_submissions ls ON ls.prospect_id = p.id
ORDER BY ls.created_at DESC;

-- ============================================================
-- Refresh v_audits_detail to expose attribution
-- ============================================================
DROP VIEW IF EXISTS public.v_audits_detail;
CREATE VIEW public.v_audits_detail AS
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
    ar.promo_code,
    ar.attribution,
    ar.created_at AS submitted_at
FROM public.prospects p
JOIN public.audit_requests ar ON ar.prospect_id = p.id
ORDER BY ar.created_at DESC;

-- ============================================================
-- Refresh v_calendly_detail to expose attribution
-- ============================================================
DROP VIEW IF EXISTS public.v_calendly_detail;
CREATE VIEW public.v_calendly_detail AS
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
    cb.attribution,
    cb.created_at AS booked_at
FROM public.prospects p
JOIN public.calendly_bookings cb ON cb.prospect_id = p.id
ORDER BY cb.event_start_at DESC;
