-- DEV-1410: exact user identity filtering before paging and counts. No data mutation.
BEGIN;
CREATE OR REPLACE FUNCTION public.list_dashboard_domani_feedback(p_query jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
WITH filtered AS MATERIALIZED (
    SELECT f.* FROM public.dashboard_domani_feedback f
    WHERE (p_query->>'user_id' IS NULL OR f.user_id = (p_query->>'user_id')::uuid)
      AND (p_query->>'category' IS NULL OR f.category = p_query->>'category')
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
    'user_id', p_query->>'user_id',
    'items', coalesce((SELECT jsonb_agg(to_jsonb(p)-'ordinal' ORDER BY ordinal) FROM paged p),'[]'::jsonb),
    'total', (SELECT count(*) FROM filtered),
    'feedback_count', (SELECT count(*) FROM filtered WHERE source='beta_feedback'),
    'support_count', (SELECT count(*) FROM filtered WHERE source='support_request'),
    'stats', (SELECT value FROM stats),
    'limit', least(greatest(coalesce((p_query->>'limit')::int,50),1),100),
    'offset', greatest(coalesce((p_query->>'offset')::int,0),0)
)
$$;

REVOKE ALL ON FUNCTION public.list_dashboard_domani_feedback(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_dashboard_domani_feedback(jsonb) TO service_role;
COMMIT;
