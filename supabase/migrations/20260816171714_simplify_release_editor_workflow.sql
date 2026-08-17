-- Simplify the dashboard editor to one Draft/Published status and one atomic save.
-- Existing lifecycle and visibility columns remain as internal compatibility fields.

ALTER TABLE public.releases
ADD COLUMN IF NOT EXISTS platforms public.release_platform[]
NOT NULL
DEFAULT ARRAY['ios','android']::public.release_platform[];

ALTER TABLE public.releases
DROP CONSTRAINT IF EXISTS releases_platforms_valid;

ALTER TABLE public.releases
ADD CONSTRAINT releases_platforms_valid CHECK (
    cardinality(platforms) BETWEEN 1 AND 2
    AND array_lower(platforms, 1) = 1
    AND array_position(platforms, NULL::public.release_platform) IS NULL
    AND (cardinality(platforms) = 1 OR platforms[1] <> platforms[2])
);

CREATE OR REPLACE FUNCTION public.admin_release_json(p_release_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
SELECT jsonb_build_object(
    'id', r.id, 'version', r.version, 'slug', r.slug, 'title', r.title,
    'releaseType', r.release_type,
    'status', CASE WHEN r.visibility = 'private' THEN 'draft' ELSE 'published' END,
    'timing', CASE
        WHEN r.confirmed_date IS NOT NULL THEN jsonb_build_object('kind','date','value',r.confirmed_date)
        WHEN r.target_date IS NOT NULL THEN jsonb_build_object('kind','date','value',r.target_date)
        WHEN r.target_month IS NOT NULL THEN jsonb_build_object('kind','month','value',to_char(r.target_month,'YYYY-MM'))
        ELSE jsonb_build_object('kind','tbd','value',NULL)
    END,
    'platforms', r.platforms,
    'lifecycleStatus', r.lifecycle_status, 'visibility', r.visibility,
    'publicOverview', r.public_overview, 'publicSummary', r.public_summary,
    'internalSummary', r.internal_summary,
    'targetMonth', CASE WHEN r.target_month IS NULL THEN NULL ELSE to_char(r.target_month, 'YYYY-MM') END,
    'targetDate', r.target_date, 'confirmedDate', r.confirmed_date,
    'releasedAt', r.released_at, 'ownerUserId', r.owner_user_id,
    'rowVersion', r.row_version, 'createdAt', r.created_at,
    'updatedAt', r.updated_at, 'archivedAt', r.archived_at
) FROM public.releases r WHERE r.id = p_release_id
$$;

CREATE OR REPLACE FUNCTION public.admin_release_allowed_actions(
    p_visibility public.release_visibility,
    p_lifecycle public.release_lifecycle_status,
    p_release_type public.release_type,
    p_archived_at timestamptz,
    p_role public.dashboard_role
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE v_actions jsonb := '[]'::jsonb;
BEGIN
    IF p_archived_at IS NOT NULL OR p_role = 'viewer' THEN RETURN v_actions; END IF;
    v_actions := v_actions || '"edit"'::jsonb;
    IF p_role = 'admin' THEN v_actions := v_actions || '"archive"'::jsonb; END IF;
    RETURN v_actions;
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
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

    IF v_timing_kind = 'date' THEN
        IF v_timing_value IS NULL THEN RAISE EXCEPTION 'DEV1042_INVALID_STATE'; END IF;
        v_date := v_timing_value::date;
    ELSIF v_timing_kind = 'month' THEN
        IF v_timing_value IS NULL THEN RAISE EXCEPTION 'DEV1042_INVALID_STATE'; END IF;
        v_month := to_date(v_timing_value || '-01', 'YYYY-MM-DD');
        IF v_month < date_trunc('month', CURRENT_DATE)::date THEN
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
        SELECT * INTO v_release FROM public.releases
        WHERE id = p_release_id AND archived_at IS NULL FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'DEV1042_NOT_FOUND'; END IF;
        IF v_release.row_version <> p_primary_if_match THEN RAISE EXCEPTION 'DEV1042_VERSION_CONFLICT'; END IF;
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
    id uuid, version text, slug text, title text, release_type public.release_type,
    lifecycle_status public.release_lifecycle_status, public_summary text,
    target_month date, target_date date, confirmed_date date, released_at timestamptz,
    sort_primary text, notes jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
WITH release_dates AS (
    SELECT release.*,
        coalesce(release.released_at::date,release.confirmed_date,release.target_date) AS exact_date,
        coalesce(release.released_at::date,release.confirmed_date,release.target_date,release.target_month) AS effective_date
    FROM public.releases release
), eligible AS (
    SELECT
        release.id,release.version,release.slug,release.title,release.release_type,
        CASE WHEN p_collection='changelog' THEN 'released'::public.release_lifecycle_status
             ELSE 'planned'::public.release_lifecycle_status END AS lifecycle_status,
        release.public_summary,release.target_month,release.target_date,release.confirmed_date,
        CASE WHEN p_collection='changelog' THEN coalesce(
            release.released_at,
            release.exact_date::timestamp AT TIME ZONE 'America/New_York'
        ) ELSE NULL END AS released_at,
        release.version_major,release.version_minor,coalesce(release.version_patch,-1) AS version_patch,
        release.effective_date
    FROM release_dates release
    WHERE release.archived_at IS NULL
      AND release.visibility <> 'private'
      AND (
          (p_collection='coming-soon' AND (release.exact_date IS NULL OR release.exact_date > CURRENT_DATE))
          OR (p_collection='changelog' AND release.exact_date <= CURRENT_DATE)
      )
      AND EXISTS (
          SELECT 1 FROM public.release_notes note
          WHERE note.release_id=release.id AND note.is_public AND note.archived_at IS NULL
            AND (p_platform IS NULL OR note.platforms @> ARRAY[p_platform]::public.release_platform[])
      )
), cursor_page AS (
    SELECT eligible.* FROM eligible
    WHERE p_cursor_id IS NULL
       OR (p_collection='coming-soon' AND (
            (p_cursor_primary IS NOT NULL AND (
                eligible.effective_date > p_cursor_primary::date
                OR eligible.effective_date IS NULL
                OR (eligible.effective_date = p_cursor_primary::date AND (
                    (eligible.version_major,eligible.version_minor,eligible.version_patch) >
                    (p_cursor_version_major,p_cursor_version_minor,p_cursor_version_patch)
                    OR ((eligible.version_major,eligible.version_minor,eligible.version_patch) =
                        (p_cursor_version_major,p_cursor_version_minor,p_cursor_version_patch) AND eligible.id > p_cursor_id)
                ))
            ))
            OR (p_cursor_primary IS NULL AND eligible.effective_date IS NULL AND (
                (eligible.version_major,eligible.version_minor,eligible.version_patch) >
                (p_cursor_version_major,p_cursor_version_minor,p_cursor_version_patch)
                OR ((eligible.version_major,eligible.version_minor,eligible.version_patch) =
                    (p_cursor_version_major,p_cursor_version_minor,p_cursor_version_patch) AND eligible.id > p_cursor_id)
            ))
       ))
       OR (p_collection='changelog' AND (
            eligible.released_at < p_cursor_primary::timestamptz
            OR (eligible.released_at = p_cursor_primary::timestamptz AND (
                (eligible.version_major,eligible.version_minor,eligible.version_patch) <
                (p_cursor_version_major,p_cursor_version_minor,p_cursor_version_patch)
                OR ((eligible.version_major,eligible.version_minor,eligible.version_patch) =
                    (p_cursor_version_major,p_cursor_version_minor,p_cursor_version_patch) AND eligible.id > p_cursor_id)
            ))
       ))
    ORDER BY
        CASE WHEN p_collection='coming-soon' THEN eligible.effective_date END ASC NULLS LAST,
        CASE WHEN p_collection='coming-soon' THEN eligible.version_major END ASC,
        CASE WHEN p_collection='coming-soon' THEN eligible.version_minor END ASC,
        CASE WHEN p_collection='coming-soon' THEN eligible.version_patch END ASC,
        CASE WHEN p_collection='changelog' THEN eligible.released_at END DESC,
        CASE WHEN p_collection='changelog' THEN eligible.version_major END DESC,
        CASE WHEN p_collection='changelog' THEN eligible.version_minor END DESC,
        CASE WHEN p_collection='changelog' THEN eligible.version_patch END DESC,
        eligible.id ASC
    LIMIT least(greatest(p_page_limit,1),100)+1
)
SELECT
    page.id,page.version,page.slug,page.title,page.release_type,page.lifecycle_status,
    page.public_summary,page.target_month,page.target_date,page.confirmed_date,page.released_at,
    CASE WHEN p_collection='changelog' THEN page.released_at::text ELSE page.effective_date::text END,
    notes.items
FROM cursor_page page
CROSS JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
        'id',note.id,'note_type',note.note_type,'public_title',note.public_title,
        'public_body',note.public_body,'platforms',note.platforms,'sort_order',note.sort_order
    ) ORDER BY note.sort_order,note.id) AS items
    FROM public.release_notes note
    WHERE note.release_id=page.id AND note.is_public AND note.archived_at IS NULL
      AND (p_platform IS NULL OR note.platforms @> ARRAY[p_platform]::public.release_platform[])
) notes
ORDER BY
    CASE WHEN p_collection='coming-soon' THEN page.effective_date END ASC NULLS LAST,
    CASE WHEN p_collection='coming-soon' THEN page.version_major END ASC,
    CASE WHEN p_collection='coming-soon' THEN page.version_minor END ASC,
    CASE WHEN p_collection='coming-soon' THEN page.version_patch END ASC,
    CASE WHEN p_collection='changelog' THEN page.released_at END DESC,
    CASE WHEN p_collection='changelog' THEN page.version_major END DESC,
    CASE WHEN p_collection='changelog' THEN page.version_minor END DESC,
    CASE WHEN p_collection='changelog' THEN page.version_patch END DESC,
    page.id ASC
