-- Restricted rich public release overview and simplified release workflow.

CREATE OR REPLACE FUNCTION public.release_overview_text_node(p_node jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
    v_result text := '';
    v_child jsonb;
BEGIN
    IF jsonb_typeof(p_node) <> 'object' THEN RETURN ''; END IF;
    IF p_node->>'type' = 'text' THEN RETURN COALESCE(p_node->>'text', ''); END IF;
    IF jsonb_typeof(p_node->'content') = 'array' THEN
        FOR v_child IN SELECT value FROM jsonb_array_elements(p_node->'content') LOOP
            v_result := v_result || public.release_overview_text_node(v_child);
            IF v_child->>'type' IN ('paragraph', 'heading', 'listItem') THEN
                v_result := v_result || ' ';
            END IF;
        END LOOP;
    END IF;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_overview_text(p_document jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
SELECT btrim(regexp_replace(public.release_overview_text_node(p_document), '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.release_overview_node_valid(
    p_node jsonb,
    p_parent_type text DEFAULT NULL,
    p_depth integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
    v_type text;
    v_child jsonb;
    v_mark jsonb;
    v_allowed_children text[];
    v_child_count integer := 0;
    v_index integer := 0;
BEGIN
    IF p_depth > 10 OR jsonb_typeof(p_node) <> 'object' THEN RETURN false; END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_object_keys(p_node) key
        WHERE key <> ALL (ARRAY['type','attrs','content','marks','text'])
    ) THEN RETURN false; END IF;

    v_type := p_node->>'type';
    IF v_type <> ALL (ARRAY['doc','paragraph','heading','bulletList','orderedList','listItem','text']) THEN
        RETURN false;
    END IF;
    IF (p_parent_type IS NULL) <> (v_type = 'doc') THEN RETURN false; END IF;

    IF v_type = 'heading' THEN
        IF jsonb_typeof(p_node->'attrs') <> 'object'
           OR (p_node->'attrs'->>'level') NOT IN ('2','3')
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_node->'attrs') key WHERE key <> 'level') THEN
            RETURN false;
        END IF;
    ELSIF v_type = 'orderedList' THEN
        IF p_node ? 'attrs' AND (
            jsonb_typeof(p_node->'attrs') <> 'object'
            OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_node->'attrs') key WHERE key <> 'start')
            OR (p_node->'attrs' ? 'start' AND (
                jsonb_typeof(p_node->'attrs'->'start') <> 'number'
                OR (p_node->'attrs'->>'start')::integer < 1
                OR (p_node->'attrs'->>'start')::integer > 1000
            ))
        ) THEN RETURN false; END IF;
    ELSIF p_node ? 'attrs' THEN
        RETURN false;
    END IF;

    IF v_type = 'text' THEN
        IF jsonb_typeof(p_node->'text') <> 'string'
           OR char_length(p_node->>'text') = 0
           OR char_length(p_node->>'text') > 10000
           OR p_node ? 'content' THEN RETURN false; END IF;
        IF p_node ? 'marks' THEN
            IF jsonb_typeof(p_node->'marks') <> 'array' OR jsonb_array_length(p_node->'marks') > 3 THEN RETURN false; END IF;
            FOR v_mark IN SELECT value FROM jsonb_array_elements(p_node->'marks') LOOP
                IF jsonb_typeof(v_mark) <> 'object'
                   OR v_mark->>'type' <> ALL (ARRAY['bold','italic','link'])
                   OR EXISTS (
                       SELECT 1 FROM jsonb_object_keys(v_mark) key
                       WHERE key <> ALL (CASE WHEN v_mark->>'type' = 'link' THEN ARRAY['type','attrs'] ELSE ARRAY['type'] END)
                   ) THEN RETURN false; END IF;
                IF v_mark->>'type' = 'link' AND (
                    jsonb_typeof(v_mark->'attrs') <> 'object'
                    OR COALESCE(v_mark->'attrs'->>'href','') !~* '^(https?://|mailto:)'
                    OR char_length(v_mark->'attrs'->>'href') > 2048
                    OR EXISTS (
                        SELECT 1 FROM jsonb_object_keys(v_mark->'attrs') key
                        WHERE key <> ALL (ARRAY['href','target','rel','class'])
                    )
                ) THEN RETURN false; END IF;
            END LOOP;
        END IF;
        RETURN true;
    END IF;

    IF p_node ? 'text' OR p_node ? 'marks' THEN RETURN false; END IF;
    IF p_node ? 'content' AND jsonb_typeof(p_node->'content') <> 'array' THEN RETURN false; END IF;
    v_allowed_children := CASE v_type
        WHEN 'doc' THEN ARRAY['paragraph','heading','bulletList','orderedList']
        WHEN 'paragraph' THEN ARRAY['text']
        WHEN 'heading' THEN ARRAY['text']
        WHEN 'bulletList' THEN ARRAY['listItem']
        WHEN 'orderedList' THEN ARRAY['listItem']
        WHEN 'listItem' THEN ARRAY['paragraph','bulletList','orderedList']
        ELSE ARRAY[]::text[]
    END;
    IF jsonb_typeof(p_node->'content') = 'array' THEN
        FOR v_child IN SELECT value FROM jsonb_array_elements(p_node->'content') LOOP
            v_child_count := v_child_count + 1;
            v_index := v_index + 1;
            IF v_child->>'type' <> ALL (v_allowed_children)
               OR NOT public.release_overview_node_valid(v_child, v_type, p_depth + 1) THEN RETURN false; END IF;
            IF v_type = 'listItem' AND v_index = 1 AND v_child->>'type' <> 'paragraph' THEN RETURN false; END IF;
        END LOOP;
    END IF;
    IF v_type IN ('bulletList','orderedList','listItem') AND v_child_count = 0 THEN RETURN false; END IF;
    RETURN true;
