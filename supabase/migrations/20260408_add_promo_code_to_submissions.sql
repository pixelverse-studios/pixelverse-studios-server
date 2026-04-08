-- ============================================================
-- Migration: Add promo_code to submissions
-- Adds a nullable promo_code column to lead_submissions and
-- audit_requests, and refreshes v_leads_detail and v_audits_detail
-- so the new column is exposed.
--
-- Promo codes are stored on the submission, not on the prospect —
-- the same prospect submitting twice with different codes is intentional.
-- No validation against a known list; honoring is manual for now.
-- ============================================================

ALTER TABLE public.lead_submissions
    ADD COLUMN IF NOT EXISTS promo_code text DEFAULT NULL;

ALTER TABLE public.audit_requests
    ADD COLUMN IF NOT EXISTS promo_code text DEFAULT NULL;

-- ============================================================
-- Refresh v_leads_detail to expose promo_code
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
    ls.created_at AS submitted_at
FROM public.prospects p
JOIN public.lead_submissions ls ON ls.prospect_id = p.id
ORDER BY ls.created_at DESC;

-- ============================================================
-- Refresh v_audits_detail to expose promo_code
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
    ar.created_at AS submitted_at
FROM public.prospects p
JOIN public.audit_requests ar ON ar.prospect_id = p.id
ORDER BY ar.created_at DESC;
