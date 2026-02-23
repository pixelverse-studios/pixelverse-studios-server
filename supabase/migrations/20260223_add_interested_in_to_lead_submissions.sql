-- ============================================================
-- Migration: Add interested_in to lead_submissions
-- Tracks which services a prospect is interested in
-- Valid values: 'web-design', 'seo'
-- ============================================================

ALTER TABLE public.lead_submissions
    ADD COLUMN IF NOT EXISTS interested_in text[] DEFAULT NULL;

-- Update v_leads_detail view to expose the new column
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
    ls.interested_in,
    ls.brief_summary,
    ls.created_at AS submitted_at
FROM public.prospects p
JOIN public.lead_submissions ls ON ls.prospect_id = p.id
ORDER BY ls.created_at DESC;