EXCEPTION WHEN OTHERS THEN
    RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_overview_is_valid(p_document jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
SELECT p_document IS NOT NULL
   AND octet_length(p_document::text) <= 65536
   AND char_length(public.release_overview_text(p_document)) <= 10000
   AND public.release_overview_node_valid(p_document, NULL, 0)
$$;

ALTER TABLE public.releases ADD COLUMN IF NOT EXISTS public_overview jsonb;

UPDATE public.releases
SET public_overview = jsonb_build_object(
    'type', 'doc',
    'content', jsonb_build_array(
        jsonb_build_object(
            'type', 'paragraph',
            'content', jsonb_build_array(jsonb_build_object('type','text','text',public_summary))
        )
    )
)
WHERE public_overview IS NULL AND nullif(btrim(public_summary), '') IS NOT NULL;

ALTER TABLE public.releases DROP CONSTRAINT IF EXISTS releases_public_summary_check;
ALTER TABLE public.releases ADD CONSTRAINT releases_public_summary_check
    CHECK (public_summary IS NULL OR char_length(public_summary) <= 10000);
ALTER TABLE public.releases ADD CONSTRAINT releases_public_overview_check
    CHECK (public_overview IS NULL OR public.release_overview_is_valid(public_overview));

ALTER TABLE public.release_audit_events DROP CONSTRAINT release_audit_events_action_check;
ALTER TABLE public.release_audit_events ADD CONSTRAINT release_audit_events_action_check CHECK (
    action IN (
        'release.created','release.updated','release.marked_released','release.archived',
        'release.preview_published','release.preview_returned_private','release.published',
        'release.unpublished','note.created','note.updated','note.archived','note.reordered',
        'source.imported','source.superseded','source.approved','conversion.started',
        'conversion.succeeded','conversion.failed','conversion.superseded'
    )
);

CREATE OR REPLACE FUNCTION public.prepare_domani_release_fields()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE v_title_slug text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_title_slug := btrim(regexp_replace(lower(NEW.title), '[^a-z0-9]+', '-', 'g'), '-');
        NEW.slug := replace(NEW.version, '.', '-') || '-' || COALESCE(nullif(v_title_slug, ''), 'release');
    ELSE
        NEW.slug := OLD.slug;
    END IF;
    IF TG_OP = 'INSERT' OR NEW.public_overview IS DISTINCT FROM OLD.public_overview THEN
        NEW.public_summary := nullif(public.release_overview_text(NEW.public_overview), '');
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.target_date IS NOT NULL AND NEW.target_date < CURRENT_DATE THEN
            RAISE EXCEPTION 'DEV1042_TARGET_DATE_PAST';
        END IF;
        IF NEW.target_month IS NOT NULL AND NEW.target_month < date_trunc('month', CURRENT_DATE)::date THEN
            RAISE EXCEPTION 'DEV1042_TARGET_MONTH_PAST';
        END IF;
    ELSE
        IF NEW.target_date IS NOT NULL AND NEW.target_date < CURRENT_DATE
           AND NEW.target_date IS DISTINCT FROM OLD.target_date THEN
            RAISE EXCEPTION 'DEV1042_TARGET_DATE_PAST';
        END IF;
        IF NEW.target_month IS NOT NULL AND NEW.target_month < date_trunc('month', CURRENT_DATE)::date
           AND NEW.target_month IS DISTINCT FROM OLD.target_month THEN
            RAISE EXCEPTION 'DEV1042_TARGET_MONTH_PAST';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prepare_domani_release_fields_trigger ON public.releases;
CREATE TRIGGER prepare_domani_release_fields_trigger
BEFORE INSERT OR UPDATE ON public.releases
FOR EACH ROW EXECUTE FUNCTION public.prepare_domani_release_fields();

CREATE OR REPLACE FUNCTION public.admin_release_json(p_release_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
SELECT jsonb_build_object(
    'id', r.id, 'version', r.version, 'slug', r.slug, 'title', r.title,
    'releaseType', r.release_type, 'lifecycleStatus', r.lifecycle_status,
    'visibility', r.visibility, 'publicOverview', r.public_overview,
    'publicSummary', r.public_summary, 'internalSummary', r.internal_summary,
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
    IF p_visibility <> 'published' THEN v_actions := v_actions || '"edit"'::jsonb; END IF;
    IF p_visibility = 'private' AND p_lifecycle IN ('planned','in_progress') THEN
        v_actions := v_actions || '"mark_released"'::jsonb;
    END IF;
    IF p_visibility = 'private' AND p_lifecycle IN ('planned', 'in_progress') AND p_release_type <> 'patch' THEN
        v_actions := v_actions || '"publish_preview"'::jsonb;
    ELSIF p_visibility = 'public_preview' THEN
        v_actions := v_actions || '"return_to_private"'::jsonb;
    END IF;
    IF p_role = 'admin' THEN
        IF p_visibility = 'private' AND p_lifecycle = 'released' THEN v_actions := v_actions || '"publish"'::jsonb; END IF;
        IF p_visibility = 'published' THEN v_actions := v_actions || '"edit"'::jsonb || '"unpublish"'::jsonb; END IF;
        v_actions := v_actions || '"archive"'::jsonb;
    END IF;
    RETURN v_actions;
END;
$$;

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

REVOKE ALL ON FUNCTION public.release_overview_text_node(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.release_overview_text(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.release_overview_node_valid(jsonb,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.release_overview_is_valid(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_release_json(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.admin_release_allowed_actions(public.release_visibility,public.release_lifecycle_status,public.release_type,timestamptz,public.dashboard_role) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mutate_admin_domani_release_v2(text,uuid,bigint,jsonb,uuid,text,public.dashboard_role,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.list_public_domani_releases_v2(text,public.release_platform,integer,text,integer,integer,integer,uuid) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.admin_release_json(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_release_allowed_actions(public.release_visibility,public.release_lifecycle_status,public.release_type,timestamptz,public.dashboard_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.mutate_admin_domani_release_v2(text,uuid,bigint,jsonb,uuid,text,public.dashboard_role,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_public_domani_releases_v2(text,public.release_platform,integer,text,integer,integer,integer,uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
