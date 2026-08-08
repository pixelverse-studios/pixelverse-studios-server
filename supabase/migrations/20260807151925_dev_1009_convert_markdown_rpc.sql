-- DEV-1009: atomic persistence boundary for deterministic Markdown conversion.
CREATE OR REPLACE FUNCTION public.convert_domani_release_markdown(
    p_release_id uuid,
    p_prd_id uuid,
    p_source_if_match bigint,
    p_release_if_match bigint,
    p_converter_version text,
    p_notes jsonb,
    p_failure_code text,
    p_failure_message text,
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
    v_run public.release_conversion_runs%ROWTYPE;
    v_old_run public.release_conversion_runs%ROWTYPE;
    v_note public.release_notes%ROWTYPE;
    v_note_input jsonb;
    v_ordinal bigint;
    v_next_order integer := 0;
    v_notes_result jsonb := '[]'::jsonb;
    v_note_ids jsonb := '[]'::jsonb;
    v_is_failure boolean := p_failure_code IS NOT NULL;
BEGIN
    IF p_actor_role NOT IN ('editor', 'admin') THEN
        RAISE EXCEPTION 'DEV1009_FORBIDDEN';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM public.dashboard_user_roles AS actor_role
        WHERE actor_role.user_id = p_actor_user_id
          AND actor_role.is_active = true
          AND actor_role.role = p_actor_role
    ) THEN
        RAISE EXCEPTION 'DEV1009_ROLE_REQUIRED';
    END IF;

    SELECT release.*
    INTO v_release
    FROM public.releases AS release
    WHERE release.id = p_release_id
      AND release.archived_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DEV1009_NOT_FOUND';
    END IF;
    IF v_release.visibility = 'published' AND p_actor_role <> 'admin' THEN
        RAISE EXCEPTION 'DEV1009_PUBLISHED_ADMIN_REQUIRED';
    END IF;
    IF v_release.row_version <> p_release_if_match THEN
        RAISE EXCEPTION 'DEV1009_RELEASE_VERSION_CONFLICT';
    END IF;

    SELECT source.*
    INTO v_source
    FROM public.release_prds AS source
    WHERE source.id = p_prd_id
      AND source.release_id = p_release_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DEV1009_NOT_FOUND';
    END IF;
    IF v_source.conversion_status = 'superseded' THEN
        RAISE EXCEPTION 'DEV1009_SOURCE_SUPERSEDED';
    END IF;
    IF v_source.row_version <> p_source_if_match THEN
        RAISE EXCEPTION 'DEV1009_SOURCE_VERSION_CONFLICT';
    END IF;

    IF v_is_failure <> (p_notes IS NULL) THEN
        RAISE EXCEPTION 'DEV1009_INVALID_NOTES';
    END IF;
    IF NOT v_is_failure AND jsonb_typeof(p_notes) <> 'array' THEN
        RAISE EXCEPTION 'DEV1009_INVALID_NOTES';
    END IF;
    IF NOT v_is_failure AND jsonb_array_length(p_notes) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'DEV1009_INVALID_NOTES';
    END IF;
    IF NOT v_is_failure AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_notes) AS item(value)
            WHERE jsonb_typeof(item.value) <> 'object'
               OR COALESCE(item.value->>'noteType', '') NOT IN ('feature', 'improvement', 'fix', 'breaking')
               OR char_length(btrim(COALESCE(item.value->>'publicTitle', ''))) NOT BETWEEN 1 AND 160
               OR char_length(btrim(COALESCE(item.value->>'publicBody', ''))) NOT BETWEEN 1 AND 4000
               OR COALESCE(item.value->'technicalNotes', '"missing"'::jsonb) <> 'null'::jsonb
               OR COALESCE(item.value->'platforms', 'null'::jsonb) <> '["ios", "android"]'::jsonb
        ) THEN
        RAISE EXCEPTION 'DEV1009_INVALID_NOTES';
    END IF;

    INSERT INTO public.release_conversion_runs (
        release_id,
        prd_id,
        source_content_sha256,
        converter_version,
        provider,
        model,
        status,
        error_code,
        error_message,
        created_by,
        completed_at
    ) VALUES (
        v_release.id,
        v_source.id,
        v_source.source_content_sha256,
        p_converter_version,
        NULL,
        NULL,
        'running',
        NULL,
        NULL,
        p_actor_user_id,
        NULL
    )
    RETURNING * INTO v_run;

    INSERT INTO public.release_audit_events (
        actor_user_id, actor_email, actor_role, action, entity_type,
        entity_id, release_id, request_id, after_data, metadata
    ) VALUES (
        p_actor_user_id, p_actor_email, p_actor_role, 'conversion.started',
        'conversion_run', v_run.id, v_release.id, p_request_id,
        jsonb_build_object(
            'status', 'running',
            'sourceContentSha256', v_source.source_content_sha256,
            'converterVersion', p_converter_version
        ),
        jsonb_build_object('rewriteMode', 'deterministic')
    );

    IF v_is_failure THEN
        UPDATE public.release_conversion_runs
        SET status = 'failed',
            error_code = left(p_failure_code, 200),
            error_message = left(p_failure_message, 1000),
            completed_at = now()
        WHERE id = v_run.id
        RETURNING * INTO v_run;

        UPDATE public.release_prds
        SET conversion_status = 'failed',
            latest_conversion_run_id = v_run.id,
            conversion_error_code = left(p_failure_code, 200),
            conversion_error_message = left(p_failure_message, 1000),
            updated_by = p_actor_user_id,
            row_version = row_version + 1
        WHERE id = v_source.id
        RETURNING * INTO v_source;

        UPDATE public.releases
        SET updated_by = p_actor_user_id,
            row_version = row_version + 1
        WHERE id = v_release.id
        RETURNING * INTO v_release;

        INSERT INTO public.release_audit_events (
            actor_user_id, actor_email, actor_role, action, entity_type,
            entity_id, release_id, request_id, after_data, metadata
        ) VALUES (
            p_actor_user_id, p_actor_email, p_actor_role, 'conversion.failed',
            'conversion_run', v_run.id, v_release.id, p_request_id,
            jsonb_build_object(
                'status', 'failed',
                'errorCode', v_run.error_code,
                'sourceRowVersion', v_source.row_version,
                'releaseRowVersion', v_release.row_version
            ),
            '{}'::jsonb
        );
        RETURN jsonb_build_object('failed', true);
    END IF;

    -- Every release mutation locks the aggregate first. Child locks use UUID
    -- order consistently to avoid deadlocks with note-management operations.
    PERFORM 1
    FROM public.release_notes AS note
    WHERE note.release_id = v_release.id
      AND note.archived_at IS NULL
    ORDER BY note.id
    FOR UPDATE;

    FOR v_old_run IN
        SELECT run.*
        FROM public.release_conversion_runs AS run
        WHERE run.prd_id = v_source.id
          AND run.release_id = v_release.id
          AND run.status = 'succeeded'
        ORDER BY run.id
        FOR UPDATE
    LOOP
        UPDATE public.release_notes
        SET archived_at = now(),
            archived_by = p_actor_user_id,
            updated_by = p_actor_user_id,
            row_version = row_version + 1
        WHERE release_id = v_release.id
          AND source_prd_id = v_source.id
          AND source_conversion_run_id = v_old_run.id
          AND archived_at IS NULL
          AND is_public = false
          AND row_version = 1
          AND v_source.conversion_status <> 'approved'
          AND v_source.latest_conversion_run_id = v_old_run.id;

        UPDATE public.release_conversion_runs
        SET status = 'superseded',
            superseded_by_run_id = v_run.id
        WHERE id = v_old_run.id
        RETURNING * INTO v_old_run;

        INSERT INTO public.release_audit_events (
            actor_user_id, actor_email, actor_role, action, entity_type,
            entity_id, release_id, request_id, after_data, metadata
        ) VALUES (
            p_actor_user_id, p_actor_email, p_actor_role, 'conversion.superseded',
            'conversion_run', v_old_run.id, v_release.id, p_request_id,
            jsonb_build_object(
                'status', v_old_run.status,
                'supersededByRunId', v_run.id
            ),
            '{}'::jsonb
        );
    END LOOP;

    v_next_order := 0;
    FOR v_note IN
        SELECT note.*
        FROM public.release_notes AS note
        WHERE note.release_id = v_release.id
          AND note.archived_at IS NULL
        ORDER BY note.sort_order, note.id
    LOOP
        IF v_note.sort_order <> v_next_order THEN
            UPDATE public.release_notes
            SET sort_order = v_next_order,
                updated_by = p_actor_user_id,
                row_version = row_version + 1
            WHERE id = v_note.id;
        END IF;
        v_next_order := v_next_order + 1;
    END LOOP;

    FOR v_note_input, v_ordinal IN
        SELECT item.value, item.ordinality
        FROM jsonb_array_elements(p_notes) WITH ORDINALITY AS item(value, ordinality)
        ORDER BY item.ordinality
    LOOP
        INSERT INTO public.release_notes (
            release_id, note_type, public_title, public_body, technical_notes,
            platforms, is_public, sort_order, source_prd_id,
            source_conversion_run_id, created_by, updated_by
        ) VALUES (
            v_release.id,
            (v_note_input->>'noteType')::public.release_note_type,
            btrim(v_note_input->>'publicTitle'),
            btrim(v_note_input->>'publicBody'),
            NULL,
            ARRAY['ios', 'android']::public.release_platform[],
            false,
            v_next_order + v_ordinal::integer - 1,
            v_source.id,
            v_run.id,
            p_actor_user_id,
            p_actor_user_id
        )
        RETURNING * INTO v_note;

        v_note_ids := v_note_ids || jsonb_build_array(v_note.id);
        v_notes_result := v_notes_result || jsonb_build_array(jsonb_build_object(
            'id', v_note.id,
            'releaseId', v_note.release_id,
            'noteType', v_note.note_type,
            'publicTitle', v_note.public_title,
            'publicBody', v_note.public_body,
            'technicalNotes', v_note.technical_notes,
            'platforms', to_jsonb(v_note.platforms),
            'isPublic', v_note.is_public,
            'sortOrder', v_note.sort_order,
            'sourcePrdId', v_note.source_prd_id,
            'sourceConversionRunId', v_note.source_conversion_run_id,
            'rowVersion', v_note.row_version,
            'createdAt', v_note.created_at,
            'updatedAt', v_note.updated_at,
            'archivedAt', v_note.archived_at
        ));
    END LOOP;

    UPDATE public.release_conversion_runs
    SET status = 'succeeded', completed_at = now()
    WHERE id = v_run.id
    RETURNING * INTO v_run;

    UPDATE public.release_prds
    SET conversion_status = 'needs_review',
        latest_conversion_run_id = v_run.id,
        conversion_error_code = NULL,
        conversion_error_message = NULL,
        updated_by = p_actor_user_id,
        row_version = row_version + 1
    WHERE id = v_source.id
    RETURNING * INTO v_source;

    UPDATE public.releases
    SET updated_by = p_actor_user_id,
        row_version = row_version + 1
    WHERE id = v_release.id
    RETURNING * INTO v_release;

    INSERT INTO public.release_audit_events (
        actor_user_id, actor_email, actor_role, action, entity_type,
        entity_id, release_id, request_id, after_data, metadata
    ) VALUES (
        p_actor_user_id, p_actor_email, p_actor_role, 'conversion.succeeded',
        'conversion_run', v_run.id, v_release.id, p_request_id,
        jsonb_build_object(
            'status', v_run.status,
            'sourceRowVersion', v_source.row_version,
            'releaseRowVersion', v_release.row_version,
            'resultingNoteIds', v_note_ids
        ),
        jsonb_build_object('noteCount', jsonb_array_length(v_note_ids))
    );

    RETURN jsonb_build_object(
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
        'conversionRun', jsonb_build_object(
            'id', v_run.id,
            'sourceContentSha256', v_run.source_content_sha256,
            'converterVersion', v_run.converter_version,
            'provider', v_run.provider,
            'model', v_run.model,
            'status', v_run.status,
            'createdAt', v_run.started_at,
            'completedAt', v_run.completed_at,
            'resultingNoteIds', v_note_ids
        ),
        'notes', v_notes_result,
        'releaseRowVersion', v_release.row_version
    );
END;
$$;

REVOKE ALL ON FUNCTION public.convert_domani_release_markdown(
    uuid, uuid, bigint, bigint, text, jsonb, text, text,
    uuid, text, public.dashboard_role, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.convert_domani_release_markdown(
    uuid, uuid, bigint, bigint, text, jsonb, text, text,
    uuid, text, public.dashboard_role, text
) TO service_role;

COMMENT ON FUNCTION public.convert_domani_release_markdown(
    uuid, uuid, bigint, bigint, text, jsonb, text, text,
    uuid, text, public.dashboard_role, text
) IS 'Service-role-only DEV-1009 conversion persistence with aggregate locking, provenance, rerun safety, and audit events.';

NOTIFY pgrst, 'reload schema';
