-- Target: Domani project, not the PixelVerse authentication database.
-- Additive dashboard projection; app-facing source schemas remain unchanged.
BEGIN;

CREATE VIEW public.dashboard_domani_feedback WITH (security_invoker = true) AS
SELECT id, 'beta_feedback'::text AS source, user_id, email,
    CASE category WHEN 'bug_report' THEN 'bug' WHEN 'feature_idea' THEN 'feature'
        WHEN 'what_i_love' THEN 'love' WHEN 'general' THEN 'general' ELSE 'unknown' END AS category,
    category AS original_category, message,
    CASE status WHEN 'new' THEN 'new' WHEN 'reviewed' THEN 'reviewed'
        WHEN 'actioned' THEN 'resolved' WHEN 'archived' THEN 'resolved' ELSE 'unknown' END AS status,
    status AS original_status, platform, app_version, app_build,
    device_brand, device_model, os_version, created_at, updated_at
FROM public.beta_feedback
UNION ALL
SELECT id, 'support_request'::text, user_id, email, 'support'::text, category, description,
    CASE status WHEN 'pending' THEN 'new' WHEN 'in_progress' THEN 'reviewed'
        WHEN 'resolved' THEN 'resolved' WHEN 'closed' THEN 'resolved' ELSE 'unknown' END,
    status, platform, app_version, app_build, device_brand, device_model, os_version, created_at, updated_at
FROM public.support_requests;

REVOKE ALL ON public.dashboard_domani_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dashboard_domani_feedback TO service_role;

CREATE TABLE public.domani_feedback_status_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source text NOT NULL CHECK (source IN ('beta_feedback', 'support_request')),
    feedback_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    actor_email text NOT NULL,
    old_status text NOT NULL,
    new_status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.domani_feedback_status_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.domani_feedback_status_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.domani_feedback_status_audit TO service_role;
CREATE INDEX ON public.domani_feedback_status_audit (source, feedback_id, created_at);
CREATE INDEX IF NOT EXISTS beta_feedback_dashboard_created_idx ON public.beta_feedback (created_at DESC, id);
CREATE INDEX IF NOT EXISTS support_requests_dashboard_created_idx ON public.support_requests (created_at DESC, id);

