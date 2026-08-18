-- DEV-1097: Mini Sessions campaign domain
--
-- Campaign presentation and ordered Cal.com booking options are tenant-scoped
-- to one website/client pair. The website never talks to these tables directly;
-- the Pixelverse server uses the service role and returns explicit projections.

CREATE OR REPLACE FUNCTION public.mini_session_inclusions_are_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT jsonb_typeof(value) = 'array'
       AND jsonb_array_length(value) <= 12
       AND NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(value) AS inclusion(item)
           WHERE jsonb_typeof(item) <> 'string'
              OR char_length(btrim(item #>> '{}')) NOT BETWEEN 1 AND 200
       );
$$;

CREATE TABLE public.mini_session_campaigns (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    website_id            uuid        NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
    client_id             uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    internal_name         text        NOT NULL,
    status                text        NOT NULL DEFAULT 'draft',
    public_label          text        NOT NULL DEFAULT '',
    headline              text        NOT NULL DEFAULT '',
    summary               text        NOT NULL DEFAULT '',
    description           text        NOT NULL DEFAULT '',
    duration_minutes      integer     NOT NULL DEFAULT 20,
    total_price_cents     integer     NOT NULL DEFAULT 0,
    deposit_cents         integer     NOT NULL DEFAULT 0,
    balance_due_text      text        NOT NULL DEFAULT '',
    date_summary          text        NOT NULL DEFAULT '',
    location_summary      text        NOT NULL DEFAULT '',
    inclusions            jsonb       NOT NULL DEFAULT '[]'::jsonb,
    cancellation_policy   text        NOT NULL DEFAULT '',
    weather_policy        text        NOT NULL DEFAULT '',
    lateness_policy       text        NOT NULL DEFAULT '',
    terms_note            text        NOT NULL DEFAULT '',
    hero_media_id         bigint,
    cta_label             text        NOT NULL DEFAULT 'Choose your time',
    homepage_featured     boolean     NOT NULL DEFAULT false,
    promo_label           text        NOT NULL DEFAULT '',
    promo_headline        text        NOT NULL DEFAULT '',
    promo_copy            text        NOT NULL DEFAULT '',
    promo_cta_label       text        NOT NULL DEFAULT '',
    meta_title            text        NOT NULL DEFAULT '',
    meta_description      text        NOT NULL DEFAULT '',
    published_at          timestamptz,
    published_by          text,
    created_by            text,
    updated_by            text,
    created_at            timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at            timestamptz NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT mini_session_campaigns_status_check CHECK (
        status IN ('draft', 'live', 'sold_out', 'closed', 'archived')
    ),
    CONSTRAINT mini_session_campaigns_publication_state_check CHECK (
        status NOT IN ('live', 'sold_out')
        OR (published_at IS NOT NULL AND published_by IS NOT NULL)
    ),
    CONSTRAINT mini_session_campaigns_duration_check CHECK (
        duration_minutes BETWEEN 1 AND 480
    ),
    CONSTRAINT mini_session_campaigns_price_check CHECK (
        total_price_cents BETWEEN 0 AND 10000000
        AND deposit_cents BETWEEN 0 AND total_price_cents
    ),
    CONSTRAINT mini_session_campaigns_internal_name_length_check CHECK (
        char_length(btrim(internal_name)) BETWEEN 1 AND 120
    ),
    CONSTRAINT mini_session_campaigns_public_label_length_check CHECK (char_length(public_label) <= 80),
    CONSTRAINT mini_session_campaigns_headline_length_check CHECK (char_length(headline) <= 160),
    CONSTRAINT mini_session_campaigns_summary_length_check CHECK (char_length(summary) <= 320),
    CONSTRAINT mini_session_campaigns_description_length_check CHECK (char_length(description) <= 5000),
    CONSTRAINT mini_session_campaigns_balance_due_length_check CHECK (char_length(balance_due_text) <= 600),
    CONSTRAINT mini_session_campaigns_date_summary_length_check CHECK (char_length(date_summary) <= 200),
    CONSTRAINT mini_session_campaigns_location_summary_length_check CHECK (char_length(location_summary) <= 200),
    CONSTRAINT mini_session_campaigns_cancellation_length_check CHECK (char_length(cancellation_policy) <= 2000),
    CONSTRAINT mini_session_campaigns_weather_length_check CHECK (char_length(weather_policy) <= 2000),
    CONSTRAINT mini_session_campaigns_lateness_length_check CHECK (char_length(lateness_policy) <= 2000),
    CONSTRAINT mini_session_campaigns_terms_length_check CHECK (char_length(terms_note) <= 2000),
    CONSTRAINT mini_session_campaigns_cta_length_check CHECK (char_length(cta_label) <= 80),
    CONSTRAINT mini_session_campaigns_promo_label_length_check CHECK (char_length(promo_label) <= 80),
    CONSTRAINT mini_session_campaigns_promo_headline_length_check CHECK (char_length(promo_headline) <= 160),
    CONSTRAINT mini_session_campaigns_promo_copy_length_check CHECK (char_length(promo_copy) <= 320),
    CONSTRAINT mini_session_campaigns_promo_cta_length_check CHECK (char_length(promo_cta_label) <= 80),
    CONSTRAINT mini_session_campaigns_meta_title_length_check CHECK (char_length(meta_title) <= 120),
    CONSTRAINT mini_session_campaigns_meta_description_length_check CHECK (char_length(meta_description) <= 320),
    CONSTRAINT mini_session_campaigns_inclusions_shape_check CHECK (
        public.mini_session_inclusions_are_valid(inclusions)
    ),
    CONSTRAINT mini_session_campaigns_website_client_fk FOREIGN KEY (
        website_id,
        client_id
    ) REFERENCES public.websites (id, client_id) ON DELETE CASCADE,
    CONSTRAINT mini_session_campaigns_hero_media_tenant_fk FOREIGN KEY (
        hero_media_id,
        website_id,
        client_id
    ) REFERENCES public.media_catalog_items (
        id,
        website_id,
        client_id
    ) ON DELETE RESTRICT,
    CONSTRAINT mini_session_campaigns_id_tenant_unique UNIQUE (
        id,
        website_id,
        client_id
    )
);

CREATE UNIQUE INDEX mini_session_campaigns_one_public_per_website_idx
    ON public.mini_session_campaigns (website_id)
    WHERE status IN ('live', 'sold_out');

CREATE INDEX mini_session_campaigns_website_status_updated_idx
    ON public.mini_session_campaigns (website_id, status, updated_at DESC);

CREATE INDEX mini_session_campaigns_client_id_idx
    ON public.mini_session_campaigns (client_id);

CREATE INDEX mini_session_campaigns_hero_media_id_idx
    ON public.mini_session_campaigns (hero_media_id)
    WHERE hero_media_id IS NOT NULL;

CREATE TABLE public.mini_session_booking_options (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     uuid        NOT NULL,
    website_id      uuid        NOT NULL,
    client_id       uuid        NOT NULL,
    label           text        NOT NULL,
    description     text        NOT NULL DEFAULT '',
    date_time_label text        NOT NULL DEFAULT '',
    location_label  text        NOT NULL DEFAULT '',
    cal_booking_url text        NOT NULL,
    status          text        NOT NULL DEFAULT 'open',
    sort_order      integer     NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT mini_session_booking_options_status_check CHECK (
        status IN ('open', 'sold_out', 'hidden')
    ),
    CONSTRAINT mini_session_booking_options_sort_order_check CHECK (
        sort_order BETWEEN 0 AND 5
    ),
    CONSTRAINT mini_session_booking_options_label_length_check CHECK (
        char_length(btrim(label)) BETWEEN 1 AND 120
    ),
    CONSTRAINT mini_session_booking_options_description_length_check CHECK (char_length(description) <= 600),
    CONSTRAINT mini_session_booking_options_date_time_length_check CHECK (char_length(date_time_label) <= 200),
    CONSTRAINT mini_session_booking_options_location_length_check CHECK (char_length(location_label) <= 200),
    CONSTRAINT mini_session_booking_options_url_length_check CHECK (char_length(cal_booking_url) <= 2048),
    CONSTRAINT mini_session_booking_options_cal_url_check CHECK (
        cal_booking_url ~* '^https://(www\.)?cal\.com(/[^[:space:]]*)?$'
    ),
    CONSTRAINT mini_session_booking_options_sort_unique UNIQUE (
        campaign_id,
        sort_order
    ),
    CONSTRAINT mini_session_booking_options_campaign_tenant_fk FOREIGN KEY (
        campaign_id,
        website_id,
        client_id
    ) REFERENCES public.mini_session_campaigns (
        id,
        website_id,
        client_id
    ) ON DELETE CASCADE
);

CREATE INDEX mini_session_booking_options_campaign_order_idx
    ON public.mini_session_booking_options (campaign_id, sort_order);

CREATE INDEX mini_session_booking_options_website_status_idx
    ON public.mini_session_booking_options (website_id, status);

CREATE TABLE public.mini_session_campaign_audit_logs (
    id          bigint      GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    campaign_id uuid,
    website_id  uuid        NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
    client_id   uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    action      text        NOT NULL,
    actor       text,
    old_values  jsonb,
    new_values  jsonb,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT mini_session_campaign_audit_logs_action_check CHECK (
        action IN (
            'created',
            'draft_saved',
            'duplicated',
            'published',
            'marked_sold_out',
            'closed',
            'archived',
            'booking_options_changed'
        )
    ),
    CONSTRAINT mini_session_campaign_audit_logs_website_client_fk FOREIGN KEY (
        website_id,
        client_id
    ) REFERENCES public.websites (id, client_id) ON DELETE CASCADE,
    CONSTRAINT mini_session_campaign_audit_logs_campaign_tenant_fk FOREIGN KEY (
        campaign_id,
        website_id,
        client_id
    ) REFERENCES public.mini_session_campaigns (
        id,
        website_id,
        client_id
    ) ON DELETE SET NULL (campaign_id)
);

CREATE INDEX mini_session_campaign_audit_logs_website_created_idx
    ON public.mini_session_campaign_audit_logs (website_id, created_at DESC);

CREATE INDEX mini_session_campaign_audit_logs_campaign_created_idx
    ON public.mini_session_campaign_audit_logs (campaign_id, created_at DESC)
    WHERE campaign_id IS NOT NULL;

ALTER TABLE public.mini_session_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mini_session_booking_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mini_session_campaign_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mini_session_campaigns FROM anon, authenticated;
REVOKE ALL ON TABLE public.mini_session_booking_options FROM anon, authenticated;
REVOKE ALL ON TABLE public.mini_session_campaign_audit_logs FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.mini_session_inclusions_are_valid(jsonb)
    FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mini_session_campaigns TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mini_session_booking_options TO service_role;
GRANT SELECT, INSERT ON TABLE public.mini_session_campaign_audit_logs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.mini_session_campaign_audit_logs_id_seq TO service_role;
GRANT EXECUTE ON FUNCTION public.mini_session_inclusions_are_valid(jsonb)
    TO service_role;

CREATE TRIGGER mini_session_campaigns_set_updated_at
BEFORE UPDATE ON public.mini_session_campaigns
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER mini_session_booking_options_set_updated_at
BEFORE UPDATE ON public.mini_session_booking_options
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Publishing must close the currently public campaign and publish the target
-- in one database transaction. The function remains invoker-security and is
-- executable only by the server role.
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
    SELECT *
    INTO target
    FROM public.mini_session_campaigns
    WHERE id = p_campaign_id
      AND website_id = p_website_id
      AND client_id = p_client_id
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
        SELECT 1
        FROM public.media_catalog_items media
        WHERE media.id = target.hero_media_id
          AND media.website_id = p_website_id
          AND media.client_id = p_client_id
          AND media.status = 'published'
    ) THEN
        RAISE EXCEPTION 'MINI_SESSION_HERO_MEDIA_INVALID' USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.mini_session_booking_options option
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
       OR btrim(target.balance_due_text) = ''
       OR btrim(target.date_summary) = ''
       OR btrim(target.location_summary) = ''
       OR jsonb_array_length(target.inclusions) = 0
       OR btrim(target.cancellation_policy) = ''
       OR btrim(target.lateness_policy) = ''
       OR btrim(target.cta_label) = ''
       OR target.total_price_cents <= 0
       OR target.deposit_cents <= 0 THEN
        RAISE EXCEPTION 'MINI_SESSION_CAMPAIGN_NOT_READY' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.mini_session_campaigns
    SET status = 'closed',
        updated_by = p_actor
    WHERE website_id = p_website_id
      AND id <> p_campaign_id
      AND status IN ('live', 'sold_out');

    UPDATE public.mini_session_campaigns
    SET status = 'live',
        published_at = timezone('utc', now()),
        published_by = p_actor,
        updated_by = p_actor
    WHERE id = p_campaign_id
      AND website_id = p_website_id
      AND client_id = p_client_id;

    RETURN QUERY
    SELECT *
    FROM public.mini_session_campaigns
    WHERE id = p_campaign_id;
