-- DEV-1042: authenticated admin release management API primitives.
-- Every aggregate mutation locks the release before authorization/version checks.

CREATE OR REPLACE FUNCTION public.admin_release_json(p_release_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
SELECT jsonb_build_object(
    'id', r.id, 'version', r.version, 'slug', r.slug, 'title', r.title,
    'releaseType', r.release_type, 'lifecycleStatus', r.lifecycle_status,
    'visibility', r.visibility, 'publicSummary', r.public_summary,
    'internalSummary', r.internal_summary,
    'targetMonth', CASE WHEN r.target_month IS NULL THEN NULL ELSE to_char(r.target_month, 'YYYY-MM') END,
    'targetDate', r.target_date, 'confirmedDate', r.confirmed_date,
    'releasedAt', r.released_at, 'ownerUserId', r.owner_user_id,
    'rowVersion', r.row_version, 'createdAt', r.created_at,
    'updatedAt', r.updated_at, 'archivedAt', r.archived_at
) FROM public.releases r WHERE r.id = p_release_id
$$;

CREATE OR REPLACE FUNCTION public.admin_release_note_json(p_note_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
SELECT jsonb_build_object(
    'id', n.id, 'releaseId', n.release_id, 'noteType', n.note_type,
    'publicTitle', n.public_title, 'publicBody', n.public_body,
    'technicalNotes', n.technical_notes, 'platforms', n.platforms,
    'isPublic', n.is_public, 'sortOrder', n.sort_order,
    'sourcePrdId', n.source_prd_id, 'sourceConversionRunId', n.source_conversion_run_id,
    'rowVersion', n.row_version, 'createdAt', n.created_at,
    'updatedAt', n.updated_at, 'archivedAt', n.archived_at
) FROM public.release_notes n WHERE n.id = p_note_id
$$;

CREATE OR REPLACE FUNCTION public.admin_release_source_json(p_source_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
SELECT jsonb_build_object(
    'id', p.id, 'releaseId', p.release_id, 'rawMarkdown', p.raw_markdown,
    'originalFilename', p.original_filename, 'sourceType', p.source_type,
    'sourceReference', p.source_reference, 'sourceContentSha256', p.source_content_sha256,
    'intendedSurface', p.intended_surface, 'conversionStatus', p.conversion_status,
    'latestConversionRunId', p.latest_conversion_run_id,
    'conversionErrorCode', p.conversion_error_code,
    'conversionErrorMessage', p.conversion_error_message,
    'rowVersion', p.row_version, 'createdAt', p.created_at, 'updatedAt', p.updated_at
) FROM public.release_prds p WHERE p.id = p_source_id
$$;

CREATE OR REPLACE FUNCTION public.admin_release_source_audit_json(p_source_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
SELECT jsonb_build_object(
    'id', p.id, 'releaseId', p.release_id, 'sourceType', p.source_type,
    'sourceReference', p.source_reference, 'intendedSurface', p.intended_surface,
    'conversionStatus', p.conversion_status,
    'latestConversionRunId', p.latest_conversion_run_id,
    'rowVersion', p.row_version, 'updatedAt', p.updated_at
) FROM public.release_prds p WHERE p.id = p_source_id
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
    IF p_visibility = 'private' AND p_lifecycle IN ('planned', 'in_progress') AND p_release_type <> 'patch' THEN
        v_actions := v_actions || '"publish_preview"'::jsonb;
    ELSIF p_visibility = 'public_preview' THEN
        v_actions := v_actions || '"return_to_private"'::jsonb;
    END IF;
    IF p_role = 'admin' THEN
        IF p_visibility = 'private' AND p_lifecycle = 'released' THEN v_actions := v_actions || '"publish"'::jsonb; END IF;
        IF p_visibility = 'published' THEN
            v_actions := v_actions || '"edit"'::jsonb || '"unpublish"'::jsonb;
        END IF;
        v_actions := v_actions || '"archive"'::jsonb;
    END IF;
    RETURN v_actions;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_release_detail_json(
    p_release_id uuid,
    p_role public.dashboard_role,
    p_include_archived boolean DEFAULT false
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
SELECT public.admin_release_json(r.id) || jsonb_build_object(
    'notes', COALESCE((
        SELECT jsonb_agg(public.admin_release_note_json(n.id) ORDER BY n.sort_order, n.id)
        FROM public.release_notes n
        WHERE n.release_id = r.id AND (p_include_archived OR n.archived_at IS NULL)
    ), '[]'::jsonb),
    'sources', COALESCE((
        SELECT jsonb_agg(public.admin_release_source_json(p.id) ORDER BY p.created_at DESC, p.id DESC)
        FROM public.release_prds p WHERE p.release_id = r.id
    ), '[]'::jsonb),
    'allowedActions', public.admin_release_allowed_actions(r.visibility, r.lifecycle_status, r.release_type, r.archived_at, p_role)
)
FROM public.releases r
WHERE r.id = p_release_id AND (p_include_archived OR r.archived_at IS NULL)
$$;

CREATE OR REPLACE FUNCTION public.get_admin_domani_release(
    p_release_id uuid,
    p_include_archived boolean,
    p_actor_role public.dashboard_role
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_result jsonb;
BEGIN
    IF p_include_archived AND p_actor_role <> 'admin' THEN RAISE EXCEPTION 'DEV1042_FORBIDDEN'; END IF;
    v_result := public.admin_release_detail_json(p_release_id, p_actor_role, p_include_archived);
    IF v_result IS NULL THEN RAISE EXCEPTION 'DEV1042_NOT_FOUND'; END IF;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_admin_domani_releases(
    p_filters jsonb,
    p_limit integer,
    p_after jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
WITH page AS (
    SELECT r.*
    FROM public.releases r
    WHERE ((p_filters->>'archived')::boolean OR r.archived_at IS NULL)
      AND (NOT (p_filters->>'archived')::boolean OR r.archived_at IS NOT NULL)
      AND ((p_filters->>'lifecycle') IS NULL OR r.lifecycle_status::text = p_filters->>'lifecycle')
      AND ((p_filters->>'visibility') IS NULL OR r.visibility::text = p_filters->>'visibility')
      AND ((p_filters->>'releaseType') IS NULL OR r.release_type::text = p_filters->>'releaseType')
      AND ((p_filters->>'version') IS NULL OR r.version ILIKE '%' || replace(replace(p_filters->>'version', '%', '\%'), '_', '\_') || '%' ESCAPE '\')
      AND ((p_filters->>'platform') IS NULL OR EXISTS (
          SELECT 1 FROM public.release_notes n
          WHERE n.release_id = r.id AND n.archived_at IS NULL
            AND (p_filters->>'platform')::public.release_platform = ANY(n.platforms)
      ))
      AND (p_after IS NULL OR (r.updated_at, r.id) < ((p_after->>'orderedAt')::timestamptz, (p_after->>'id')::uuid))
    ORDER BY r.updated_at DESC, r.id DESC
    LIMIT p_limit + 1
), visible AS (
    SELECT * FROM page ORDER BY updated_at DESC, id DESC LIMIT p_limit
)
SELECT jsonb_build_object(
    'releases', COALESCE((SELECT jsonb_agg(public.admin_release_json(v.id) ORDER BY v.updated_at DESC, v.id DESC) FROM visible v), '[]'::jsonb),
    'last', CASE WHEN (SELECT count(*) FROM page) > p_limit THEN (
        SELECT jsonb_build_object('orderedAt', v.updated_at, 'id', v.id) FROM visible v ORDER BY v.updated_at, v.id LIMIT 1
    ) ELSE NULL END
)
$$;

CREATE OR REPLACE FUNCTION public.list_admin_domani_release_audit(
    p_release_id uuid,
    p_filters jsonb,
    p_limit integer,
    p_after jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_result jsonb;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.releases WHERE id = p_release_id) THEN RAISE EXCEPTION 'DEV1042_NOT_FOUND'; END IF;
    WITH page AS (
        SELECT e.* FROM public.release_audit_events e
        WHERE e.release_id = p_release_id
          AND ((p_filters->>'action') IS NULL OR e.action = p_filters->>'action')
          AND ((p_filters->>'entityType') IS NULL OR e.entity_type = p_filters->>'entityType')
          AND (p_after IS NULL OR (e.created_at, e.id) < ((p_after->>'orderedAt')::timestamptz, (p_after->>'id')::uuid))
        ORDER BY e.created_at DESC, e.id DESC LIMIT p_limit + 1
    ), visible AS (SELECT * FROM page ORDER BY created_at DESC, id DESC LIMIT p_limit)
    SELECT jsonb_build_object(
        'events', COALESCE(jsonb_agg(jsonb_build_object(
            'id', v.id, 'releaseId', v.release_id,
            'actor', jsonb_build_object('userId', v.actor_user_id, 'email', v.actor_email, 'role', v.actor_role),
            'action', v.action, 'entityType', v.entity_type, 'entityId', v.entity_id,
            'requestId', v.request_id, 'beforeData', v.before_data,
            'afterData', v.after_data, 'metadata', v.metadata, 'createdAt', v.created_at
        ) ORDER BY v.created_at DESC, v.id DESC), '[]'::jsonb),
        'last', CASE WHEN (SELECT count(*) FROM page) > p_limit THEN (
            SELECT jsonb_build_object('orderedAt', x.created_at, 'id', x.id) FROM visible x ORDER BY x.created_at, x.id LIMIT 1
        ) ELSE NULL END
    ) INTO v_result FROM visible v;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.mutate_admin_domani_release(
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
    v_before_release jsonb;
    v_note public.release_notes%ROWTYPE;
    v_before_note jsonb;
    v_source public.release_prds%ROWTYPE;
    v_before_source jsonb;
    v_role public.dashboard_role;
    v_email text;
    v_note_id uuid;
    v_source_id uuid;
    v_count integer;
    v_order integer;
    v_action text;
    v_entity_type text := 'release';
    v_entity_id uuid;
    v_data jsonb;
    v_targets text[] := ARRAY[]::text[];
    v_job_id uuid;
    v_audit_event_id uuid;
    v_receipt jsonb;
    v_release_version bigint;
    v_primary_version bigint;
    v_requested_lifecycle public.release_lifecycle_status;
    v_metadata jsonb := jsonb_build_object('source','dashboard');
BEGIN
    SELECT d.role, lower(u.email) INTO v_role, v_email
    FROM public.dashboard_user_roles d JOIN auth.users u ON u.id = d.user_id
    WHERE d.user_id = p_actor_user_id AND d.is_active;
    IF v_role IS NULL THEN RAISE EXCEPTION 'DEV1042_FORBIDDEN'; END IF;
    IF v_email IS NULL OR v_email <> lower(btrim(p_actor_email)) OR v_role <> p_actor_role THEN RAISE EXCEPTION 'DEV1042_FORBIDDEN'; END IF;
    IF p_operation = 'release.create' THEN
        IF v_role = 'viewer' THEN RAISE EXCEPTION 'DEV1042_FORBIDDEN'; END IF;
        INSERT INTO public.releases (
            version, slug, title, release_type, public_summary, internal_summary,
            target_month, target_date, confirmed_date, owner_user_id, created_by, updated_by
        ) VALUES (
            p_payload->>'version', p_payload->>'slug', p_payload->>'title', (p_payload->>'releaseType')::public.release_type,
            p_payload->>'publicSummary', p_payload->>'internalSummary',
            CASE WHEN p_payload ? 'targetMonth' AND p_payload->>'targetMonth' IS NOT NULL THEN to_date(p_payload->>'targetMonth' || '-01', 'YYYY-MM-DD') ELSE NULL END,
            (p_payload->>'targetDate')::date, (p_payload->>'confirmedDate')::date,
            (p_payload->>'ownerUserId')::uuid, p_actor_user_id, p_actor_user_id
        ) RETURNING * INTO v_release;
        v_action := 'release.created'; v_entity_id := v_release.id;
        v_data := jsonb_build_object('release', public.admin_release_json(v_release.id));
        v_release_version := v_release.row_version; v_primary_version := v_release.row_version;
    ELSE
        SELECT * INTO v_release FROM public.releases WHERE id = p_release_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'DEV1042_NOT_FOUND'; END IF;
        IF v_release.archived_at IS NOT NULL AND p_operation <> 'release.archive' THEN RAISE EXCEPTION 'DEV1042_NOT_FOUND'; END IF;
        IF v_role = 'viewer' THEN RAISE EXCEPTION 'DEV1042_FORBIDDEN'; END IF;
        IF v_release.visibility = 'published' AND v_role <> 'admin' THEN RAISE EXCEPTION 'DEV1042_PUBLISHED_ADMIN_REQUIRED'; END IF;
        v_before_release := public.admin_release_json(v_release.id);

        IF p_operation IN ('release.update','release.archive','release.publish_preview','release.return_private','release.publish','release.unpublish','note.create','note.reorder')
           AND v_release.row_version <> p_primary_if_match THEN RAISE EXCEPTION 'DEV1042_VERSION_CONFLICT';
        END IF;

        IF p_operation = 'release.update' THEN
            IF p_payload ? 'lifecycleStatus' THEN
                v_requested_lifecycle := (p_payload->>'lifecycleStatus')::public.release_lifecycle_status;
                IF v_requested_lifecycle <> v_release.lifecycle_status AND NOT (
                    (v_requested_lifecycle='planned' AND v_release.lifecycle_status IN ('draft','in_progress') AND v_release.visibility='private')
                    OR (v_requested_lifecycle='in_progress' AND v_release.lifecycle_status='planned' AND v_release.visibility IN ('private','public_preview'))
                    OR (v_requested_lifecycle='released' AND v_release.lifecycle_status IN ('planned','in_progress') AND v_release.visibility='private' AND p_payload ? 'releasedAt' AND p_payload->>'releasedAt' IS NOT NULL)
                    OR (v_requested_lifecycle='canceled' AND v_release.lifecycle_status IN ('draft','planned','in_progress') AND v_release.visibility='private')
                ) THEN RAISE EXCEPTION 'DEV1042_INVALID_STATE'; END IF;
            END IF;
            UPDATE public.releases SET
                title = CASE WHEN p_payload ? 'title' THEN p_payload->>'title' ELSE title END,
                slug = CASE WHEN p_payload ? 'slug' THEN p_payload->>'slug' ELSE slug END,
                release_type = CASE WHEN p_payload ? 'releaseType' THEN (p_payload->>'releaseType')::public.release_type ELSE release_type END,
                lifecycle_status = CASE WHEN p_payload ? 'lifecycleStatus' THEN (p_payload->>'lifecycleStatus')::public.release_lifecycle_status ELSE lifecycle_status END,
                public_summary = CASE WHEN p_payload ? 'publicSummary' THEN p_payload->>'publicSummary' ELSE public_summary END,
                internal_summary = CASE WHEN p_payload ? 'internalSummary' THEN p_payload->>'internalSummary' ELSE internal_summary END,
                target_month = CASE WHEN p_payload ? 'targetMonth' THEN CASE WHEN p_payload->>'targetMonth' IS NULL THEN NULL ELSE to_date(p_payload->>'targetMonth' || '-01', 'YYYY-MM-DD') END ELSE target_month END,
                target_date = CASE WHEN p_payload ? 'targetDate' THEN (p_payload->>'targetDate')::date ELSE target_date END,
                confirmed_date = CASE WHEN p_payload ? 'confirmedDate' THEN (p_payload->>'confirmedDate')::date ELSE confirmed_date END,
                released_at = CASE WHEN p_payload ? 'releasedAt' THEN (p_payload->>'releasedAt')::timestamptz ELSE released_at END,
                owner_user_id = CASE WHEN p_payload ? 'ownerUserId' THEN (p_payload->>'ownerUserId')::uuid ELSE owner_user_id END,
                updated_by = p_actor_user_id, row_version = row_version + 1
            WHERE id = v_release.id RETURNING * INTO v_release;
            IF (v_release.lifecycle_status = 'released') <> (v_release.released_at IS NOT NULL) THEN
                RAISE EXCEPTION 'DEV1042_INVALID_STATE';
            END IF;
            v_action := 'release.updated';
            IF v_release.visibility <> 'private' AND p_payload ?| ARRAY['title','slug','releaseType','lifecycleStatus','publicSummary','targetMonth','targetDate','confirmedDate','releasedAt'] THEN
                IF v_release.visibility = 'public_preview' THEN v_targets := ARRAY['/api/domani/releases/coming-soon','/coming-soon'];
                ELSE v_targets := ARRAY['/api/domani/releases/changelog','/changelog']; END IF;
            END IF;
        ELSIF p_operation = 'release.archive' THEN
            IF v_role <> 'admin' THEN RAISE EXCEPTION 'DEV1042_FORBIDDEN'; END IF;
            IF v_release.archived_at IS NOT NULL THEN RAISE EXCEPTION 'DEV1042_INVALID_STATE'; END IF;
            IF v_release.visibility = 'public_preview' THEN v_targets := ARRAY['/api/domani/releases/coming-soon','/coming-soon'];
            ELSIF v_release.visibility = 'published' THEN v_targets := ARRAY['/api/domani/releases/changelog','/changelog']; END IF;
            UPDATE public.releases SET visibility='private', archived_at=now(), archived_by=p_actor_user_id, updated_by=p_actor_user_id, row_version=row_version+1 WHERE id=v_release.id RETURNING * INTO v_release;
            v_action := 'release.archived';
        ELSIF p_operation = 'release.publish_preview' THEN
            IF v_release.visibility <> 'private' OR v_release.lifecycle_status NOT IN ('planned','in_progress') OR v_release.release_type = 'patch' OR nullif(btrim(v_release.public_summary),'') IS NULL THEN RAISE EXCEPTION 'DEV1042_INVALID_STATE'; END IF;
            IF NOT EXISTS (SELECT 1 FROM public.release_notes WHERE release_id=v_release.id AND archived_at IS NULL AND is_public) THEN RAISE EXCEPTION 'DEV1042_PUBLIC_NOTE_REQUIRED'; END IF;
            UPDATE public.releases SET visibility='public_preview', updated_by=p_actor_user_id, row_version=row_version+1 WHERE id=v_release.id RETURNING * INTO v_release;
            v_action := 'release.preview_published'; v_targets := ARRAY['/api/domani/releases/coming-soon','/coming-soon'];
        ELSIF p_operation = 'release.return_private' THEN
            IF v_release.visibility <> 'public_preview' THEN RAISE EXCEPTION 'DEV1042_INVALID_STATE'; END IF;
            UPDATE public.releases SET visibility='private', updated_by=p_actor_user_id, row_version=row_version+1 WHERE id=v_release.id RETURNING * INTO v_release;
            v_action := 'release.preview_returned_private'; v_targets := ARRAY['/api/domani/releases/coming-soon','/coming-soon'];
        ELSIF p_operation = 'release.publish' THEN
            IF v_role <> 'admin' OR v_release.visibility <> 'private' OR v_release.lifecycle_status <> 'released' OR v_release.released_at IS NULL OR nullif(btrim(v_release.public_summary),'') IS NULL THEN RAISE EXCEPTION 'DEV1042_INVALID_STATE'; END IF;
            IF NOT EXISTS (SELECT 1 FROM public.release_notes WHERE release_id=v_release.id AND archived_at IS NULL AND is_public) THEN RAISE EXCEPTION 'DEV1042_PUBLIC_NOTE_REQUIRED'; END IF;
            v_targets := ARRAY['/api/domani/releases/changelog','/changelog'];
            UPDATE public.releases SET visibility='published', updated_by=p_actor_user_id, row_version=row_version+1 WHERE id=v_release.id RETURNING * INTO v_release;
            v_action := 'release.published';
        ELSIF p_operation = 'release.unpublish' THEN
            IF v_role <> 'admin' OR v_release.visibility <> 'published' THEN RAISE EXCEPTION 'DEV1042_INVALID_STATE'; END IF;
            UPDATE public.releases SET visibility='private', updated_by=p_actor_user_id, row_version=row_version+1 WHERE id=v_release.id RETURNING * INTO v_release;
            v_action := 'release.unpublished'; v_targets := ARRAY['/api/domani/releases/changelog','/changelog'];
        ELSIF p_operation = 'note.create' THEN
            SELECT COALESCE(max(sort_order)+1,0) INTO v_order FROM public.release_notes WHERE release_id=v_release.id AND archived_at IS NULL;
            INSERT INTO public.release_notes (release_id,note_type,public_title,public_body,technical_notes,platforms,is_public,sort_order,created_by,updated_by)
            VALUES (v_release.id,(p_payload->>'noteType')::public.release_note_type,p_payload->>'publicTitle',p_payload->>'publicBody',p_payload->>'technicalNotes',ARRAY(SELECT jsonb_array_elements_text(p_payload->'platforms'))::public.release_platform[],COALESCE((p_payload->>'isPublic')::boolean,false),v_order,p_actor_user_id,p_actor_user_id)
            RETURNING * INTO v_note;
            UPDATE public.releases SET updated_by=p_actor_user_id,row_version=row_version+1 WHERE id=v_release.id RETURNING * INTO v_release;
            v_action := 'note.created'; v_entity_type := 'note'; v_entity_id := v_note.id;
            IF v_before_release->>'visibility' = 'public_preview' THEN v_targets := ARRAY['/api/domani/releases/coming-soon','/coming-soon'];
            ELSIF v_before_release->>'visibility' = 'published' THEN v_targets := ARRAY['/api/domani/releases/changelog','/changelog']; END IF;
            v_data := jsonb_build_object('note',public.admin_release_note_json(v_note.id),'releaseRowVersion',v_release.row_version);
            v_primary_version := v_note.row_version;
        ELSIF p_operation IN ('note.update','note.archive') THEN
            v_note_id := (p_payload->>'noteId')::uuid;
            SELECT * INTO v_note FROM public.release_notes WHERE id=v_note_id AND release_id=v_release.id FOR UPDATE;
            IF NOT FOUND OR v_note.archived_at IS NOT NULL THEN RAISE EXCEPTION 'DEV1042_NOT_FOUND'; END IF;
            IF v_note.row_version <> p_primary_if_match OR v_release.row_version <> (p_payload->>'releaseRowVersion')::bigint THEN RAISE EXCEPTION 'DEV1042_VERSION_CONFLICT'; END IF;
            v_before_note := public.admin_release_note_json(v_note.id);
            IF p_operation = 'note.update' THEN
                UPDATE public.release_notes SET
                    note_type=CASE WHEN p_payload?'noteType' THEN (p_payload->>'noteType')::public.release_note_type ELSE note_type END,
                    public_title=CASE WHEN p_payload?'publicTitle' THEN p_payload->>'publicTitle' ELSE public_title END,
                    public_body=CASE WHEN p_payload?'publicBody' THEN p_payload->>'publicBody' ELSE public_body END,
                    technical_notes=CASE WHEN p_payload?'technicalNotes' THEN p_payload->>'technicalNotes' ELSE technical_notes END,
                    platforms=CASE WHEN p_payload?'platforms' THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'platforms'))::public.release_platform[] ELSE platforms END,
                    is_public=CASE WHEN p_payload?'isPublic' THEN (p_payload->>'isPublic')::boolean ELSE is_public END,
                    updated_by=p_actor_user_id,row_version=row_version+1
                WHERE id=v_note.id RETURNING * INTO v_note;
                v_action := 'note.updated';
            ELSE
                IF v_role <> 'admin' THEN RAISE EXCEPTION 'DEV1042_FORBIDDEN'; END IF;
                v_order := v_note.sort_order;
                UPDATE public.release_notes SET archived_at=now(),archived_by=p_actor_user_id,is_public=false,updated_by=p_actor_user_id,row_version=row_version+1 WHERE id=v_note.id RETURNING * INTO v_note;
                UPDATE public.release_notes SET sort_order=sort_order+1000000 WHERE release_id=v_release.id AND archived_at IS NULL AND sort_order>v_order;
                UPDATE public.release_notes SET sort_order=sort_order-1000001,updated_by=p_actor_user_id,row_version=row_version+1 WHERE release_id=v_release.id AND archived_at IS NULL AND sort_order>1000000;
                v_action := 'note.archived';
            END IF;
            IF v_release.visibility <> 'private' AND NOT EXISTS (
                SELECT 1 FROM public.release_notes
                WHERE release_id=v_release.id AND archived_at IS NULL AND is_public
            ) THEN RAISE EXCEPTION 'DEV1042_PUBLIC_NOTE_REQUIRED'; END IF;
            UPDATE public.releases SET updated_by=p_actor_user_id,row_version=row_version+1 WHERE id=v_release.id RETURNING * INTO v_release;
            v_entity_type := 'note'; v_entity_id := v_note.id;
            IF v_release.visibility='public_preview' THEN v_targets := ARRAY['/api/domani/releases/coming-soon','/coming-soon']; ELSIF v_release.visibility='published' THEN v_targets := ARRAY['/api/domani/releases/changelog','/changelog']; END IF;
            v_data := jsonb_build_object('note',public.admin_release_note_json(v_note.id),'releaseRowVersion',v_release.row_version); v_primary_version:=v_note.row_version;
        ELSIF p_operation = 'note.reorder' THEN
            SELECT count(*), count(DISTINCT (x.item->>'id')::uuid)
            INTO v_count, v_order
            FROM jsonb_array_elements(p_payload->'notes') x(item);
            IF v_count <> v_order OR v_count <> (SELECT count(*) FROM public.release_notes WHERE release_id=v_release.id AND archived_at IS NULL) OR EXISTS (
                SELECT 1 FROM jsonb_array_elements(p_payload->'notes') x(item)
                LEFT JOIN public.release_notes n ON n.id=(x.item->>'id')::uuid AND n.release_id=v_release.id AND n.archived_at IS NULL
                WHERE n.id IS NULL OR n.row_version<>(x.item->>'rowVersion')::bigint
            ) THEN RAISE EXCEPTION 'DEV1042_NOTE_SET_INVALID'; END IF;
            UPDATE public.release_notes SET sort_order=sort_order+1000000 WHERE release_id=v_release.id AND archived_at IS NULL;
            WITH desired AS (
                SELECT (item->>'id')::uuid AS id, ordinality-1 AS sort_order
                FROM jsonb_array_elements(p_payload->'notes') WITH ORDINALITY AS x(item, ordinality)
            )
            UPDATE public.release_notes n SET sort_order=d.sort_order,updated_by=p_actor_user_id,row_version=n.row_version+1 FROM desired d WHERE n.id=d.id;
            UPDATE public.releases SET updated_by=p_actor_user_id,row_version=row_version+1 WHERE id=v_release.id RETURNING * INTO v_release;
            v_action := 'note.reordered'; v_entity_type := 'release'; v_entity_id := v_release.id;
            SELECT jsonb_build_object(
                'source','dashboard',
                'orderedNoteIds',COALESCE(jsonb_agg(x.item->'id' ORDER BY x.ordinality),'[]'::jsonb)
            ) INTO v_metadata
            FROM jsonb_array_elements(p_payload->'notes') WITH ORDINALITY x(item,ordinality);
            IF v_release.visibility='public_preview' THEN v_targets := ARRAY['/api/domani/releases/coming-soon','/coming-soon']; ELSIF v_release.visibility='published' THEN v_targets := ARRAY['/api/domani/releases/changelog','/changelog']; END IF;
            SELECT COALESCE(jsonb_agg(public.admin_release_note_json(n.id) ORDER BY n.sort_order,n.id),'[]'::jsonb) INTO v_data FROM public.release_notes n WHERE n.release_id=v_release.id AND n.archived_at IS NULL;
            v_data := jsonb_build_object('notes',v_data,'releaseRowVersion',v_release.row_version); v_primary_version:=v_release.row_version;
        ELSIF p_operation = 'source.approve' THEN
            v_source_id := (p_payload->>'sourceId')::uuid;
            SELECT * INTO v_source FROM public.release_prds WHERE id=v_source_id AND release_id=v_release.id FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'DEV1042_NOT_FOUND'; END IF;
            IF v_source.row_version<>p_primary_if_match OR v_release.row_version<>(p_payload->>'releaseRowVersion')::bigint THEN RAISE EXCEPTION 'DEV1042_VERSION_CONFLICT'; END IF;
            IF v_source.conversion_status<>'needs_review' OR v_source.latest_conversion_run_id IS NULL THEN RAISE EXCEPTION 'DEV1042_SOURCE_STATE_INVALID'; END IF;
            v_before_source := public.admin_release_source_audit_json(v_source.id);
            SELECT count(*),count(DISTINCT (x.item->>'id')::uuid)
            INTO v_count,v_order
            FROM jsonb_array_elements(p_payload->'noteRowVersions') x(item);
            IF v_count<>v_order OR v_count<>(SELECT count(*) FROM public.release_notes WHERE release_id=v_release.id AND source_prd_id=v_source.id AND source_conversion_run_id=v_source.latest_conversion_run_id AND archived_at IS NULL) OR EXISTS (
                SELECT 1 FROM jsonb_array_elements(p_payload->'noteRowVersions') x(item)
                LEFT JOIN public.release_notes n ON n.id=(x.item->>'id')::uuid AND n.release_id=v_release.id AND n.source_prd_id=v_source.id AND n.source_conversion_run_id=v_source.latest_conversion_run_id AND n.archived_at IS NULL
                WHERE n.id IS NULL OR n.row_version<>(x.item->>'rowVersion')::bigint
            ) THEN RAISE EXCEPTION 'DEV1042_NOTE_SET_INVALID'; END IF;
            UPDATE public.release_prds SET conversion_status='approved',updated_by=p_actor_user_id,row_version=row_version+1 WHERE id=v_source.id RETURNING * INTO v_source;
            UPDATE public.releases SET updated_by=p_actor_user_id,row_version=row_version+1 WHERE id=v_release.id RETURNING * INTO v_release;
            v_action:='source.approved';v_entity_type:='source';v_entity_id:=v_source.id;
            v_data:=jsonb_build_object('source',public.admin_release_source_json(v_source.id),'approvedNoteIds',COALESCE((SELECT jsonb_agg(x.item->'id') FROM jsonb_array_elements(p_payload->'noteRowVersions') x(item)),'[]'::jsonb),'releaseRowVersion',v_release.row_version);
            v_primary_version:=v_source.row_version;
        ELSE RAISE EXCEPTION 'DEV1042_INVALID_STATE';
        END IF;

        IF v_data IS NULL THEN
            v_entity_id := COALESCE(v_entity_id,v_release.id);
            v_data := jsonb_build_object('release',public.admin_release_detail_json(v_release.id,v_role,true));
            v_primary_version:=v_release.row_version;
        END IF;
        v_release_version:=v_release.row_version;
    END IF;

    INSERT INTO public.release_audit_events(actor_user_id,actor_email,actor_role,action,entity_type,entity_id,release_id,request_id,before_data,after_data,metadata)
    VALUES(p_actor_user_id,v_email,v_role,v_action,v_entity_type,COALESCE(v_entity_id,v_release.id),v_release.id,p_request_id,
        CASE WHEN v_entity_type='note' THEN v_before_note WHEN v_entity_type='source' THEN v_before_source ELSE v_before_release END,
        CASE WHEN v_entity_type='note' THEN public.admin_release_note_json(v_entity_id) WHEN v_entity_type='source' THEN public.admin_release_source_audit_json(v_entity_id) ELSE public.admin_release_json(v_release.id) END,
        v_metadata)
    RETURNING id INTO v_audit_event_id;

    IF cardinality(v_targets)>0 THEN
        v_job_id:=gen_random_uuid();
        INSERT INTO public.release_cache_invalidation_jobs(id,release_id,event_key,targets)
        VALUES(v_job_id,v_release.id,v_audit_event_id::text,v_targets);
        v_receipt:=jsonb_build_object('jobId',v_job_id,'status','pending','targets',v_targets);
    END IF;
    RETURN jsonb_build_object('data',v_data,'releaseRowVersion',v_release_version,'primaryRowVersion',v_primary_version,'cacheInvalidation',v_receipt);
EXCEPTION
    WHEN check_violation OR invalid_text_representation OR not_null_violation OR foreign_key_violation THEN
        RAISE EXCEPTION 'DEV1042_INVALID_STATE';
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_release_cache_invalidation_jobs(p_limit integer DEFAULT 10)
RETURNS TABLE(id uuid, release_id uuid, targets text[], attempt_count integer)
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
WITH claimable AS (
    SELECT j.id
    FROM public.release_cache_invalidation_jobs j
    WHERE j.status IN ('pending','failed') AND j.next_attempt_at <= now()
    ORDER BY j.next_attempt_at, j.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit,1),100)
), claimed AS (
    UPDATE public.release_cache_invalidation_jobs j
    SET status='pending', attempt_count=j.attempt_count+1,
        next_attempt_at=now()+interval '5 minutes', last_error=NULL
    FROM claimable c WHERE j.id=c.id
    RETURNING j.id,j.release_id,j.targets,j.attempt_count
)
SELECT * FROM claimed
$$;

CREATE OR REPLACE FUNCTION public.complete_release_cache_invalidation_job(p_job_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
UPDATE public.release_cache_invalidation_jobs
SET status='delivered',delivered_at=now(),last_error=NULL
WHERE id=p_job_id AND status='pending'
$$;

CREATE OR REPLACE FUNCTION public.fail_release_cache_invalidation_job(p_job_id uuid,p_error text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
UPDATE public.release_cache_invalidation_jobs
SET status='failed',last_error=left(COALESCE(p_error,'Delivery failed'),1000),
    next_attempt_at=now()+CASE
        WHEN attempt_count<=1 THEN interval '1 minute'
        WHEN attempt_count=2 THEN interval '5 minutes'
        WHEN attempt_count=3 THEN interval '15 minutes'
        ELSE interval '1 hour'
    END
WHERE id=p_job_id AND status='pending'
$$;

CREATE OR REPLACE FUNCTION public.release_cache_invalidation_request_id(p_job_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
SELECT e.request_id
FROM public.release_cache_invalidation_jobs j
JOIN public.release_audit_events e ON e.id::text = j.event_key
WHERE j.id = p_job_id
$$;

REVOKE ALL ON FUNCTION public.admin_release_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_release_note_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_release_source_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_release_source_audit_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_release_allowed_actions(public.release_visibility,public.release_lifecycle_status,public.release_type,timestamptz,public.dashboard_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_release_detail_json(uuid,public.dashboard_role,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_admin_domani_release(uuid,boolean,public.dashboard_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_admin_domani_releases(jsonb,integer,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_admin_domani_release_audit(uuid,jsonb,integer,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mutate_admin_domani_release(text,uuid,bigint,jsonb,uuid,text,public.dashboard_role,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_release_cache_invalidation_jobs(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_release_cache_invalidation_job(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_release_cache_invalidation_job(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_cache_invalidation_request_id(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_release_json(uuid), public.admin_release_note_json(uuid), public.admin_release_source_json(uuid), public.admin_release_source_audit_json(uuid), public.admin_release_allowed_actions(public.release_visibility,public.release_lifecycle_status,public.release_type,timestamptz,public.dashboard_role), public.admin_release_detail_json(uuid,public.dashboard_role,boolean), public.get_admin_domani_release(uuid,boolean,public.dashboard_role), public.list_admin_domani_releases(jsonb,integer,jsonb), public.list_admin_domani_release_audit(uuid,jsonb,integer,jsonb), public.mutate_admin_domani_release(text,uuid,bigint,jsonb,uuid,text,public.dashboard_role,text), public.claim_release_cache_invalidation_jobs(integer), public.complete_release_cache_invalidation_job(uuid), public.fail_release_cache_invalidation_job(uuid,text), public.release_cache_invalidation_request_id(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
