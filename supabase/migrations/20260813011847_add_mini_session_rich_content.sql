-- DEV-1083: campaign-controlled rich content and Mini Sessions FAQs.

CREATE OR REPLACE FUNCTION public.mini_session_faqs_are_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT jsonb_typeof(value) = 'array'
       AND jsonb_array_length(value) <= 50
       AND NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(value) AS faq(item)
           WHERE jsonb_typeof(item) <> 'object'
              OR char_length(btrim(item ->> 'id')) = 0
              OR char_length(btrim(item ->> 'question')) NOT BETWEEN 1 AND 240
              OR char_length(btrim(item ->> 'answerHtml')) NOT BETWEEN 1 AND 10000
              OR (item ->> 'sortOrder') !~ '^[0-9]+$'
              OR (item ->> 'sortOrder')::integer NOT BETWEEN 0 AND 49
       )
       AND (
           SELECT count(*) = count(DISTINCT (item ->> 'sortOrder')::integer)
           FROM jsonb_array_elements(value) AS faq(item)
       );
$$;

ALTER TABLE public.mini_session_campaigns
    ADD COLUMN experience_headline text NOT NULL DEFAULT 'A small session with room for real connection.',
    ADD COLUMN vibe_headline text NOT NULL DEFAULT 'Relax and Enjoy the Moment',
    ADD COLUMN vibe_content text NOT NULL DEFAULT '<p>There is zero pressure for your kids (or adults!) to act perfectly. Real laughter, cozy hugs, and playful moments always make for the best photos. My goal is to capture your family naturally, not force stiff poses.</p><p>Feel free to bring a favorite small toy, comfort item, or non-messy snack to help keep little ones happy. I will gently guide you through a mix of easy prompts and candid moments so you never have to worry about how to stand or what to do with your hands. Even in just 15 to 20 minutes, we''ll capture a full gallery of genuine, heartwarming memories.</p>',
    ADD COLUMN homepage_hero_cta_label text NOT NULL DEFAULT 'Mini Sessions now booking',
    ADD COLUMN faqs jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT mini_session_campaigns_experience_headline_length_check CHECK (char_length(experience_headline) <= 200),
    ADD CONSTRAINT mini_session_campaigns_vibe_headline_length_check CHECK (char_length(vibe_headline) <= 200),
    ADD CONSTRAINT mini_session_campaigns_vibe_content_length_check CHECK (char_length(vibe_content) <= 10000),
    ADD CONSTRAINT mini_session_campaigns_homepage_hero_cta_length_check CHECK (char_length(homepage_hero_cta_label) <= 80),
    ADD CONSTRAINT mini_session_campaigns_faqs_shape_check CHECK (public.mini_session_faqs_are_valid(faqs));

UPDATE public.mini_session_campaigns
SET public_label = 'Mini Sessions'
WHERE btrim(public_label) = '' OR public_label = headline;

REVOKE ALL ON FUNCTION public.mini_session_faqs_are_valid(jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mini_session_faqs_are_valid(jsonb)
    TO service_role;

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
        summary, description, experience_headline, vibe_headline, vibe_content,
        duration_minutes, total_price_cents, deposit_cents, balance_due_text,
        date_summary, location_summary, inclusions, cancellation_policy,
        weather_policy, lateness_policy, terms_note, hero_media_id, cta_label,
        homepage_featured, promo_label, promo_headline, promo_copy,
        promo_cta_label, homepage_hero_cta_label, faqs, meta_title,
        meta_description, created_by, updated_by
    ) VALUES (
        source.website_id, source.client_id,
        left(source.internal_name, 113) || ' (Copy)', 'draft',
        source.public_label, source.headline, source.summary, source.description,
        source.experience_headline, source.vibe_headline, source.vibe_content,
        source.duration_minutes, source.total_price_cents, source.deposit_cents,
        source.balance_due_text, source.date_summary, source.location_summary,
        source.inclusions, source.cancellation_policy, source.weather_policy,
        source.lateness_policy, source.terms_note, source.hero_media_id,
        source.cta_label, source.homepage_featured, source.promo_label,
        source.promo_headline, source.promo_copy, source.promo_cta_label,
        source.homepage_hero_cta_label, source.faqs, source.meta_title,
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

REVOKE ALL ON FUNCTION public.mini_session_faqs_are_valid(jsonb)
    FROM PUBLIC, anon, authenticated;
