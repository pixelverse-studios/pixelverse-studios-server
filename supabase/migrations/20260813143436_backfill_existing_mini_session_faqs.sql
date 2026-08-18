-- Pre-populate campaigns created before campaign-owned FAQs were introduced.
-- Existing non-empty FAQ sets remain untouched so administrator edits win.
WITH faq_template AS (
    SELECT faqs
    FROM public.mini_session_campaigns
    WHERE jsonb_array_length(faqs) > 0
    ORDER BY
        CASE status WHEN 'live' THEN 0 WHEN 'sold_out' THEN 1 ELSE 2 END,
        updated_at DESC
    LIMIT 1
)
UPDATE public.mini_session_campaigns AS campaign
SET faqs = faq_template.faqs,
    updated_at = timezone('utc', now()),
    updated_by = 'system:faq-backfill'
FROM faq_template
WHERE jsonb_array_length(campaign.faqs) = 0;