END;
$$;

-- Duplication copies the campaign and ordered options as one transaction while
-- intentionally clearing public lifecycle state.
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
    SELECT *
    INTO source
    FROM public.mini_session_campaigns
    WHERE id = p_campaign_id
      AND website_id = p_website_id
      AND client_id = p_client_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MINI_SESSION_CAMPAIGN_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF source.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'MINI_SESSION_STALE_WRITE' USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.mini_session_campaigns (
        website_id,
        client_id,
        internal_name,
        status,
        public_label,
        headline,
        summary,
        description,
        duration_minutes,
        total_price_cents,
        deposit_cents,
        balance_due_text,
        date_summary,
        location_summary,
        inclusions,
        cancellation_policy,
        weather_policy,
        lateness_policy,
        terms_note,
        hero_media_id,
        cta_label,
        homepage_featured,
        promo_label,
        promo_headline,
        promo_copy,
        promo_cta_label,
        meta_title,
        meta_description,
        created_by,
        updated_by
    ) VALUES (
        source.website_id,
        source.client_id,
        left(source.internal_name, 113) || ' (Copy)',
        'draft',
        source.public_label,
        source.headline,
        source.summary,
        source.description,
        source.duration_minutes,
        source.total_price_cents,
        source.deposit_cents,
        source.balance_due_text,
        source.date_summary,
        source.location_summary,
        source.inclusions,
        source.cancellation_policy,
        source.weather_policy,
        source.lateness_policy,
        source.terms_note,
        source.hero_media_id,
        source.cta_label,
        source.homepage_featured,
        source.promo_label,
        source.promo_headline,
        source.promo_copy,
        source.promo_cta_label,
        source.meta_title,
        source.meta_description,
        p_actor,
        p_actor
    )
    RETURNING id INTO duplicate_id;

    INSERT INTO public.mini_session_booking_options (
        campaign_id,
        website_id,
        client_id,
        label,
        description,
        date_time_label,
        location_label,
        cal_booking_url,
        status,
        sort_order
    )
    SELECT
        duplicate_id,
        website_id,
        client_id,
        label,
        description,
        date_time_label,
        location_label,
        cal_booking_url,
        status,
        sort_order
    FROM public.mini_session_booking_options
    WHERE campaign_id = p_campaign_id
      AND website_id = p_website_id
      AND client_id = p_client_id
    ORDER BY sort_order;

    RETURN duplicate_id;
