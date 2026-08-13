-- Keep database-level publication readiness aligned with the server contract.
CREATE OR REPLACE FUNCTION public.publish_mini_session_campaign(
    p_campaign_id uuid,
    p_website_id uuid,
    p_client_id uuid,
    p_expected_updated_at timestamptz,
    p_actor text
)
RETURNS SETOF public.mini_session_campaigns
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    target public.mini_session_campaigns%ROWTYPE;
BEGIN
    SELECT * INTO target
    FROM public.mini_session_campaigns
    WHERE id = p_campaign_id AND website_id = p_website_id AND client_id = p_client_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MINI_SESSION_CAMPAIGN_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF target.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'MINI_SESSION_STALE_WRITE' USING ERRCODE = '40001';
    END IF;
    IF target.status = 'archived' THEN
        RAISE EXCEPTION 'MINI_SESSION_INVALID_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    IF target.hero_media_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.media_catalog_items media
        WHERE media.id = target.hero_media_id
          AND media.website_id = p_website_id
          AND media.client_id = p_client_id
          AND media.status = 'published'
    ) THEN
        RAISE EXCEPTION 'MINI_SESSION_HERO_MEDIA_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.mini_session_booking_options option
        WHERE option.campaign_id = p_campaign_id
          AND option.website_id = p_website_id
          AND option.client_id = p_client_id
          AND option.status = 'open'
    ) THEN
        RAISE EXCEPTION 'MINI_SESSION_OPEN_OPTION_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    IF btrim(target.headline) = ''
       OR btrim(target.summary) = ''
       OR btrim(target.description) = ''
       OR btrim(target.experience_headline) = ''
       OR btrim(target.vibe_headline) = ''
       OR btrim(target.vibe_content) = ''
       OR btrim(target.balance_due_text) = ''
       OR btrim(target.date_summary) = ''
       OR btrim(target.location_summary) = ''
       OR jsonb_array_length(target.inclusions) = 0
       OR jsonb_array_length(target.faqs) = 0
       OR btrim(target.cancellation_policy) = ''
       OR btrim(target.lateness_policy) = ''
       OR btrim(target.cta_label) = ''
       OR target.total_price_cents <= 0
       OR target.deposit_cents <= 0 THEN
        RAISE EXCEPTION 'MINI_SESSION_CAMPAIGN_NOT_READY' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.mini_session_campaigns
    SET status = 'closed', updated_by = p_actor
    WHERE website_id = p_website_id AND id <> p_campaign_id AND status IN ('live', 'sold_out');

    UPDATE public.mini_session_campaigns
    SET status = 'live', published_at = timezone('utc', now()),
        published_by = p_actor, updated_by = p_actor
    WHERE id = p_campaign_id AND website_id = p_website_id AND client_id = p_client_id;

    RETURN QUERY SELECT * FROM public.mini_session_campaigns WHERE id = p_campaign_id;
END;
$$;