-- One statement/snapshot for filtered records, page and all counts. No page-local totals.
CREATE FUNCTION public.list_dashboard_domani_feedback(p_query jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
WITH filtered AS MATERIALIZED (
    SELECT f.* FROM public.dashboard_domani_feedback f
    WHERE (p_query->>'category' IS NULL OR f.category = p_query->>'category')
      AND (p_query->>'status' IS NULL OR f.status = p_query->>'status')
      AND (p_query->>'source' IS NULL OR f.source = p_query->>'source')
      AND (p_query->>'platform' IS NULL OR
           CASE WHEN f.platform IN ('ios','android') THEN f.platform ELSE 'unknown' END = p_query->>'platform')
      AND (coalesce(p_query->>'search', '') = '' OR
           strpos(lower(coalesce(f.email, '')), lower(p_query->>'search')) > 0 OR
           strpos(lower(coalesce(f.message, '')), lower(p_query->>'search')) > 0)
      AND (p_query->>'start_date' IS NULL OR f.created_at >= (p_query->>'start_date')::timestamptz)
      AND (p_query->>'end_date' IS NULL OR
           CASE WHEN coalesce((p_query->>'end_date_exclusive')::boolean, false)
             THEN f.created_at < (p_query->>'end_date')::timestamptz
             ELSE f.created_at <= (p_query->>'end_date')::timestamptz END)
), ranked AS (
    SELECT f.*, row_number() OVER (ORDER BY
        CASE WHEN p_query->>'sort_by' = 'status' AND p_query->>'sort_order' = 'asc' THEN f.status END ASC NULLS LAST,
        CASE WHEN p_query->>'sort_by' = 'status' AND coalesce(p_query->>'sort_order','desc') = 'desc' THEN f.status END DESC NULLS LAST,
        CASE WHEN coalesce(p_query->>'sort_by','created_at') = 'created_at' AND p_query->>'sort_order' = 'asc' THEN f.created_at END ASC NULLS LAST,
        CASE WHEN coalesce(p_query->>'sort_by','created_at') = 'created_at' AND coalesce(p_query->>'sort_order','desc') = 'desc' THEN f.created_at END DESC NULLS LAST,
        f.created_at DESC NULLS LAST, f.source ASC, f.id ASC) AS ordinal
    FROM filtered f
), paged AS (
    SELECT * FROM ranked ORDER BY ordinal
    LIMIT least(greatest(coalesce((p_query->>'limit')::int,50),1),100)
    OFFSET greatest(coalesce((p_query->>'offset')::int,0),0)
), stats AS (
    SELECT jsonb_build_object(
        'total', count(*),
        'by_status', jsonb_build_object('new', count(*) FILTER (WHERE status='new'),
            'reviewed', count(*) FILTER (WHERE status='reviewed'), 'resolved', count(*) FILTER (WHERE status='resolved'),
            'unknown', count(*) FILTER (WHERE status='unknown')),
        'by_category', coalesce((SELECT jsonb_object_agg(category,n) FROM (SELECT category,count(*) n FROM filtered GROUP BY category) c),'{}'::jsonb),
        'by_platform', coalesce((SELECT jsonb_object_agg(platform,n) FROM (
            SELECT CASE WHEN platform IN ('ios','android') THEN platform ELSE 'unknown' END platform,count(*) n
            FROM filtered GROUP BY 1) c),'{}'::jsonb)) AS value
    FROM filtered
)
SELECT jsonb_build_object(
    'items', coalesce((SELECT jsonb_agg(to_jsonb(p)-'ordinal' ORDER BY ordinal) FROM paged p),'[]'::jsonb),
    'total', (SELECT count(*) FROM filtered),
    'feedback_count', (SELECT count(*) FROM filtered WHERE source='beta_feedback'),
    'support_count', (SELECT count(*) FROM filtered WHERE source='support_request'),
    'stats', (SELECT value FROM stats),
    'limit', least(greatest(coalesce((p_query->>'limit')::int,50),1),100),
    'offset', greatest(coalesce((p_query->>'offset')::int,0),0)
)
$$;

CREATE FUNCTION public.set_dashboard_domani_feedback_status(
    p_source text, p_id uuid, p_status text, p_actor_id uuid, p_actor_email text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE old_raw text; old_normalized text; next_raw text; result jsonb;
BEGIN
    IF p_source IS NULL OR p_source NOT IN ('beta_feedback','support_request') OR
       p_status IS NULL OR p_status NOT IN ('new','reviewed','resolved') OR
       p_actor_id IS NULL OR nullif(trim(p_actor_email),'') IS NULL THEN
        RAISE EXCEPTION 'Invalid feedback status update' USING ERRCODE = '22023';
    END IF;
    IF p_source='beta_feedback' THEN
        SELECT status INTO old_raw FROM public.beta_feedback WHERE id=p_id FOR UPDATE;
        next_raw := CASE p_status WHEN 'resolved' THEN 'actioned' ELSE p_status END;
    ELSE
        SELECT status INTO old_raw FROM public.support_requests WHERE id=p_id FOR UPDATE;
        next_raw := CASE p_status WHEN 'new' THEN 'pending' WHEN 'reviewed' THEN 'in_progress' ELSE 'resolved' END;
    END IF;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT status INTO old_normalized FROM public.dashboard_domani_feedback WHERE source=p_source AND id=p_id;
    -- Preserve archived/closed raw states for idempotent normalized updates.
    IF old_normalized <> p_status THEN
        IF p_source='beta_feedback' THEN
            UPDATE public.beta_feedback SET status=next_raw, updated_at=now() WHERE id=p_id;
        ELSE
            UPDATE public.support_requests SET status=next_raw, updated_at=now() WHERE id=p_id;
        END IF;
        INSERT INTO public.domani_feedback_status_audit(source,feedback_id,actor_id,actor_email,old_status,new_status)
        VALUES (p_source,p_id,p_actor_id,p_actor_email,old_raw,next_raw);
    END IF;
    SELECT to_jsonb(f) INTO result FROM public.dashboard_domani_feedback f WHERE source=p_source AND id=p_id;
    RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.list_dashboard_domani_feedback(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_dashboard_domani_feedback_status(text,uuid,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_dashboard_domani_feedback(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_dashboard_domani_feedback_status(text,uuid,text,uuid,text) TO service_role;
COMMIT;
