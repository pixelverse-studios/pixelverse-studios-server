-- Existing historical timing remains valid when editing another release field.
-- Only a newly selected historical date or month is rejected.

CREATE OR REPLACE FUNCTION public.save_admin_domani_release_editor_unchecked(
    p_release_id uuid,
    p_primary_if_match bigint,
    p_payload jsonb,
    p_actor_user_id uuid,
    p_actor_email text,
    p_actor_role public.dashboard_role,
    p_request_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET timezone = 'America/New_York'
AS $$
DECLARE
    v_release public.releases%ROWTYPE;
    v_note public.release_notes%ROWTYPE;
    v_before jsonb;
    v_after jsonb;
    v_status text := p_payload->>'status';
    v_timing_kind text := p_payload#>>'{timing,kind}';
    v_timing_value text := p_payload#>>'{timing,value}';
    v_date date;
    v_month date;
    v_visibility public.release_visibility;
    v_lifecycle public.release_lifecycle_status;
    v_released_at timestamptz;
    v_summary text := nullif(public.release_overview_text(p_payload->'publicOverview'), '');
    v_highlight jsonb;
    v_index integer;
    v_audit_event_id uuid;
    v_job_id uuid;
    v_receipt jsonb;
    v_was_public boolean := false;
BEGIN
    IF p_actor_user_id IS NULL OR nullif(lower(btrim(p_actor_email)), '') IS NULL OR p_actor_role = 'viewer' THEN
        RAISE EXCEPTION 'DEV1042_FORBIDDEN';
    END IF;
    IF v_status NOT IN ('draft','published') OR v_timing_kind NOT IN ('date','month','tbd') THEN
        RAISE EXCEPTION 'DEV1042_INVALID_STATE';
    END IF;
    IF jsonb_typeof(p_payload->'highlights') <> 'array'
       OR jsonb_typeof(p_payload->'platforms') <> 'array' THEN
        RAISE EXCEPTION 'DEV1042_INVALID_STATE';
    END IF;

    IF p_release_id IS NOT NULL THEN
        SELECT * INTO v_release FROM public.releases
        WHERE id = p_release_id AND archived_at IS NULL FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'DEV1042_NOT_FOUND'; END IF;
        IF v_release.row_version <> p_primary_if_match THEN RAISE EXCEPTION 'DEV1042_VERSION_CONFLICT'; END IF;
    END IF;

    IF v_timing_kind = 'date' THEN
        IF v_timing_value IS NULL THEN RAISE EXCEPTION 'DEV1042_INVALID_STATE'; END IF;
        v_date := v_timing_value::date;
        IF v_status = 'draft' AND v_date < CURRENT_DATE
           AND (p_release_id IS NULL OR v_release.confirmed_date IS DISTINCT FROM v_date) THEN
            RAISE EXCEPTION 'DEV1042_TARGET_DATE_PAST';
        END IF;
    ELSIF v_timing_kind = 'month' THEN
        IF v_timing_value IS NULL THEN RAISE EXCEPTION 'DEV1042_INVALID_STATE'; END IF;
        v_month := to_date(v_timing_value || '-01', 'YYYY-MM-DD');
        IF v_month < date_trunc('month', CURRENT_DATE)::date
           AND (p_release_id IS NULL OR v_release.target_month IS DISTINCT FROM v_month) THEN
            RAISE EXCEPTION 'DEV1042_TARGET_MONTH_PAST';
        END IF;
    END IF;

    IF v_status = 'published' THEN
        IF v_summary IS NULL OR NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_payload->'highlights') item
            WHERE COALESCE((item->>'isPublic')::boolean, false)
        ) THEN
            RAISE EXCEPTION 'DEV1042_PUBLIC_NOTE_REQUIRED';
        END IF;
        IF v_date IS NOT NULL AND v_date <= CURRENT_DATE THEN
            v_visibility := 'published';
            v_lifecycle := 'released';
            v_released_at := v_date::timestamp AT TIME ZONE 'America/New_York';
        ELSE
            v_visibility := 'public_preview';
            v_lifecycle := 'planned';
            v_released_at := NULL;
        END IF;
    ELSE
        v_visibility := 'private';
        v_lifecycle := 'draft';
        v_released_at := NULL;
    END IF;

    IF p_release_id IS NULL THEN
        INSERT INTO public.releases(
            id,version,slug,title,release_type,lifecycle_status,visibility,
            public_overview,public_summary,internal_summary,target_month,target_date,
            confirmed_date,released_at,platforms,owner_user_id,created_by,updated_by
        ) VALUES (
            gen_random_uuid(),p_payload->>'version',p_payload->>'slug',p_payload->>'title',
            (p_payload->>'releaseType')::public.release_type,v_lifecycle,v_visibility,
            p_payload->'publicOverview',v_summary,p_payload->>'internalSummary',v_month,NULL,
            v_date,v_released_at,
            ARRAY(SELECT jsonb_array_elements_text(p_payload->'platforms'))::public.release_platform[],
            p_actor_user_id,p_actor_user_id,p_actor_user_id
        ) RETURNING * INTO v_release;
    ELSE
        v_before := public.admin_release_detail_json(v_release.id,p_actor_role,true);
        v_was_public := v_release.visibility <> 'private';

        UPDATE public.releases SET
            version = p_payload->>'version',
            release_type = (p_payload->>'releaseType')::public.release_type,
            title = p_payload->>'title',
            lifecycle_status = v_lifecycle,
            visibility = v_visibility,
            public_overview = p_payload->'publicOverview',
            public_summary = v_summary,
            internal_summary = nullif(p_payload->>'internalSummary',''),
            target_month = v_month,
            target_date = NULL,
            confirmed_date = v_date,
            released_at = v_released_at,
            platforms = ARRAY(SELECT jsonb_array_elements_text(p_payload->'platforms'))::public.release_platform[],
            updated_by = p_actor_user_id,
            row_version = row_version + 1
        WHERE id = v_release.id RETURNING * INTO v_release;
    END IF;

    FOR v_highlight, v_index IN
        SELECT item, ordinality::integer - 1
        FROM jsonb_array_elements(p_payload->'highlights') WITH ORDINALITY AS list(item, ordinality)
    LOOP
        SELECT * INTO v_note FROM public.release_notes
        WHERE id = (v_highlight->>'id')::uuid AND release_id = v_release.id FOR UPDATE;

        IF FOUND THEN
            IF v_note.archived_at IS NOT NULL
               OR v_note.row_version <> (v_highlight->>'rowVersion')::bigint THEN
                RAISE EXCEPTION 'DEV1042_NOTE_SET_INVALID';
            END IF;
            UPDATE public.release_notes SET
                note_type = (v_highlight->>'noteType')::public.release_note_type,
                public_title = btrim(v_highlight->>'publicTitle'),
                public_body = btrim(v_highlight->>'publicBody'),
                technical_notes = nullif(v_highlight->>'technicalNotes',''),
                platforms = ARRAY(SELECT jsonb_array_elements_text(v_highlight->'platforms'))::public.release_platform[],
                is_public = (v_highlight->>'isPublic')::boolean,
                sort_order = v_index,
                updated_by = p_actor_user_id,
                row_version = row_version + 1
            WHERE id = v_note.id;
        ELSE
            IF v_highlight->>'rowVersion' IS NOT NULL THEN RAISE EXCEPTION 'DEV1042_NOTE_SET_INVALID'; END IF;
            INSERT INTO public.release_notes(
                id,release_id,note_type,public_title,public_body,technical_notes,
                platforms,is_public,sort_order,created_by,updated_by
            ) VALUES (
                (v_highlight->>'id')::uuid,v_release.id,
                (v_highlight->>'noteType')::public.release_note_type,
                btrim(v_highlight->>'publicTitle'),btrim(v_highlight->>'publicBody'),
                nullif(v_highlight->>'technicalNotes',''),
                ARRAY(SELECT jsonb_array_elements_text(v_highlight->'platforms'))::public.release_platform[],
                (v_highlight->>'isPublic')::boolean,v_index,p_actor_user_id,p_actor_user_id
            );
        END IF;
    END LOOP;

    UPDATE public.release_notes note SET
        archived_at = now(), archived_by = p_actor_user_id,
        updated_by = p_actor_user_id, row_version = note.row_version + 1
    WHERE note.release_id = v_release.id
      AND note.archived_at IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(p_payload->'highlights') item
          WHERE (item->>'id')::uuid = note.id
      );

    v_after := public.admin_release_detail_json(v_release.id,p_actor_role,true);
    INSERT INTO public.release_audit_events(
        actor_user_id,actor_email,actor_role,action,entity_type,entity_id,release_id,
        request_id,before_data,after_data,metadata
    ) VALUES (
        p_actor_user_id,lower(btrim(p_actor_email)),p_actor_role,
        CASE WHEN p_release_id IS NULL THEN 'release.created' ELSE 'release.updated' END,
        'release',v_release.id,v_release.id,p_request_id,v_before,v_after,
        jsonb_build_object('source','dashboard_editor','status',v_status,'highlightCount',jsonb_array_length(p_payload->'highlights'))
    ) RETURNING id INTO v_audit_event_id;

    IF v_was_public OR v_visibility <> 'private' THEN
        v_job_id := gen_random_uuid();
        INSERT INTO public.release_cache_invalidation_jobs(id,release_id,event_key,targets)
        VALUES(
            v_job_id,v_release.id,v_audit_event_id::text,
            ARRAY['/api/domani/releases/coming-soon','/coming-soon','/api/domani/releases/changelog','/changelog']
        );
        v_receipt := jsonb_build_object(
            'jobId',v_job_id,'status','pending',
            'targets',ARRAY['/api/domani/releases/coming-soon','/coming-soon','/api/domani/releases/changelog','/changelog']
        );
    END IF;

    RETURN jsonb_build_object(
        'data',jsonb_build_object('release',public.admin_release_detail_json(v_release.id,p_actor_role,true)),
        'releaseRowVersion',v_release.row_version,
        'primaryRowVersion',v_release.row_version,
        'cacheInvalidation',v_receipt
    );
