-- Refresh RPCs after canonical X.Y.Z release-version enforcement.

CREATE OR REPLACE FUNCTION public.list_public_domani_releases(
    p_collection text,
    p_platform public.release_platform DEFAULT NULL,
    p_page_limit integer DEFAULT 20,
    p_cursor_primary text DEFAULT NULL,
    p_cursor_version_major integer DEFAULT NULL,
    p_cursor_version_minor integer DEFAULT NULL,
    p_cursor_version_patch integer DEFAULT NULL,
    p_cursor_id uuid DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    version text,
    slug text,
    title text,
    release_type public.release_type,
    lifecycle_status public.release_lifecycle_status,
    public_summary text,
    target_month date,
    target_date date,
    confirmed_date date,
    released_at timestamptz,
    sort_primary text,
    notes jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
WITH eligible AS (
    SELECT
        release.id,
        release.version,
        release.slug,
        release.title,
        release.release_type,
        release.lifecycle_status,
        release.public_summary,
        release.target_month,
        release.target_date,
        release.confirmed_date,
        release.released_at,
        release.version_major,
        release.version_minor,
        coalesce(release.version_patch, -1) AS version_patch,
        coalesce(
            release.confirmed_date,
            release.target_date,
            release.target_month
        ) AS effective_date
    FROM public.releases AS release
    WHERE release.archived_at IS NULL
      AND (
          (
              p_collection = 'coming-soon'
              AND release.visibility = 'public_preview'
              AND release.lifecycle_status IN ('planned', 'in_progress')
              AND release.release_type IN ('major', 'minor')
          )
          OR (
              p_collection = 'changelog'
              AND release.visibility = 'published'
              AND release.lifecycle_status = 'released'
              AND release.released_at IS NOT NULL
          )
      )
      AND EXISTS (
          SELECT 1
          FROM public.release_notes AS note
          WHERE note.release_id = release.id
            AND note.is_public = true
            AND note.archived_at IS NULL
            AND (
                p_platform IS NULL
                OR note.platforms @> ARRAY[p_platform]::public.release_platform[]
            )
      )
),
cursor_page AS (
    SELECT eligible.*
    FROM eligible
    WHERE p_cursor_id IS NULL
       OR (
          p_collection = 'coming-soon'
          AND (
              (
                  p_cursor_primary IS NOT NULL
                  AND (
                      eligible.effective_date > p_cursor_primary::date
                      OR eligible.effective_date IS NULL
                      OR (
                          eligible.effective_date = p_cursor_primary::date
                          AND (
                              (eligible.version_major, eligible.version_minor, eligible.version_patch)
                                  > (p_cursor_version_major, p_cursor_version_minor, p_cursor_version_patch)
                              OR (
                                  (eligible.version_major, eligible.version_minor, eligible.version_patch)
                                      = (p_cursor_version_major, p_cursor_version_minor, p_cursor_version_patch)
                                  AND eligible.id > p_cursor_id
                              )
                          )
                      )
                  )
              )
              OR (
                  p_cursor_primary IS NULL
                  AND eligible.effective_date IS NULL
                  AND (
                      (eligible.version_major, eligible.version_minor, eligible.version_patch)
                          > (p_cursor_version_major, p_cursor_version_minor, p_cursor_version_patch)
                      OR (
                          (eligible.version_major, eligible.version_minor, eligible.version_patch)
                              = (p_cursor_version_major, p_cursor_version_minor, p_cursor_version_patch)
                          AND eligible.id > p_cursor_id
                      )
                  )
              )
          )
       )
       OR (
          p_collection = 'changelog'
          AND (
              eligible.released_at < p_cursor_primary::timestamptz
              OR (
                  eligible.released_at = p_cursor_primary::timestamptz
                  AND (
                      (eligible.version_major, eligible.version_minor, eligible.version_patch)
                          < (p_cursor_version_major, p_cursor_version_minor, p_cursor_version_patch)
                      OR (
                          (eligible.version_major, eligible.version_minor, eligible.version_patch)
                              = (p_cursor_version_major, p_cursor_version_minor, p_cursor_version_patch)
                          AND eligible.id > p_cursor_id
                      )
                  )
              )
          )
       )
    ORDER BY
        CASE WHEN p_collection = 'coming-soon' THEN eligible.effective_date END ASC NULLS LAST,
        CASE WHEN p_collection = 'coming-soon' THEN eligible.version_major END ASC,
        CASE WHEN p_collection = 'coming-soon' THEN eligible.version_minor END ASC,
        CASE WHEN p_collection = 'coming-soon' THEN eligible.version_patch END ASC,
        CASE WHEN p_collection = 'changelog' THEN eligible.released_at END DESC,
        CASE WHEN p_collection = 'changelog' THEN eligible.version_major END DESC,
        CASE WHEN p_collection = 'changelog' THEN eligible.version_minor END DESC,
        CASE WHEN p_collection = 'changelog' THEN eligible.version_patch END DESC,
        eligible.id ASC
    LIMIT least(greatest(p_page_limit, 1), 100) + 1
)
SELECT
    page.id,
    page.version,
    page.slug,
    page.title,
    page.release_type,
    page.lifecycle_status,
    page.public_summary,
    page.target_month,
    page.target_date,
    page.confirmed_date,
    page.released_at,
    CASE
        WHEN p_collection = 'changelog' THEN page.released_at::text
        ELSE page.effective_date::text
    END AS sort_primary,
    notes.items
FROM cursor_page AS page
CROSS JOIN LATERAL (
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', ordered_note.id,
            'note_type', ordered_note.note_type,
            'public_title', ordered_note.public_title,
            'public_body', ordered_note.public_body,
            'platforms', ordered_note.platforms,
            'sort_order', ordered_note.sort_order
        )
        ORDER BY ordered_note.sort_order ASC, ordered_note.id ASC
    ) AS items
    FROM public.release_notes AS ordered_note
    WHERE ordered_note.release_id = page.id
      AND ordered_note.is_public = true
      AND ordered_note.archived_at IS NULL
      AND (
          p_platform IS NULL
          OR ordered_note.platforms @> ARRAY[p_platform]::public.release_platform[]
      )
) AS notes
ORDER BY
    CASE WHEN p_collection = 'coming-soon' THEN page.effective_date END ASC NULLS LAST,
    CASE WHEN p_collection = 'coming-soon' THEN page.version_major END ASC,
    CASE WHEN p_collection = 'coming-soon' THEN page.version_minor END ASC,
    CASE WHEN p_collection = 'coming-soon' THEN page.version_patch END ASC,
    CASE WHEN p_collection = 'changelog' THEN page.released_at END DESC,
    CASE WHEN p_collection = 'changelog' THEN page.version_major END DESC,
    CASE WHEN p_collection = 'changelog' THEN page.version_minor END DESC,
    CASE WHEN p_collection = 'changelog' THEN page.version_patch END DESC,
    page.id ASC;
