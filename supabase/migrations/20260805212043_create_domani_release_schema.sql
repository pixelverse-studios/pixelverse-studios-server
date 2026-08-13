-- DEV-1006: Domani release communication schema
--
-- The release tables are intentionally private to the server. Public and
-- dashboard consumers use allowlisted Express APIs rather than Supabase's
-- Data API, so anon/authenticated receive neither grants nor RLS policies.

CREATE TYPE public.release_type AS ENUM (
    'major',
    'minor',
    'patch',
    'roadmap'
);

CREATE TYPE public.release_lifecycle_status AS ENUM (
    'draft',
    'planned',
    'in_progress',
    'released',
    'canceled'
);

CREATE TYPE public.release_visibility AS ENUM (
    'private',
    'public_preview',
    'published'
);

CREATE TYPE public.release_note_type AS ENUM (
    'feature',
    'improvement',
    'fix',
    'breaking'
);

CREATE TYPE public.release_platform AS ENUM ('ios', 'android');

CREATE TYPE public.release_source_type AS ENUM (
    'linear_epic',
    'linear_ticket',
    'milestone',
    'manual'
);

CREATE TYPE public.release_intended_surface AS ENUM (
    'changelog',
    'coming_soon',
    'both'
);

CREATE TYPE public.release_conversion_status AS ENUM (
    'raw',
    'needs_review',
    'approved',
    'failed',
    'superseded'
);

CREATE TYPE public.dashboard_role AS ENUM ('viewer', 'editor', 'admin');

CREATE TABLE public.releases (
    id                uuid                            PRIMARY KEY DEFAULT gen_random_uuid(),
    version           text                            NOT NULL UNIQUE,
    version_major     integer GENERATED ALWAYS AS (
        split_part(version, '.', 1)::integer
    ) STORED,
    version_minor     integer GENERATED ALWAYS AS (
        split_part(version, '.', 2)::integer
    ) STORED,
    version_patch     integer GENERATED ALWAYS AS (
        nullif(split_part(version, '.', 3), '')::integer
    ) STORED,
    slug              text                            NOT NULL UNIQUE,
    title             text                            NOT NULL,
    release_type      public.release_type             NOT NULL,
    lifecycle_status  public.release_lifecycle_status NOT NULL DEFAULT 'draft',
    visibility        public.release_visibility       NOT NULL DEFAULT 'private',
    public_summary    text,
    internal_summary  text,
    target_month      date,
    target_date       date,
    confirmed_date    date,
    released_at       timestamptz,
    owner_user_id     uuid,
    created_by        uuid                            NOT NULL,
    updated_by        uuid                            NOT NULL,
    row_version       bigint                          NOT NULL DEFAULT 1,
    created_at        timestamptz                     NOT NULL DEFAULT now(),
    updated_at        timestamptz                     NOT NULL DEFAULT now(),
    archived_at       timestamptz,
    archived_by       uuid,
    CONSTRAINT releases_version_format_check CHECK (
        version ~ '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(\.(0|[1-9][0-9]{0,8}))?$'
    ),
    CONSTRAINT releases_type_version_shape_check CHECK (
        (release_type = 'patch' AND version_patch IS NOT NULL)
        OR (release_type <> 'patch' AND version_patch IS NULL)
    ),
    CONSTRAINT releases_slug_format_check CHECK (
        slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),
    CONSTRAINT releases_title_check CHECK (
        title = btrim(title)
        AND char_length(title) BETWEEN 1 AND 160
    ),
    CONSTRAINT releases_public_summary_check CHECK (
        public_summary IS NULL OR char_length(public_summary) <= 2000
    ),
    CONSTRAINT releases_internal_summary_check CHECK (
        internal_summary IS NULL OR char_length(internal_summary) <= 10000
    ),
    CONSTRAINT releases_target_month_check CHECK (
        target_month IS NULL OR extract(day FROM target_month) = 1
    ),
    CONSTRAINT releases_row_version_check CHECK (row_version > 0),
    CONSTRAINT releases_archive_fields_check CHECK (
        (archived_at IS NULL AND archived_by IS NULL)
        OR (
            archived_at IS NOT NULL
            AND archived_by IS NOT NULL
            AND visibility = 'private'
        )
    ),
    CONSTRAINT releases_visibility_state_check CHECK (
        visibility = 'private'
        OR (
            visibility = 'public_preview'
            AND lifecycle_status IN ('planned', 'in_progress')
            AND release_type IN ('major', 'minor', 'roadmap')
            AND public_summary IS NOT NULL
            AND char_length(btrim(public_summary)) > 0
        )
        OR (
            visibility = 'published'
            AND lifecycle_status = 'released'
            AND released_at IS NOT NULL
            AND public_summary IS NOT NULL
            AND char_length(btrim(public_summary)) > 0
        )
    ),
    CONSTRAINT releases_patch_preview_check CHECK (
        release_type <> 'patch' OR visibility <> 'public_preview'
    ),
    CONSTRAINT releases_private_lifecycle_check CHECK (
        lifecycle_status NOT IN ('draft', 'canceled') OR visibility = 'private'
    )
);

