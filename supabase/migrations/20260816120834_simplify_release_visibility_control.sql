-- Visibility is selected directly in the dashboard. Any required lifecycle transition
-- happens atomically in this service-role-only function.
ALTER TABLE public.releases
    DROP CONSTRAINT releases_visibility_state_check;

ALTER TABLE public.releases
    ADD CONSTRAINT releases_visibility_state_check CHECK (
        visibility = 'private'
        OR (
            visibility = 'public_preview'
            AND lifecycle_status IN ('planned', 'in_progress', 'released')
            AND release_type IN ('major', 'minor')
            AND public_summary IS NOT NULL
            AND char_length(btrim(public_summary)) > 0
            AND (lifecycle_status <> 'released' OR released_at IS NOT NULL)
        )
        OR (
            visibility = 'published'
            AND lifecycle_status = 'released'
            AND released_at IS NOT NULL
            AND public_summary IS NOT NULL
            AND char_length(btrim(public_summary)) > 0
        )
    );

CREATE OR REPLACE FUNCTION public.set_admin_domani_release_visibility(
    p_operation text,
    p_release_id uuid,
    p_primary_if_match bigint,
    p_payload jsonb,
    p_actor_user_id uuid,
    p_actor_email text,
    p_actor_role public.dashboard_role,
    p_request_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_release public.releases%ROWTYPE;
    v_before jsonb;
    v_target public.release_visibility;
    v_action text;
    v_targets text[] := ARRAY[]::text[];
    v_audit_event_id uuid;
    v_job_id uuid;
    v_receipt jsonb;
    v_released_at timestamptz;
BEGIN
    IF p_operation <> 'release.set_visibility'
       OR p_actor_user_id IS NULL
       OR nullif(lower(btrim(p_actor_email)), '') IS NULL
       OR p_actor_role = 'viewer' THEN
        RAISE EXCEPTION 'DEV1042_FORBIDDEN';
    END IF;

    SELECT * INTO v_release
    FROM public.releases
    WHERE id = p_release_id AND archived_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'DEV1042_NOT_FOUND'; END IF;
    IF v_release.row_version <> p_primary_if_match THEN RAISE EXCEPTION 'DEV1042_VERSION_CONFLICT'; END IF;

    v_target := (p_payload->>'visibility')::public.release_visibility;
    IF v_target = v_release.visibility THEN
        RETURN jsonb_build_object(
            'data', jsonb_build_object('release', public.admin_release_detail_json(v_release.id, p_actor_role, true)),
            'releaseRowVersion', v_release.row_version,
            'primaryRowVersion', v_release.row_version,
            'cacheInvalidation', NULL
        );
    END IF;

    IF (v_target = 'published' OR v_release.visibility = 'published') AND p_actor_role <> 'admin' THEN
        RAISE EXCEPTION 'DEV1042_PUBLISHED_ADMIN_REQUIRED';
    END IF;
    IF v_target <> 'private' AND v_release.lifecycle_status = 'canceled' THEN
        RAISE EXCEPTION 'DEV1042_INVALID_STATE';
    END IF;
    IF v_target = 'public_preview' AND v_release.release_type = 'patch' THEN
        RAISE EXCEPTION 'DEV1042_INVALID_STATE';
    END IF;
    IF v_target <> 'private' AND (
        nullif(btrim(v_release.public_summary), '') IS NULL
        OR NOT EXISTS (
            SELECT 1 FROM public.release_notes
            WHERE release_id = v_release.id AND archived_at IS NULL AND is_public
        )
    ) THEN
        RAISE EXCEPTION 'DEV1042_PUBLIC_NOTE_REQUIRED';
    END IF;

    IF v_target = 'published' THEN
        v_released_at := COALESCE(
            v_release.released_at,
            (p_payload->>'releasedAt')::timestamptz,
            now()
        );
        IF v_released_at > now() THEN RAISE EXCEPTION 'DEV1042_INVALID_STATE'; END IF;
    END IF;

    v_before := public.admin_release_json(v_release.id);
    IF v_release.visibility = 'public_preview' OR v_target = 'public_preview' THEN
        v_targets := v_targets || ARRAY['/api/domani/releases/coming-soon', '/coming-soon'];
    END IF;
    IF v_release.visibility = 'published' OR v_target = 'published' THEN
        v_targets := v_targets || ARRAY['/api/domani/releases/changelog', '/changelog'];
    END IF;
    SELECT COALESCE(array_agg(DISTINCT target), ARRAY[]::text[])
    INTO v_targets FROM unnest(v_targets) AS target;

    UPDATE public.releases SET
        visibility = v_target,
        lifecycle_status = CASE
            WHEN v_target = 'published' THEN 'released'::public.release_lifecycle_status
            WHEN v_target = 'public_preview' AND lifecycle_status = 'draft' THEN 'planned'::public.release_lifecycle_status
            ELSE lifecycle_status
        END,
        released_at = CASE WHEN v_target = 'published' THEN v_released_at ELSE released_at END,
        updated_by = p_actor_user_id,
        row_version = row_version + 1
    WHERE id = v_release.id
    RETURNING * INTO v_release;

    v_action := CASE
        WHEN v_target = 'public_preview' THEN 'release.preview_published'
        WHEN v_target = 'published' THEN 'release.published'
        WHEN v_before->>'visibility' = 'public_preview' THEN 'release.preview_returned_private'
        ELSE 'release.unpublished'
    END;

    INSERT INTO public.release_audit_events(
        actor_user_id, actor_email, actor_role, action, entity_type, entity_id,
        release_id, request_id, before_data, after_data, metadata
    ) VALUES (
        p_actor_user_id, lower(btrim(p_actor_email)), p_actor_role, v_action,
        'release', v_release.id, v_release.id, p_request_id, v_before,
        public.admin_release_json(v_release.id), jsonb_build_object('source', 'dashboard_visibility_selector')
    ) RETURNING id INTO v_audit_event_id;

    IF cardinality(v_targets) > 0 THEN
        v_job_id := gen_random_uuid();
        INSERT INTO public.release_cache_invalidation_jobs(id, release_id, event_key, targets)
        VALUES(v_job_id, v_release.id, v_audit_event_id::text, v_targets);
        v_receipt := jsonb_build_object('jobId', v_job_id, 'status', 'pending', 'targets', v_targets);
    END IF;

    RETURN jsonb_build_object(
        'data', jsonb_build_object('release', public.admin_release_detail_json(v_release.id, p_actor_role, true)),
        'releaseRowVersion', v_release.row_version,
        'primaryRowVersion', v_release.row_version,
        'cacheInvalidation', v_receipt
    );
EXCEPTION
    WHEN check_violation OR invalid_text_representation OR not_null_violation OR foreign_key_violation THEN
        RAISE EXCEPTION 'DEV1042_INVALID_STATE';
END;
$$;

REVOKE ALL ON FUNCTION public.set_admin_domani_release_visibility(text,uuid,bigint,jsonb,uuid,text,public.dashboard_role,text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_domani_release_visibility(text,uuid,bigint,jsonb,uuid,text,public.dashboard_role,text)
    TO service_role;

NOTIFY pgrst, 'reload schema';