EXCEPTION
    WHEN unique_violation THEN RAISE;
    WHEN check_violation OR invalid_text_representation OR not_null_violation OR foreign_key_violation THEN
        RAISE EXCEPTION 'DEV1042_INVALID_STATE';
END;
$$;

CREATE OR REPLACE FUNCTION public.save_admin_domani_release_editor(
    p_release_id uuid,
    p_primary_if_match bigint,
    p_payload jsonb,
    p_actor_user_id uuid,
    p_actor_email text,
    p_actor_role public.dashboard_role,
    p_request_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET timezone = 'America/New_York'
AS $$
BEGIN
    IF jsonb_typeof(p_payload->'highlights') = 'array'
       AND jsonb_array_length(p_payload->'highlights') <> (
           SELECT count(DISTINCT item->>'id')
           FROM jsonb_array_elements(p_payload->'highlights') item
       ) THEN
        RAISE EXCEPTION 'DEV1042_NOTE_SET_INVALID';
    END IF;

    RETURN public.save_admin_domani_release_editor_unchecked(
        p_release_id,
        p_primary_if_match,
        p_payload,
        p_actor_user_id,
        p_actor_email,
        p_actor_role,
        p_request_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.save_admin_domani_release_editor_unchecked(
    uuid,bigint,jsonb,uuid,text,public.dashboard_role,text
) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.save_admin_domani_release_editor(
    uuid,bigint,jsonb,uuid,text,public.dashboard_role,text
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_admin_domani_release_editor(
    uuid,bigint,jsonb,uuid,text,public.dashboard_role,text
) TO service_role;

COMMENT ON FUNCTION public.save_admin_domani_release_editor(
    uuid,bigint,jsonb,uuid,text,public.dashboard_role,text
) IS 'Atomic editor save that rejects newly selected historical timing while preserving unchanged historical values.';

NOTIFY pgrst, 'reload schema';
