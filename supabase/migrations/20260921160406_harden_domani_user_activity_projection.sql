-- Normalize unusable future client activity and keep the browser response on an
-- explicit allowlist even if the backing views gain columns later.
BEGIN;

CREATE OR REPLACE VIEW public.dashboard_domani_user_insights WITH (security_invoker=true) AS
 SELECT p.id,p.email,p.full_name,p.signup_cohort::text,p.signup_method,p.timezone,p.created_at,p.created_at AS profile_created_at,
 a.created_at AS joined_at,a.last_sign_in_at,
 CASE WHEN p.last_active_at<=now() THEN p.last_active_at END AS last_active_at,
 CASE WHEN p.last_active_at<=now() THEN 'app_foreground' END AS activity_source,
 p.deleted_at,p.deletion_scheduled_for,a.banned_until,a.email_confirmed_at,
 CASE WHEN a.id IS NULL THEN 'unknown' WHEN a.email_confirmed_at IS NOT NULL THEN 'verified' ELSE 'unverified' END AS email_verification_status,
 CASE WHEN a.deleted_at IS NOT NULL THEN 'deleted' WHEN p.deleted_at IS NOT NULL THEN 'deletion_pending'
 WHEN a.id IS NULL THEN 'unknown' WHEN a.banned_until>now() THEN 'banned' ELSE 'active' END AS account_status,
 coalesce(i.providers,ARRAY[]::text[]) AS login_providers,
 CASE WHEN d.source_id IS NOT NULL THEN jsonb_build_object(
   'source_id',d.source_id,'source',d.source,'observed_at',d.observed_at,
   'platform',d.platform,'device_brand',d.device_brand,'device_model',d.device_model,
   'os_version',d.os_version,'app_version',d.app_version,'app_build',d.app_build
 ) END AS latest_device_observation,
 d.platform AS reported_platform,d.app_version AS reported_app_version,
 (SELECT count(*) FROM public.beta_feedback b WHERE b.user_id=p.id)+(SELECT count(*) FROM public.support_requests s WHERE s.user_id=p.id) AS feedback_count
 FROM public.profiles p LEFT JOIN auth.users a ON a.id=p.id
 LEFT JOIN LATERAL (SELECT array_agg(DISTINCT provider ORDER BY provider) AS providers FROM auth.identities WHERE user_id=p.id) i ON true
 LEFT JOIN LATERAL (SELECT * FROM public.dashboard_domani_user_devices WHERE user_id=p.id ORDER BY observed_at DESC NULLS LAST,source,source_id LIMIT 1) d ON true;

REVOKE ALL ON public.dashboard_domani_user_insights FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.dashboard_domani_user_insights TO service_role;

CREATE OR REPLACE FUNCTION public.list_dashboard_domani_users(p_query jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb; sort_key text:=coalesce(p_query->>'sort_by','joined_at'); sort_dir text:=coalesce(p_query->>'sort_order','desc');
 page_limit integer:=coalesce((p_query->>'limit')::integer,50); page_offset integer:=coalesce((p_query->>'offset')::integer,0);
BEGIN
 IF sort_key NOT IN ('joined_at','created_at','last_sign_in_at','last_active_at','email','full_name','account_status') OR sort_dir NOT IN ('asc','desc')
 OR page_limit NOT BETWEEN 1 AND 100 OR page_offset NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'Invalid user query' USING ERRCODE='22023'; END IF;
 EXECUTE format($query$
 WITH filtered AS MATERIALIZED (
 SELECT * FROM public.dashboard_domani_user_insights u WHERE
 ($1->>'id' IS NULL OR u.id=($1->>'id')::uuid)
 AND (coalesce(($1->>'include_deleted')::boolean,false) OR u.deleted_at IS NULL AND u.account_status<>'deleted')
 AND ($1->>'search' IS NULL OR strpos(lower(coalesce(u.email,'')||' '||coalesce(u.full_name,'')),lower($1->>'search'))>0)
 AND ($1->>'cohort' IS NULL OR u.signup_cohort=$1->>'cohort')
 AND ($1->>'provider' IS NULL OR $1->>'provider'=ANY(u.login_providers))
 AND ($1->>'account_status' IS NULL OR u.account_status=$1->>'account_status')
 AND ($1->>'verification' IS NULL OR u.email_verification_status=$1->>'verification')
 AND ($1->>'platform' IS NULL OR coalesce(u.reported_platform,'unknown')=$1->>'platform')
 AND ($1->>'app_version' IS NULL OR u.reported_app_version=$1->>'app_version')
 AND ($1->>'start_date' IS NULL OR u.joined_at>=($1->>'start_date')::timestamptz)
 AND ($1->>'end_date' IS NULL OR u.joined_at<($1->>'end_date')::timestamptz)
 AND ($1->>'activity' IS NULL OR CASE $1->>'activity'
 WHEN 'unknown' THEN u.last_active_at IS NULL
 WHEN 'recent' THEN u.last_active_at>=now()-interval '30 days'
 WHEN 'older' THEN u.last_active_at<now()-interval '30 days' ELSE false END)
 ), page AS (SELECT * FROM filtered ORDER BY %I %s NULLS LAST,id ASC LIMIT $2 OFFSET $3),
 stats AS (SELECT count(*) AS total,count(*) FILTER(WHERE deleted_at IS NULL AND account_status<>'deleted') AS non_deleted,
 count(*) FILTER(WHERE deleted_at IS NOT NULL OR account_status='deleted') AS deleted,
 count(*) FILTER(WHERE last_active_at IS NULL) AS activity_unknown,
 count(*) FILTER(WHERE account_status='active' AND last_active_at>=now()-interval '30 days') AS active_30d FROM filtered)
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'email',email,'full_name',full_name,'signup_cohort',signup_cohort,
   'signup_method',signup_method,'timezone',timezone,'created_at',created_at,
   'profile_created_at',profile_created_at,'joined_at',joined_at,
   'last_sign_in_at',last_sign_in_at,'last_active_at',last_active_at,
   'activity_source',activity_source,'deleted_at',deleted_at,
   'deletion_scheduled_for',deletion_scheduled_for,'banned_until',banned_until,
   'email_confirmed_at',email_confirmed_at,'email_verification_status',email_verification_status,
   'account_status',account_status,'login_providers',login_providers,
   'latest_device_observation',latest_device_observation,'feedback_count',feedback_count
 ) ORDER BY %I %s NULLS LAST,id ASC) FROM page),'[]'::jsonb),
 'total',(SELECT total FROM stats),'stats',(SELECT to_jsonb(stats)||jsonb_build_object('activity_window_days',30) FROM stats),'limit',$2,'offset',$3,'data_as_of',now())
 $query$,sort_key,sort_dir,sort_key,sort_dir) INTO result USING p_query,page_limit,page_offset;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.list_dashboard_domani_users(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_dashboard_domani_users(jsonb) TO service_role;

COMMIT;