END;
$$;

-- Save editable campaign content and its complete ordered option set with one
-- optimistic-concurrency check and one transaction. Lifecycle state is not an
-- input, so generic edits cannot publish, close, or archive a campaign.
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
    SELECT *
    INTO target
    FROM public.mini_session_campaigns
    WHERE id = p_campaign_id
      AND website_id = p_website_id
      AND client_id = p_client_id
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

    IF jsonb_typeof(p_booking_options) <> 'array'
       OR jsonb_array_length(p_booking_options) > 6 THEN
        RAISE EXCEPTION 'MINI_SESSION_BOOKING_OPTIONS_INVALID' USING ERRCODE = '22023';
    END IF;

    UPDATE public.mini_session_campaigns
    SET internal_name = p_campaign ->> 'internalName',
        public_label = p_campaign ->> 'publicLabel',
        headline = p_campaign ->> 'headline',
        summary = p_campaign ->> 'summary',
        description = p_campaign ->> 'description',
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
        meta_title = p_campaign ->> 'metaTitle',
        meta_description = p_campaign ->> 'metaDescription',
        updated_by = p_actor
    WHERE id = p_campaign_id
      AND website_id = p_website_id
      AND client_id = p_client_id;

    DELETE FROM public.mini_session_booking_options
    WHERE campaign_id = p_campaign_id
      AND website_id = p_website_id
      AND client_id = p_client_id;

    FOR booking_option IN
        SELECT value FROM jsonb_array_elements(p_booking_options)
    LOOP
        INSERT INTO public.mini_session_booking_options (
            id,
            campaign_id,
            website_id,
            client_id,
            label,
            description,
            date_time_label,
            location_label,
            cal_booking_url,
            status,
            sort_order
        ) VALUES (
            COALESCE((booking_option ->> 'id')::uuid, gen_random_uuid()),
            p_campaign_id,
            p_website_id,
            p_client_id,
            booking_option ->> 'label',
            booking_option ->> 'description',
            booking_option ->> 'dateTimeLabel',
            booking_option ->> 'locationLabel',
            booking_option ->> 'calBookingUrl',
            booking_option ->> 'status',
            (booking_option ->> 'sortOrder')::integer
        );
    END LOOP;

    RETURN QUERY
    SELECT *
    FROM public.mini_session_campaigns
    WHERE id = p_campaign_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_mini_session_campaign(uuid, uuid, uuid, timestamptz, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.duplicate_mini_session_campaign(uuid, uuid, uuid, timestamptz, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_mini_session_campaign(uuid, uuid, uuid, timestamptz, text, jsonb, jsonb)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.publish_mini_session_campaign(uuid, uuid, uuid, timestamptz, text)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.duplicate_mini_session_campaign(uuid, uuid, uuid, timestamptz, text)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.save_mini_session_campaign(uuid, uuid, uuid, timestamptz, text, jsonb, jsonb)
    TO service_role;