$$;

CREATE OR REPLACE FUNCTION public.list_public_domani_releases_v2(
    p_collection text,
    p_platform public.release_platform DEFAULT NULL,
    p_page_limit integer DEFAULT 20,
    p_cursor_primary text DEFAULT NULL,
    p_cursor_version_major integer DEFAULT NULL,
    p_cursor_version_minor integer DEFAULT NULL,
    p_cursor_version_patch integer DEFAULT NULL,
    p_cursor_id uuid DEFAULT NULL
) RETURNS TABLE(
    id uuid,version text,slug text,title text,release_type public.release_type,
    lifecycle_status public.release_lifecycle_status,public_overview jsonb,public_summary text,
    target_month date,target_date date,confirmed_date date,released_at timestamptz,
    sort_primary text,notes jsonb
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
SELECT base.id,base.version,base.slug,base.title,base.release_type,base.lifecycle_status,
       release.public_overview,base.public_summary,base.target_month,base.target_date,
       base.confirmed_date,base.released_at,base.sort_primary,base.notes
FROM public.list_public_domani_releases(
    p_collection,p_platform,p_page_limit,p_cursor_primary,p_cursor_version_major,
    p_cursor_version_minor,p_cursor_version_patch,p_cursor_id
) base
JOIN public.releases release ON release.id=base.id
ORDER BY
    CASE WHEN p_collection='coming-soon' THEN base.sort_primary::date END ASC NULLS LAST,
    CASE WHEN p_collection='coming-soon' THEN release.version_major END ASC,
    CASE WHEN p_collection='coming-soon' THEN release.version_minor END ASC,
    CASE WHEN p_collection='coming-soon' THEN release.version_patch END ASC,
    CASE WHEN p_collection='changelog' THEN base.released_at END DESC,
    CASE WHEN p_collection='changelog' THEN release.version_major END DESC,
    CASE WHEN p_collection='changelog' THEN release.version_minor END DESC,
    CASE WHEN p_collection='changelog' THEN release.version_patch END DESC,
    base.id ASC
$$;

REVOKE ALL ON FUNCTION public.admin_release_json(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_release_allowed_actions(public.release_visibility,public.release_lifecycle_status,public.release_type,timestamptz,public.dashboard_role) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_admin_domani_release_editor(uuid,bigint,jsonb,uuid,text,public.dashboard_role,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_public_domani_releases(text,public.release_platform,integer,text,integer,integer,integer,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_public_domani_releases_v2(text,public.release_platform,integer,text,integer,integer,integer,uuid) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.save_admin_domani_release_editor(uuid,bigint,jsonb,uuid,text,public.dashboard_role,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_public_domani_releases(text,public.release_platform,integer,text,integer,integer,integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_public_domani_releases_v2(text,public.release_platform,integer,text,integer,integer,integer,uuid) TO service_role;

COMMENT ON FUNCTION public.save_admin_domani_release_editor(uuid,bigint,jsonb,uuid,text,public.dashboard_role,text)
IS 'Service-role-only atomic save for the simplified Domani release editor.';

NOTIFY pgrst, 'reload schema';
