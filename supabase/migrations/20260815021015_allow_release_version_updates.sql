-- Allow semantic version corrections while keeping the existing public slug stable.
CREATE OR REPLACE FUNCTION public.mutate_admin_domani_release_v2(
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
    v_action text;
    v_targets text[] := ARRAY[]::text[];
    v_audit_event_id uuid;
    v_job_id uuid;
    v_receipt jsonb;
    v_requested_lifecycle public.release_lifecycle_status;
BEGIN
    IF p_actor_user_id IS NULL OR nullif(lower(btrim(p_actor_email)), '') IS NULL OR p_actor_role = 'viewer' THEN
        RAISE EXCEPTION 'DEV1042_FORBIDDEN';
    END IF;
    IF p_operation = 'release.create' THEN
        INSERT INTO public.releases(
            version,slug,title,release_type,public_overview,public_summary,internal_summary,
            target_month,target_date,owner_user_id,created_by,updated_by
        ) VALUES (
            p_payload->>'version',p_payload->>'slug',p_payload->>'title',(p_payload->>'releaseType')::public.release_type,
            CASE WHEN p_payload->'publicOverview' = 'null'::jsonb THEN NULL ELSE p_payload->'publicOverview' END,
            nullif(p_payload->>'publicSummary',''),p_payload->>'internalSummary',
            CASE WHEN p_payload->>'targetMonth' IS NULL THEN NULL ELSE to_date(p_payload->>'targetMonth'||'-01','YYYY-MM-DD') END,
            (p_payload->>'targetDate')::date,(p_payload->>'ownerUserId')::uuid,p_actor_user_id,p_actor_user_id
        ) RETURNING * INTO v_release;
        v_action := 'release.created';
    ELSE
        SELECT * INTO v_release FROM public.releases WHERE id=p_release_id AND archived_at IS NULL FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'DEV1042_NOT_FOUND'; END IF;
        IF v_release.row_version <> p_primary_if_match THEN RAISE EXCEPTION 'DEV1042_VERSION_CONFLICT'; END IF;
        IF v_release.visibility='published' AND p_actor_role<>'admin' THEN RAISE EXCEPTION 'DEV1042_PUBLISHED_ADMIN_REQUIRED'; END IF;
        v_before := public.admin_release_json(v_release.id);

        IF p_operation = 'release.update' THEN
            IF p_payload ? 'lifecycleStatus' THEN
                v_requested_lifecycle := (p_payload->>'lifecycleStatus')::public.release_lifecycle_status;
                IF v_requested_lifecycle <> v_release.lifecycle_status AND NOT (
                    (v_requested_lifecycle='planned' AND v_release.lifecycle_status IN ('draft','in_progress') AND v_release.visibility='private')
                    OR (v_requested_lifecycle='in_progress' AND v_release.lifecycle_status='planned' AND v_release.visibility IN ('private','public_preview'))
                    OR (v_requested_lifecycle='canceled' AND v_release.lifecycle_status IN ('draft','planned','in_progress') AND v_release.visibility='private')
                ) THEN RAISE EXCEPTION 'DEV1042_INVALID_STATE'; END IF;
            END IF;
            UPDATE public.releases SET
                version=CASE WHEN p_payload?'version' THEN p_payload->>'version' ELSE version END,
                release_type=CASE WHEN p_payload?'releaseType' THEN (p_payload->>'releaseType')::public.release_type ELSE release_type END,
                title=CASE WHEN p_payload?'title' THEN p_payload->>'title' ELSE title END,
                lifecycle_status=CASE WHEN p_payload?'lifecycleStatus' THEN (p_payload->>'lifecycleStatus')::public.release_lifecycle_status ELSE lifecycle_status END,
                public_overview=CASE WHEN p_payload?'publicOverview' THEN CASE WHEN p_payload->'publicOverview'='null'::jsonb THEN NULL ELSE p_payload->'publicOverview' END ELSE public_overview END,
                public_summary=CASE WHEN p_payload?'publicSummary' THEN nullif(p_payload->>'publicSummary','') ELSE public_summary END,
                internal_summary=CASE WHEN p_payload?'internalSummary' THEN p_payload->>'internalSummary' ELSE internal_summary END,
                target_month=CASE WHEN p_payload?'targetMonth' THEN CASE WHEN p_payload->>'targetMonth' IS NULL THEN NULL ELSE to_date(p_payload->>'targetMonth'||'-01','YYYY-MM-DD') END ELSE target_month END,
                target_date=CASE WHEN p_payload?'targetDate' THEN (p_payload->>'targetDate')::date ELSE target_date END,
                owner_user_id=CASE WHEN p_payload?'ownerUserId' THEN (p_payload->>'ownerUserId')::uuid ELSE owner_user_id END,
                updated_by=p_actor_user_id,row_version=row_version+1
            WHERE id=v_release.id RETURNING * INTO v_release;
            v_action := 'release.updated';
            IF v_release.visibility='public_preview' THEN v_targets:=ARRAY['/api/domani/releases/coming-soon','/coming-soon'];
            ELSIF v_release.visibility='published' THEN v_targets:=ARRAY['/api/domani/releases/changelog','/changelog']; END IF;
        ELSIF p_operation = 'release.mark_released' THEN
            IF v_release.visibility<>'private' OR v_release.lifecycle_status NOT IN ('planned','in_progress')
               OR p_payload->>'releasedAt' IS NULL OR (p_payload->>'releasedAt')::timestamptz > now() THEN
                RAISE EXCEPTION 'DEV1042_INVALID_STATE';
            END IF;
            UPDATE public.releases SET lifecycle_status='released',released_at=(p_payload->>'releasedAt')::timestamptz,
                updated_by=p_actor_user_id,row_version=row_version+1
            WHERE id=v_release.id RETURNING * INTO v_release;
            v_action := 'release.marked_released';
        ELSE
            RAISE EXCEPTION 'DEV1042_INVALID_STATE';
        END IF;
    END IF;

    INSERT INTO public.release_audit_events(
        actor_user_id,actor_email,actor_role,action,entity_type,entity_id,release_id,
        request_id,before_data,after_data,metadata
    ) VALUES (
        p_actor_user_id,lower(btrim(p_actor_email)),p_actor_role,v_action,'release',v_release.id,v_release.id,
        p_request_id,v_before,public.admin_release_json(v_release.id),jsonb_build_object('source','dashboard')
    ) RETURNING id INTO v_audit_event_id;

    IF cardinality(v_targets)>0 THEN
        v_job_id:=gen_random_uuid();
        INSERT INTO public.release_cache_invalidation_jobs(id,release_id,event_key,targets)
        VALUES(v_job_id,v_release.id,v_audit_event_id::text,v_targets);
        v_receipt:=jsonb_build_object('jobId',v_job_id,'status','pending','targets',v_targets);
    END IF;
    RETURN jsonb_build_object(
        'data',jsonb_build_object('release',public.admin_release_detail_json(v_release.id,p_actor_role,true)),
        'releaseRowVersion',v_release.row_version,'primaryRowVersion',v_release.row_version,
        'cacheInvalidation',v_receipt
    );
EXCEPTION
    WHEN unique_violation THEN RAISE;
    WHEN check_violation OR invalid_text_representation OR not_null_violation OR foreign_key_violation THEN
        RAISE EXCEPTION 'DEV1042_INVALID_STATE';
END;
$$;

REVOKE ALL ON FUNCTION public.mutate_admin_domani_release_v2(text,uuid,bigint,jsonb,uuid,text,public.dashboard_role,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_admin_domani_release_v2(text,uuid,bigint,jsonb,uuid,text,public.dashboard_role,text) TO service_role;

NOTIFY pgrst, 'reload schema';