$$;

REVOKE ALL ON FUNCTION public.list_public_domani_releases(
    text,
    public.release_platform,
    integer,
    text,
    integer,
    integer,
    integer,
    uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_public_domani_releases(
    text,
    public.release_platform,
    integer,
    text,
    integer,
    integer,
    integer,
    uuid
) TO service_role;

COMMENT ON FUNCTION public.list_public_domani_releases(
    text,
    public.release_platform,
    integer,
    text,
    integer,
    integer,
    integer,
    uuid
) IS 'Service-role-only keyset feed for public Domani release DTOs.';

NOTIFY pgrst, 'reload schema';

-- DEV-1008: transactional, service-role-only Markdown intake.
CREATE OR REPLACE FUNCTION public.import_domani_release_markdown(
    p_release_id uuid,
    p_release_version text,
    p_release_title text,
    p_release_slug text,
    p_release_type public.release_type,
    p_source_type public.release_source_type,
    p_source_reference text,
    p_raw_markdown text,
    p_original_filename text,
    p_source_content_sha256 text,
    p_intended_surface public.release_intended_surface,
    p_if_match bigint,
    p_actor_user_id uuid,
    p_actor_email text,
    p_actor_role public.dashboard_role,
    p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_release public.releases%ROWTYPE;
    v_source public.release_prds%ROWTYPE;
    v_existing_source public.release_prds%ROWTYPE;
    v_old_source public.release_prds%ROWTYPE;
    v_superseded_source public.release_prds%ROWTYPE;
    v_new_release boolean := false;
    v_constraint text;
BEGIN
    IF p_actor_role NOT IN ('editor', 'admin')
       OR p_actor_user_id IS NULL
       OR nullif(lower(btrim(p_actor_email)), '') IS NULL THEN
        RAISE EXCEPTION 'DEV1008_FORBIDDEN';
    END IF;

    IF (p_release_id IS NULL) = (p_release_version IS NULL) THEN
        RAISE EXCEPTION 'DEV1008_INVALID_SELECTOR';
    END IF;

    IF p_release_id IS NOT NULL THEN
        SELECT release.*
        INTO v_release
        FROM public.releases AS release
        WHERE release.id = p_release_id
          AND release.archived_at IS NULL
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'DEV1008_NOT_FOUND';
        END IF;
    ELSE
        SELECT release.*
        INTO v_release
        FROM public.releases AS release
        WHERE release.version = p_release_version
          AND release.archived_at IS NULL
        FOR UPDATE;

        IF NOT FOUND THEN
            IF p_release_title IS NULL OR p_release_slug IS NULL OR p_release_type IS NULL THEN
                RAISE EXCEPTION 'DEV1008_CREATION_FIELDS_REQUIRED';
            END IF;
            IF p_release_version !~ '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$'
               OR p_release_type <> (CASE
                    WHEN split_part(p_release_version, '.', 3)::integer > 0 THEN 'patch'::public.release_type
                    WHEN split_part(p_release_version, '.', 2)::integer > 0 THEN 'minor'::public.release_type
                    ELSE 'major'::public.release_type
               END) THEN
                RAISE EXCEPTION 'DEV1008_RELEASE_TYPE_INVALID';
            END IF;

            BEGIN
                INSERT INTO public.releases (
                    version,
                    slug,
                    title,
                    release_type,
                    lifecycle_status,
                    visibility,
                    created_by,
                    updated_by
                ) VALUES (
                    p_release_version,
                    p_release_slug,
                    p_release_title,
                    p_release_type,
                    'draft',
                    'private',
                    p_actor_user_id,
                    p_actor_user_id
                )
                RETURNING * INTO v_release;
            EXCEPTION WHEN unique_violation THEN
                GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
                IF v_constraint IN ('releases_version_key', 'releases_semantic_version_unique') THEN
                    RAISE EXCEPTION 'DEV1008_VERSION_ALREADY_EXISTS';
                ELSIF v_constraint = 'releases_slug_key' THEN
                    RAISE EXCEPTION 'DEV1008_SLUG_ALREADY_EXISTS';
                END IF;
                RAISE;
            END;

            v_new_release := true;
        END IF;
    END IF;

    IF NOT v_new_release THEN
        IF p_if_match IS NULL THEN
            RAISE EXCEPTION 'DEV1008_PRECONDITION_REQUIRED';
        END IF;
    END IF;

    IF v_release.visibility = 'published' AND p_actor_role <> 'admin' THEN
        RAISE EXCEPTION 'DEV1008_PUBLISHED_ADMIN_REQUIRED';
    END IF;

    SELECT source.*
    INTO v_existing_source
    FROM public.release_prds AS source
    WHERE source.release_id = v_release.id
      AND source.source_type = p_source_type
      AND source.source_reference = p_source_reference
      AND source.source_content_sha256 = p_source_content_sha256
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_source.intended_surface <> p_intended_surface THEN
            RAISE EXCEPTION 'DEV1008_IDEMPOTENCY_CONFLICT';
        END IF;

        RETURN jsonb_build_object(
            'release', jsonb_build_object(
                'id', v_release.id,
                'version', v_release.version,
                'slug', v_release.slug,
                'title', v_release.title,
                'releaseType', v_release.release_type,
                'lifecycleStatus', v_release.lifecycle_status,
                'visibility', v_release.visibility,
                'publicSummary', v_release.public_summary,
                'internalSummary', v_release.internal_summary,
                'targetMonth', CASE
                    WHEN v_release.target_month IS NULL THEN NULL
                    ELSE to_char(v_release.target_month, 'YYYY-MM')
                END,
                'targetDate', v_release.target_date,
                'confirmedDate', v_release.confirmed_date,
                'releasedAt', v_release.released_at,
                'ownerUserId', v_release.owner_user_id,
                'rowVersion', v_release.row_version,
                'createdAt', v_release.created_at,
                'updatedAt', v_release.updated_at,
                'archivedAt', v_release.archived_at
            ),
            'source', jsonb_build_object(
                'id', v_existing_source.id,
                'releaseId', v_existing_source.release_id,
                'rawMarkdown', v_existing_source.raw_markdown,
                'originalFilename', v_existing_source.original_filename,
                'sourceType', v_existing_source.source_type,
                'sourceReference', v_existing_source.source_reference,
                'sourceContentSha256', v_existing_source.source_content_sha256,
                'intendedSurface', v_existing_source.intended_surface,
                'conversionStatus', v_existing_source.conversion_status,
                'latestConversionRunId', v_existing_source.latest_conversion_run_id,
                'conversionErrorCode', v_existing_source.conversion_error_code,
                'conversionErrorMessage', v_existing_source.conversion_error_message,
                'rowVersion', v_existing_source.row_version,
                'createdAt', v_existing_source.created_at,
                'updatedAt', v_existing_source.updated_at
            ),
            'duplicate', true
        );
    END IF;

    -- Exact duplicates are read-only idempotent retries. They are resolved
    -- above even when the original successful request incremented the release
    -- beyond the retry's If-Match value. A genuinely new mutation must still
    -- match the locked aggregate version.
    IF NOT v_new_release AND v_release.row_version <> p_if_match THEN
        RAISE EXCEPTION 'DEV1008_VERSION_CONFLICT';
    END IF;

    FOR v_old_source IN
        SELECT source.*
        FROM public.release_prds AS source
        WHERE source.release_id = v_release.id
          AND source.source_type = p_source_type
          AND source.source_reference = p_source_reference
          AND source.conversion_status <> 'superseded'
        ORDER BY source.id
        FOR UPDATE
    LOOP
        UPDATE public.release_prds
        SET conversion_status = 'superseded',
            updated_by = p_actor_user_id,
            row_version = row_version + 1
        WHERE id = v_old_source.id
        RETURNING * INTO v_superseded_source;

        INSERT INTO public.release_audit_events (
            actor_user_id,
            actor_email,
            actor_role,
            action,
            entity_type,
            entity_id,
            release_id,
            request_id,
            before_data,
            after_data,
            metadata
        ) VALUES (
            p_actor_user_id,
            p_actor_email,
            p_actor_role,
            'source.superseded',
            'source',
            v_old_source.id,
            v_release.id,
            p_request_id,
            jsonb_build_object(
                'sourceContentSha256', v_old_source.source_content_sha256,
                'intendedSurface', v_old_source.intended_surface,
                'conversionStatus', v_old_source.conversion_status,
                'rowVersion', v_old_source.row_version
            ),
            jsonb_build_object(
                'sourceContentSha256', v_superseded_source.source_content_sha256,
                'intendedSurface', v_superseded_source.intended_surface,
                'conversionStatus', v_superseded_source.conversion_status,
                'rowVersion', v_superseded_source.row_version
            ),
            '{}'::jsonb
        );
    END LOOP;

    INSERT INTO public.release_prds (
        release_id,
        raw_markdown,
        original_filename,
        source_type,
        source_reference,
        source_content_sha256,
        intended_surface,
        conversion_status,
        created_by,
        updated_by
    ) VALUES (
        v_release.id,
        p_raw_markdown,
        p_original_filename,
        p_source_type,
        p_source_reference,
        p_source_content_sha256,
        p_intended_surface,
        'raw',
        p_actor_user_id,
        p_actor_user_id
    )
    RETURNING * INTO v_source;

    IF v_new_release THEN
        INSERT INTO public.release_audit_events (
            actor_user_id,
            actor_email,
            actor_role,
            action,
            entity_type,
            entity_id,
            release_id,
            request_id,
            after_data,
            metadata
        ) VALUES (
            p_actor_user_id,
            p_actor_email,
            p_actor_role,
            'release.created',
            'release',
            v_release.id,
            v_release.id,
            p_request_id,
            jsonb_build_object(
                'version', v_release.version,
                'slug', v_release.slug,
                'title', v_release.title,
                'releaseType', v_release.release_type,
                'lifecycleStatus', v_release.lifecycle_status,
                'visibility', v_release.visibility,
                'rowVersion', v_release.row_version
            ),
            jsonb_build_object('createdByImport', true)
        );
    ELSE
        UPDATE public.releases
        SET updated_by = p_actor_user_id,
            row_version = row_version + 1
        WHERE id = v_release.id
        RETURNING * INTO v_release;
    END IF;

    INSERT INTO public.release_audit_events (
        actor_user_id,
        actor_email,
        actor_role,
        action,
        entity_type,
        entity_id,
        release_id,
        request_id,
        after_data,
        metadata
    ) VALUES (
        p_actor_user_id,
        p_actor_email,
        p_actor_role,
        'source.imported',
        'source',
        v_source.id,
        v_release.id,
        p_request_id,
        jsonb_build_object(
            'sourceContentSha256', v_source.source_content_sha256,
            'originalFilename', v_source.original_filename,
            'sourceType', v_source.source_type,
            'sourceReference', v_source.source_reference,
            'intendedSurface', v_source.intended_surface,
            'conversionStatus', v_source.conversion_status,
            'rowVersion', v_source.row_version
        ),
        jsonb_build_object('duplicate', false)
    );

    RETURN jsonb_build_object(
        'release', jsonb_build_object(
            'id', v_release.id,
            'version', v_release.version,
            'slug', v_release.slug,
            'title', v_release.title,
            'releaseType', v_release.release_type,
            'lifecycleStatus', v_release.lifecycle_status,
            'visibility', v_release.visibility,
            'publicSummary', v_release.public_summary,
            'internalSummary', v_release.internal_summary,
            'targetMonth', CASE
                WHEN v_release.target_month IS NULL THEN NULL
                ELSE to_char(v_release.target_month, 'YYYY-MM')
            END,
            'targetDate', v_release.target_date,
            'confirmedDate', v_release.confirmed_date,
            'releasedAt', v_release.released_at,
            'ownerUserId', v_release.owner_user_id,
            'rowVersion', v_release.row_version,
            'createdAt', v_release.created_at,
            'updatedAt', v_release.updated_at,
            'archivedAt', v_release.archived_at
        ),
        'source', jsonb_build_object(
            'id', v_source.id,
            'releaseId', v_source.release_id,
            'rawMarkdown', v_source.raw_markdown,
            'originalFilename', v_source.original_filename,
            'sourceType', v_source.source_type,
            'sourceReference', v_source.source_reference,
            'sourceContentSha256', v_source.source_content_sha256,
            'intendedSurface', v_source.intended_surface,
            'conversionStatus', v_source.conversion_status,
            'latestConversionRunId', v_source.latest_conversion_run_id,
            'conversionErrorCode', v_source.conversion_error_code,
            'conversionErrorMessage', v_source.conversion_error_message,
            'rowVersion', v_source.row_version,
            'createdAt', v_source.created_at,
            'updatedAt', v_source.updated_at
        ),
        'duplicate', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.import_domani_release_markdown(
    uuid,
    text,
    text,
    text,
    public.release_type,
    public.release_source_type,
    text,
    text,
    text,
    text,
    public.release_intended_surface,
    bigint,
    uuid,
    text,
    public.dashboard_role,
    text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.import_domani_release_markdown(
    uuid,
    text,
    text,
    text,
    public.release_type,
    public.release_source_type,
    text,
    text,
    text,
    text,
    public.release_intended_surface,
    bigint,
    uuid,
    text,
    public.dashboard_role,
    text
) TO service_role;

COMMENT ON FUNCTION public.import_domani_release_markdown(
    uuid,
    text,
    text,
    text,
    public.release_type,
    public.release_source_type,
    text,
    text,
    text,
    text,
    public.release_intended_surface,
    bigint,
    uuid,
    text,
    public.dashboard_role,
    text
) IS 'Service-role-only atomic DEV-1008 Markdown import with release locking, idempotency, supersession, and audit events.';

NOTIFY pgrst, 'reload schema';