CREATE UNIQUE INDEX releases_semantic_version_unique
    ON public.releases (
        version_major,
        version_minor,
        coalesce(version_patch, -1)
    );

CREATE INDEX releases_public_preview_idx
    ON public.releases (
        visibility,
        lifecycle_status,
        target_month,
        target_date,
        confirmed_date
    )
    WHERE archived_at IS NULL;

CREATE INDEX releases_changelog_idx
    ON public.releases (visibility, lifecycle_status, released_at DESC)
    WHERE archived_at IS NULL;

CREATE INDEX releases_admin_list_idx
    ON public.releases (updated_at DESC, id DESC)
    WHERE archived_at IS NULL;

CREATE INDEX releases_admin_filters_idx
    ON public.releases (lifecycle_status, visibility, release_type)
    WHERE archived_at IS NULL;

CREATE INDEX releases_owner_user_idx
    ON public.releases (owner_user_id)
    WHERE owner_user_id IS NOT NULL;

CREATE INDEX releases_created_by_idx
    ON public.releases (created_by);

CREATE INDEX releases_updated_by_idx
    ON public.releases (updated_by);

CREATE INDEX releases_archived_by_idx
    ON public.releases (archived_by)
    WHERE archived_by IS NOT NULL;

CREATE TABLE public.release_prds (
    id                        uuid                             PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id                uuid                             NOT NULL REFERENCES public.releases(id),
    raw_markdown              text                             NOT NULL,
    original_filename         text,
    source_type               public.release_source_type       NOT NULL,
    source_reference          text                             NOT NULL,
    source_content_sha256     text                             NOT NULL,
    intended_surface          public.release_intended_surface  NOT NULL DEFAULT 'changelog',
    conversion_status         public.release_conversion_status NOT NULL DEFAULT 'raw',
    latest_conversion_run_id  uuid,
    conversion_error_code     text,
    conversion_error_message  text,
    created_by                uuid                             NOT NULL,
    updated_by                uuid                             NOT NULL,
    row_version               bigint                           NOT NULL DEFAULT 1,
    created_at                timestamptz                      NOT NULL DEFAULT now(),
    updated_at                timestamptz                      NOT NULL DEFAULT now(),
    CONSTRAINT release_prds_id_release_unique UNIQUE (id, release_id),
    CONSTRAINT release_prds_id_release_hash_unique UNIQUE (
        id,
        release_id,
        source_content_sha256
    ),
    CONSTRAINT release_prds_idempotency_unique UNIQUE (
        release_id,
        source_type,
        source_reference,
        source_content_sha256
    ),
    CONSTRAINT release_prds_markdown_size_check CHECK (
        octet_length(raw_markdown) BETWEEN 1 AND 1048576
    ),
    CONSTRAINT release_prds_filename_check CHECK (
        original_filename IS NULL
        OR (
            original_filename = btrim(original_filename)
            AND char_length(original_filename) BETWEEN 1 AND 255
            AND original_filename !~ '[/\\]'
        )
    ),
    CONSTRAINT release_prds_source_reference_check CHECK (
        source_reference = btrim(source_reference)
        AND char_length(source_reference) BETWEEN 1 AND 2048
    ),
    CONSTRAINT release_prds_sha256_check CHECK (
        source_content_sha256 ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT release_prds_row_version_check CHECK (row_version > 0),
    CONSTRAINT release_prds_failure_metadata_check CHECK (
        (
            conversion_status = 'failed'
            AND conversion_error_code IS NOT NULL
            AND char_length(btrim(conversion_error_code)) > 0
        )
        OR (
            conversion_status IN ('raw', 'needs_review', 'approved')
            AND conversion_error_code IS NULL
            AND conversion_error_message IS NULL
        )
        OR (
            conversion_status = 'superseded'
            AND (
                (
                    conversion_error_code IS NULL
                    AND conversion_error_message IS NULL
                )
                OR (
                    conversion_error_code IS NOT NULL
                    AND char_length(btrim(conversion_error_code)) > 0
                )
            )
        )
    )
);

CREATE INDEX release_prds_release_created_idx
    ON public.release_prds (release_id, created_at DESC);

CREATE INDEX release_prds_status_updated_idx
    ON public.release_prds (conversion_status, updated_at DESC);

CREATE INDEX release_prds_content_hash_idx
    ON public.release_prds (source_content_sha256);

CREATE UNIQUE INDEX release_prds_current_source_unique
    ON public.release_prds (release_id, source_type, source_reference)
    WHERE conversion_status <> 'superseded';

CREATE INDEX release_prds_latest_conversion_idx
    ON public.release_prds (latest_conversion_run_id)
    WHERE latest_conversion_run_id IS NOT NULL;

CREATE INDEX release_prds_created_by_idx
    ON public.release_prds (created_by);

CREATE INDEX release_prds_updated_by_idx
    ON public.release_prds (updated_by);

CREATE TABLE public.release_conversion_runs (
    id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id             uuid        NOT NULL,
    prd_id                 uuid        NOT NULL,
    source_content_sha256  text        NOT NULL,
    converter_version      text        NOT NULL,
    provider               text,
    model                  text,
    status                 text        NOT NULL,
    error_code             text,
    error_message          text,
    superseded_by_run_id   uuid,
    created_by             uuid        NOT NULL,
    started_at             timestamptz NOT NULL DEFAULT now(),
    completed_at           timestamptz,
    CONSTRAINT release_conversion_runs_id_source_release_unique UNIQUE (
        id,
        prd_id,
        release_id
    ),
    CONSTRAINT release_conversion_runs_source_fk FOREIGN KEY (
        prd_id,
        release_id,
        source_content_sha256
    ) REFERENCES public.release_prds (id, release_id, source_content_sha256),
    CONSTRAINT release_conversion_runs_sha256_check CHECK (
        source_content_sha256 ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT release_conversion_runs_converter_check CHECK (
        converter_version = btrim(converter_version)
        AND char_length(converter_version) BETWEEN 1 AND 100
    ),
    CONSTRAINT release_conversion_runs_provider_model_check CHECK (
        model IS NULL OR provider IS NOT NULL
    ),
    CONSTRAINT release_conversion_runs_status_check CHECK (
        status IN ('running', 'succeeded', 'failed', 'superseded')
    ),
    CONSTRAINT release_conversion_runs_state_check CHECK (
        (
            status = 'running'
            AND completed_at IS NULL
            AND error_code IS NULL
            AND error_message IS NULL
            AND superseded_by_run_id IS NULL
        )
        OR (
            status = 'succeeded'
            AND completed_at IS NOT NULL
            AND error_code IS NULL
            AND error_message IS NULL
            AND superseded_by_run_id IS NULL
        )
        OR (
            status = 'failed'
            AND completed_at IS NOT NULL
            AND error_code IS NOT NULL
            AND char_length(btrim(error_code)) > 0
            AND superseded_by_run_id IS NULL
        )
        OR (
            status = 'superseded'
            AND completed_at IS NOT NULL
            AND superseded_by_run_id IS NOT NULL
            AND superseded_by_run_id <> id
        )
    )
);

ALTER TABLE public.release_conversion_runs
    ADD CONSTRAINT release_conversion_runs_superseded_by_fk
    FOREIGN KEY (superseded_by_run_id, prd_id, release_id)
    REFERENCES public.release_conversion_runs (id, prd_id, release_id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.release_prds
    ADD CONSTRAINT release_prds_latest_conversion_fk
    FOREIGN KEY (latest_conversion_run_id, id, release_id)
    REFERENCES public.release_conversion_runs (id, prd_id, release_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX release_conversion_runs_prd_started_idx
    ON public.release_conversion_runs (prd_id, started_at DESC);

CREATE INDEX release_conversion_runs_source_idx
    ON public.release_conversion_runs (
        prd_id,
        release_id,
        source_content_sha256
    );

CREATE INDEX release_conversion_runs_release_started_idx
    ON public.release_conversion_runs (release_id, started_at DESC);

CREATE INDEX release_conversion_runs_created_by_idx
    ON public.release_conversion_runs (created_by);

CREATE INDEX release_conversion_runs_superseded_by_idx
    ON public.release_conversion_runs (superseded_by_run_id)
    WHERE superseded_by_run_id IS NOT NULL;

CREATE TABLE public.release_notes (
    id                        uuid                     PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id                uuid                     NOT NULL REFERENCES public.releases(id),
    note_type                 public.release_note_type NOT NULL,
    public_title              text                     NOT NULL,
    public_body               text                     NOT NULL,
    technical_notes           text,
    platforms                 public.release_platform[] NOT NULL,
    is_public                 boolean                  NOT NULL DEFAULT false,
    sort_order                integer                  NOT NULL,
    source_prd_id             uuid,
    source_conversion_run_id  uuid,
    created_by                uuid                     NOT NULL,
    updated_by                uuid                     NOT NULL,
    row_version               bigint                   NOT NULL DEFAULT 1,
    created_at                timestamptz              NOT NULL DEFAULT now(),
    updated_at                timestamptz              NOT NULL DEFAULT now(),
    archived_at               timestamptz,
    archived_by               uuid,
    CONSTRAINT release_notes_title_check CHECK (
        public_title = btrim(public_title)
        AND char_length(public_title) BETWEEN 1 AND 160
    ),
    CONSTRAINT release_notes_body_check CHECK (
        public_body = btrim(public_body)
        AND char_length(public_body) BETWEEN 1 AND 4000
    ),
    CONSTRAINT release_notes_technical_notes_check CHECK (
        technical_notes IS NULL OR char_length(technical_notes) <= 20000
    ),
    CONSTRAINT release_notes_platforms_check CHECK (
        cardinality(platforms) BETWEEN 1 AND 2
        AND array_lower(platforms, 1) = 1
        AND array_position(platforms, NULL) IS NULL
        AND (
            cardinality(platforms) = 1
            OR platforms[1] <> platforms[2]
        )
    ),
    CONSTRAINT release_notes_sort_order_check CHECK (sort_order >= 0),
    CONSTRAINT release_notes_row_version_check CHECK (row_version > 0),
    CONSTRAINT release_notes_archive_fields_check CHECK (
        (archived_at IS NULL AND archived_by IS NULL)
        OR (archived_at IS NOT NULL AND archived_by IS NOT NULL)
    ),
    CONSTRAINT release_notes_source_pair_check CHECK (
        (source_prd_id IS NULL AND source_conversion_run_id IS NULL)
        OR (source_prd_id IS NOT NULL AND source_conversion_run_id IS NOT NULL)
    ),
    CONSTRAINT release_notes_source_prd_fk FOREIGN KEY (source_prd_id, release_id)
        REFERENCES public.release_prds (id, release_id),
    CONSTRAINT release_notes_source_run_fk FOREIGN KEY (
        source_conversion_run_id,
        source_prd_id,
        release_id
    ) REFERENCES public.release_conversion_runs (id, prd_id, release_id)
);

CREATE UNIQUE INDEX release_notes_release_sort_active_unique
    ON public.release_notes (release_id, sort_order)
    WHERE archived_at IS NULL;

CREATE INDEX release_notes_platforms_active_gin
    ON public.release_notes USING gin (platforms)
    WHERE archived_at IS NULL;

CREATE INDEX release_notes_release_public_order_idx
    ON public.release_notes (release_id, is_public, sort_order, id)
    WHERE archived_at IS NULL;

CREATE INDEX release_notes_source_prd_idx
    ON public.release_notes (source_prd_id, release_id)
    WHERE source_prd_id IS NOT NULL;

CREATE INDEX release_notes_source_run_idx
    ON public.release_notes (
        source_conversion_run_id,
        source_prd_id,
        release_id
    )
    WHERE source_conversion_run_id IS NOT NULL;

CREATE INDEX release_notes_created_by_idx
    ON public.release_notes (created_by);

CREATE INDEX release_notes_updated_by_idx
    ON public.release_notes (updated_by);

CREATE INDEX release_notes_archived_by_idx
    ON public.release_notes (archived_by)
    WHERE archived_by IS NOT NULL;

CREATE TABLE public.release_audit_events (
    id             uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id  uuid                  NOT NULL,
    actor_email    text                  NOT NULL,
    actor_role     public.dashboard_role NOT NULL,
    action         text                  NOT NULL,
    entity_type    text                  NOT NULL,
    entity_id      uuid                  NOT NULL,
    release_id     uuid                  NOT NULL REFERENCES public.releases(id),
    request_id     text                  NOT NULL,
    before_data    jsonb,
    after_data     jsonb,
    metadata       jsonb                 NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz           NOT NULL DEFAULT now(),
    CONSTRAINT release_audit_events_actor_email_check CHECK (
        actor_email = lower(btrim(actor_email))
        AND char_length(actor_email) BETWEEN 3 AND 320
    ),
    CONSTRAINT release_audit_events_action_check CHECK (
        action IN (
            'release.created',
            'release.updated',
            'release.archived',
            'release.preview_published',
            'release.preview_returned_private',
            'release.published',
            'release.unpublished',
            'note.created',
            'note.updated',
            'note.archived',
            'note.reordered',
            'source.imported',
            'source.superseded',
            'source.approved',
            'conversion.started',
            'conversion.succeeded',
            'conversion.failed',
            'conversion.superseded'
        )
    ),
    CONSTRAINT release_audit_events_entity_type_check CHECK (
        entity_type IN ('release', 'note', 'source', 'conversion_run')
    ),
    CONSTRAINT release_audit_events_request_id_check CHECK (
        request_id = btrim(request_id)
        AND char_length(request_id) BETWEEN 1 AND 255
    ),
    CONSTRAINT release_audit_events_json_objects_check CHECK (
        (before_data IS NULL OR jsonb_typeof(before_data) = 'object')
        AND (after_data IS NULL OR jsonb_typeof(after_data) = 'object')
        AND jsonb_typeof(metadata) = 'object'
    )
);

CREATE INDEX release_audit_events_release_created_idx
    ON public.release_audit_events (release_id, created_at DESC);

CREATE INDEX release_audit_events_actor_created_idx
    ON public.release_audit_events (actor_user_id, created_at DESC);

CREATE INDEX release_audit_events_action_created_idx
    ON public.release_audit_events (action, created_at DESC);

CREATE TABLE public.release_cache_invalidation_jobs (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id       uuid        NOT NULL REFERENCES public.releases(id),
    event_key        text        NOT NULL UNIQUE,
    targets          text[]      NOT NULL,
    status           text        NOT NULL DEFAULT 'pending',
    attempt_count    integer     NOT NULL DEFAULT 0,
    next_attempt_at  timestamptz NOT NULL DEFAULT now(),
    last_error       text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    delivered_at     timestamptz,
    CONSTRAINT release_cache_jobs_event_key_check CHECK (
        event_key = btrim(event_key)
        AND char_length(event_key) BETWEEN 1 AND 255
    ),
    CONSTRAINT release_cache_jobs_targets_check CHECK (
        cardinality(targets) BETWEEN 1 AND 4
        AND array_lower(targets, 1) = 1
        AND array_position(targets, NULL) IS NULL
        AND targets <@ ARRAY[
            '/api/domani/releases/coming-soon',
            '/api/domani/releases/changelog',
            '/coming-soon',
            '/changelog'
        ]::text[]
        AND cardinality(array_positions(targets, '/api/domani/releases/coming-soon')) <= 1
        AND cardinality(array_positions(targets, '/api/domani/releases/changelog')) <= 1
        AND cardinality(array_positions(targets, '/coming-soon')) <= 1
        AND cardinality(array_positions(targets, '/changelog')) <= 1
    ),
    CONSTRAINT release_cache_jobs_status_check CHECK (
        status IN ('pending', 'delivered', 'failed')
    ),
    CONSTRAINT release_cache_jobs_attempt_count_check CHECK (attempt_count >= 0),
    CONSTRAINT release_cache_jobs_delivery_check CHECK (
        (status = 'delivered' AND delivered_at IS NOT NULL)
        OR (status <> 'delivered' AND delivered_at IS NULL)
    )
);

CREATE INDEX release_cache_jobs_dispatch_idx
    ON public.release_cache_invalidation_jobs (status, next_attempt_at);

CREATE INDEX release_cache_jobs_release_created_idx
    ON public.release_cache_invalidation_jobs (release_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_release_prd_content_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.raw_markdown IS DISTINCT FROM OLD.raw_markdown
        OR NEW.source_content_sha256 IS DISTINCT FROM OLD.source_content_sha256
    THEN
        RAISE EXCEPTION 'release PRD source content is immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER release_prds_prevent_content_change
BEFORE UPDATE OF raw_markdown, source_content_sha256 ON public.release_prds
FOR EACH ROW EXECUTE FUNCTION public.prevent_release_prd_content_change();

CREATE OR REPLACE FUNCTION public.prevent_release_audit_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'release audit events are immutable'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER release_audit_events_prevent_change
BEFORE UPDATE OR DELETE ON public.release_audit_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_release_audit_change();

-- Keep timestamptz values tied to the current instant in every session time
-- zone. The earlier shared definition converted now() to a timestamp without
-- time zone before assigning it back to timestamptz, which shifted the instant
-- whenever the session was not UTC.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER releases_set_updated_at
BEFORE UPDATE ON public.releases
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER release_prds_set_updated_at
BEFORE UPDATE ON public.release_prds
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER release_notes_set_updated_at
BEFORE UPDATE ON public.release_notes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER release_cache_jobs_set_updated_at
BEFORE UPDATE ON public.release_cache_invalidation_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_prds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_conversion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_cache_invalidation_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.releases,
    public.release_prds,
    public.release_conversion_runs,
    public.release_notes,
    public.release_audit_events,
    public.release_cache_invalidation_jobs
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
    public.releases,
    public.release_prds,
    public.release_conversion_runs,
    public.release_notes,
    public.release_cache_invalidation_jobs
TO service_role;

GRANT SELECT, INSERT ON TABLE public.release_audit_events
TO service_role;

REVOKE ALL ON FUNCTION public.prevent_release_prd_content_change()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.prevent_release_audit_change()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.prevent_release_prd_content_change()
TO service_role;

GRANT EXECUTE ON FUNCTION public.prevent_release_audit_change()
TO service_role;

COMMENT ON TABLE public.releases IS
    'Private Domani release aggregate; public reads are served by allowlisted server DTOs.';

COMMENT ON COLUMN public.release_prds.raw_markdown IS
    'Immutable private UTF-8 Markdown; never expose through public APIs or object storage.';

COMMENT ON COLUMN public.release_notes.technical_notes IS
    'Private implementation detail excluded from all public release DTOs.';

NOTIFY pgrst, 'reload schema';
