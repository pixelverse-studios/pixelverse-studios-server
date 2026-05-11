-- ============================================================
-- Migration: Expose attribution in internal prospect reporting
-- DEV-825
--
-- Keeps full attribution JSON on conversion detail views and
-- adds small latest-attribution fields to the prospect list view.
-- ============================================================

-- ============================================================
-- Refresh v_prospects_all with lightweight latest attribution
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
    COALESCE(ls.cnt,  0) AS lead_submission_count,
    COALESCE(ar.cnt,  0) AS audit_request_count,
    COALESCE(cb.cnt,  0) AS calendly_booking_count,
    COALESCE(
        latest_attribution.attribution #>> '{latest_touch,utm_source}',
        latest_attribution.attribution #>> '{first_touch,utm_source}'
    ) AS latest_attribution_source,
    COALESCE(
        latest_attribution.attribution #>> '{latest_touch,utm_medium}',
        latest_attribution.attribution #>> '{first_touch,utm_medium}'
    ) AS latest_attribution_medium,
    COALESCE(
        latest_attribution.attribution #>> '{latest_touch,utm_campaign}',
        latest_attribution.attribution #>> '{first_touch,utm_campaign}'
    ) AS latest_attribution_campaign,
    latest_attribution.attribution #>> '{conversion,conversion_type}' AS latest_attribution_conversion_type
FROM public.prospects p
LEFT JOIN (
    SELECT prospect_id, COUNT(*) AS cnt
    FROM public.lead_submissions
    GROUP BY prospect_id
) ls ON ls.prospect_id = p.id
LEFT JOIN (
    SELECT prospect_id, COUNT(*) AS cnt
    FROM public.audit_requests
    WHERE prospect_id IS NOT NULL
    GROUP BY prospect_id
) ar ON ar.prospect_id = p.id
LEFT JOIN (
    SELECT prospect_id, COUNT(*) AS cnt
    FROM public.calendly_bookings
    GROUP BY prospect_id
) cb ON cb.prospect_id = p.id
LEFT JOIN LATERAL (
    SELECT attribution
    FROM (
        SELECT attribution, created_at
        FROM public.lead_submissions
        WHERE prospect_id = p.id AND attribution IS NOT NULL

        UNION ALL

        SELECT attribution, created_at
        FROM public.audit_requests
        WHERE prospect_id = p.id AND attribution IS NOT NULL

        UNION ALL

        SELECT attribution, created_at
        FROM public.calendly_bookings
        WHERE prospect_id = p.id AND attribution IS NOT NULL
    ) attributed_conversions
    ORDER BY created_at DESC
    LIMIT 1
) latest_attribution ON true
ORDER BY p.created_at DESC;

-- ============================================================
-- Refresh v_leads_detail to expose attribution
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
    ar.promo_code,
    ar.attribution,
    ar.created_at AS submitted_at
FROM public.prospects p
JOIN public.audit_requests ar ON ar.prospect_id = p.id
ORDER BY ar.created_at DESC;

-- ============================================================
-- Refresh v_calendly_detail to expose attribution
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
    cb.attribution,
    cb.created_at AS booked_at
FROM public.prospects p
JOIN public.calendly_bookings cb ON cb.prospect_id = p.id
ORDER BY cb.event_start_at DESC;
