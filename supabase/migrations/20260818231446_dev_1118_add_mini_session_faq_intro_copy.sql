-- DEV-1118: make all Mini Sessions FAQ section intro copy campaign-controlled.

ALTER TABLE public.mini_session_campaigns
    ADD COLUMN faq_eyebrow text NOT NULL DEFAULT 'Good to know',
    ADD COLUMN faq_headline text NOT NULL DEFAULT 'Mini Session questions.',
    ADD COLUMN faq_intro text NOT NULL DEFAULT 'Everything you need to arrive prepared and enjoy a relaxed, beautiful session.',
    ADD CONSTRAINT mini_session_campaigns_faq_eyebrow_length_check
        CHECK (char_length(btrim(faq_eyebrow)) BETWEEN 1 AND 80),
    ADD CONSTRAINT mini_session_campaigns_faq_headline_length_check
        CHECK (char_length(btrim(faq_headline)) BETWEEN 1 AND 200),
    ADD CONSTRAINT mini_session_campaigns_faq_intro_length_check
        CHECK (char_length(btrim(faq_intro)) BETWEEN 1 AND 600);

CREATE OR REPLACE FUNCTION public.save_mini_session_campaign(
    p_campaign_id uuid,
    p_website_id uuid,
    p_client_id uuid,
    p_expected_updated_at timestamptz,
    p_actor text,
    p_campaign jsonb,
    p_booking_options jsonb
)
RETURNS SETOF public.mini_session_campaigns
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    target public.mini_session_campaigns%ROWTYPE;
    booking_option jsonb;
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
    IF jsonb_typeof(p_booking_options) <> 'array' OR jsonb_array_length(p_booking_options) > 6 THEN
        RAISE EXCEPTION 'MINI_SESSION_BOOKING_OPTIONS_INVALID' USING ERRCODE = '22023';
    END IF;

    UPDATE public.mini_session_campaigns
    SET internal_name = p_campaign ->> 'internalName',
        public_label = p_campaign ->> 'publicLabel',
        headline = p_campaign ->> 'headline',
        summary = p_campaign ->> 'summary',
        description = p_campaign ->> 'description',
        experience_headline = p_campaign ->> 'experienceHeadline',
        inclusions_headline = COALESCE(
            NULLIF(btrim(p_campaign ->> 'inclusionsHeadline'), ''),
            target.inclusions_headline,
            'Session Details'
        ),
        vibe_headline = p_campaign ->> 'vibeHeadline',
        vibe_content = p_campaign ->> 'vibeContent',
        duration_minutes = (p_campaign ->> 'durationMinutes')::integer,
        total_price_cents = (p_campaign ->> 'totalPriceCents')::integer,
        deposit_cents = (p_campaign ->> 'depositCents')::integer,
        balance_due_text = p_campaign ->> 'balanceDueText',
        date_summary = p_campaign ->> 'dateSummary',
        location_summary = p_campaign ->> 'locationSummary',
        inclusions = p_campaign -> 'inclusions',
        cancellation_policy = p_campaign ->> 'cancellationPolicy',
        weather_policy = p_campaign ->> 'weatherPolicy',
        lateness_policy = p_campaign ->> 'latenessPolicy',
        terms_note = p_campaign ->> 'termsNote',
        hero_media_id = (p_campaign ->> 'heroMediaId')::bigint,
        cta_label = p_campaign ->> 'ctaLabel',
        homepage_featured = (p_campaign ->> 'homepageFeatured')::boolean,
        promo_label = p_campaign ->> 'promoLabel',
        promo_headline = p_campaign ->> 'promoHeadline',
        promo_copy = p_campaign ->> 'promoCopy',
        promo_cta_label = p_campaign ->> 'promoCtaLabel',
        homepage_hero_cta_label = p_campaign ->> 'homepageHeroCtaLabel',
        faq_eyebrow = COALESCE(
            NULLIF(btrim(p_campaign ->> 'faqEyebrow'), ''),
            target.faq_eyebrow,
            'Good to know'
        ),
        faq_headline = COALESCE(
            NULLIF(btrim(p_campaign ->> 'faqHeadline'), ''),
            target.faq_headline,
            'Mini Session questions.'
        ),
        faq_intro = COALESCE(
            NULLIF(btrim(p_campaign ->> 'faqIntro'), ''),
            target.faq_intro,
            'Everything you need to arrive prepared and enjoy a relaxed, beautiful session.'
        ),
        faqs = p_campaign -> 'faqs',
        meta_title = p_campaign ->> 'metaTitle',
        meta_description = p_campaign ->> 'metaDescription',
        updated_by = p_actor
    WHERE id = p_campaign_id AND website_id = p_website_id AND client_id = p_client_id;

    DELETE FROM public.mini_session_booking_options
    WHERE campaign_id = p_campaign_id AND website_id = p_website_id AND client_id = p_client_id;

    FOR booking_option IN SELECT value FROM jsonb_array_elements(p_booking_options)
    LOOP
        INSERT INTO public.mini_session_booking_options (
            id, campaign_id, website_id, client_id, label, description,
            date_time_label, location_label, cal_booking_url, status, sort_order
        ) VALUES (
            COALESCE((booking_option ->> 'id')::uuid, gen_random_uuid()),
            p_campaign_id, p_website_id, p_client_id,
            booking_option ->> 'label', booking_option ->> 'description',
            booking_option ->> 'dateTimeLabel', booking_option ->> 'locationLabel',
            booking_option ->> 'calBookingUrl', booking_option ->> 'status',
            (booking_option ->> 'sortOrder')::integer
        );
    END LOOP;

    RETURN QUERY SELECT * FROM public.mini_session_campaigns WHERE id = p_campaign_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.duplicate_mini_session_campaign(
    p_campaign_id uuid,
    p_website_id uuid,
    p_client_id uuid,
    p_expected_updated_at timestamptz,
    p_actor text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    source public.mini_session_campaigns%ROWTYPE;
    duplicate_id uuid;
BEGIN
    SELECT * INTO source
    FROM public.mini_session_campaigns
    WHERE id = p_campaign_id AND website_id = p_website_id AND client_id = p_client_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MINI_SESSION_CAMPAIGN_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF source.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'MINI_SESSION_STALE_WRITE' USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.mini_session_campaigns (
        website_id, client_id, internal_name, status, public_label, headline,
        summary, description, experience_headline, inclusions_headline,
        vibe_headline, vibe_content, duration_minutes, total_price_cents,
        deposit_cents, balance_due_text, date_summary, location_summary,
        inclusions, cancellation_policy, weather_policy, lateness_policy,
        terms_note, hero_media_id, cta_label, homepage_featured, promo_label,
        promo_headline, promo_copy, promo_cta_label, homepage_hero_cta_label,
        faq_eyebrow, faq_headline, faq_intro, faqs, meta_title,
        meta_description, created_by, updated_by
    ) VALUES (
        source.website_id, source.client_id,
        left(source.internal_name, 113) || ' (Copy)', 'draft',
        source.public_label, source.headline, source.summary, source.description,
        source.experience_headline, source.inclusions_headline,
        source.vibe_headline, source.vibe_content, source.duration_minutes,
        source.total_price_cents, source.deposit_cents, source.balance_due_text,
        source.date_summary, source.location_summary, source.inclusions,
        source.cancellation_policy, source.weather_policy,
        source.lateness_policy, source.terms_note, source.hero_media_id,
        source.cta_label, source.homepage_featured, source.promo_label,
        source.promo_headline, source.promo_copy, source.promo_cta_label,
        source.homepage_hero_cta_label, source.faq_eyebrow,
        source.faq_headline, source.faq_intro, source.faqs, source.meta_title,
        source.meta_description, p_actor, p_actor
    ) RETURNING id INTO duplicate_id;

    INSERT INTO public.mini_session_booking_options (
        campaign_id, website_id, client_id, label, description,
        date_time_label, location_label, cal_booking_url, status, sort_order
    )
    SELECT duplicate_id, website_id, client_id, label, description,
           date_time_label, location_label, cal_booking_url, status, sort_order
    FROM public.mini_session_booking_options
    WHERE campaign_id = p_campaign_id AND website_id = p_website_id AND client_id = p_client_id
    ORDER BY sort_order;

    RETURN duplicate_id;
END;
$$;

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
       OR btrim(target.inclusions_headline) = ''
       OR btrim(target.vibe_headline) = ''
       OR btrim(target.vibe_content) = ''
       OR btrim(target.balance_due_text) = ''
       OR btrim(target.date_summary) = ''
       OR btrim(target.location_summary) = ''
       OR btrim(target.faq_eyebrow) = ''
       OR btrim(target.faq_headline) = ''
       OR btrim(target.faq_intro) = ''
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
