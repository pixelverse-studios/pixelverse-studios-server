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
