BEGIN;
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; a jsonb; b jsonb; BEGIN
 r:=public.list_dashboard_domani_users('{"include_deleted":true,"limit":100}');
 IF (r->>'total')::int<>125 OR jsonb_array_length(r->'items')<>100 THEN RAISE EXCEPTION 'Global pagination failed'; END IF;
 a:=public.list_dashboard_domani_users('{"include_deleted":true,"limit":100,"offset":100}');
 IF jsonb_array_length(a->'items')<>25 THEN RAISE EXCEPTION 'Second page failed'; END IF;
 IF r#>>'{items,0,id}'=a#>>'{items,0,id}' THEN RAISE EXCEPTION 'Unstable tie ordering'; END IF;
 r:=public.list_dashboard_domani_users('{"search":"user125@"}');
 IF (r->>'total')::int<>1 OR r#>>'{items,0,account_status}'<>'unknown' OR r#>>'{items,0,email_verification_status}'<>'unknown' THEN RAISE EXCEPTION 'Missing auth/global search failed'; END IF;
 r:=public.list_dashboard_domani_users('{"provider":"google"}');
 IF (r->>'total')::int<>1 OR r#>'{items,0,login_providers}'<>'["apple","google"]'::jsonb THEN RAISE EXCEPTION 'Providers failed'; END IF;
 IF r#>>'{items,0,latest_device_observation,source}'<>'feedback'
 OR r#>>'{items,0,latest_device_observation,source_id}'<>'80000000-0000-4000-8000-000000000001'
 OR r#>>'{items,0,latest_device_observation,platform}'<>'ios'
 OR r#>>'{items,0,latest_device_observation,device_model}'<>'Tie winner'
 OR r#>>'{items,0,latest_device_observation,app_version}'<>'5.0'
 THEN RAISE EXCEPTION 'Deterministic device snapshot selection failed'; END IF;
 IF (r#>>'{items,0,feedback_count}')::int<>128 THEN RAISE EXCEPTION 'Feedback identity count failed'; END IF;
 IF (r#>'{items,0}') ?| ARRAY['encrypted_password','raw_user_meta_data','raw_app_meta_data','confirmation_token','recovery_token'] THEN RAISE EXCEPTION 'Sensitive auth field leaked'; END IF;
 IF (r#>>'{stats,active_30d}')::int<>1 THEN RAISE EXCEPTION 'Recent activity failed'; END IF;
 r:=public.list_dashboard_domani_users('{"include_deleted":true}');
 IF (r#>>'{stats,activity_unknown}')::int<>122 OR (r#>>'{stats,deleted}')::int<>2 THEN RAISE EXCEPTION 'Aggregate counts failed'; END IF;
 IF (public.list_dashboard_domani_users('{}')->>'total')::int<>123 THEN RAISE EXCEPTION 'Legacy deleted default failed'; END IF;
 IF (public.list_dashboard_domani_users('{"platform":"android"}')->>'total')::int<>1 THEN RAISE EXCEPTION 'Platform filter failed'; END IF;
 IF (public.list_dashboard_domani_users('{"app_version":"5.0"}')->>'total')::int<>1 THEN RAISE EXCEPTION 'App version filter failed'; END IF;
 IF (public.list_dashboard_domani_users('{"verification":"unverified"}')->>'total')::int<>1 THEN RAISE EXCEPTION 'Verification filter failed'; END IF;
 IF (public.list_dashboard_domani_users('{"activity":"recent"}')->>'total')::int<>1
 OR (public.list_dashboard_domani_users('{"activity":"older"}')->>'total')::int<>1
 OR (public.list_dashboard_domani_users('{"activity":"unknown"}')->>'total')::int<>120
 THEN RAISE EXCEPTION 'Activity classification failed'; END IF;
 IF (public.list_dashboard_domani_users('{"account_status":"banned"}')->>'total')::int<>1 THEN RAISE EXCEPTION 'Ban state failed'; END IF;
 IF (public.list_dashboard_domani_users('{"account_status":"deleted","include_deleted":true}')->>'total')::int<>1 THEN RAISE EXCEPTION 'Auth deletion state failed'; END IF;
 IF (public.list_dashboard_domani_users('{"start_date":"2026-09-02T00:00:00Z"}')->>'total')::int<>0 THEN RAISE EXCEPTION 'Joined filter failed'; END IF;
 IF (public.list_dashboard_domani_users('{"end_date":"2026-09-01T00:00:00Z"}')->>'total')::int<>0 THEN RAISE EXCEPTION 'Exclusive end failed'; END IF;
 IF (public.list_dashboard_domani_users('{"search":"%_"}')->>'total')::int<>0 THEN RAISE EXCEPTION 'Search wildcard interpreted'; END IF;
 BEGIN PERFORM public.list_dashboard_domani_users('{"sort_by":"password"}'); RAISE EXCEPTION 'Invalid sort accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF has_column_privilege('service_role','auth.users','encrypted_password','SELECT') THEN RAISE EXCEPTION 'Excess auth grant'; END IF;
 IF NOT has_column_privilege('service_role','auth.users','last_sign_in_at','SELECT')
 OR NOT has_column_privilege('service_role','auth.identities','provider','SELECT')
 THEN RAISE EXCEPTION 'Required auth enrichment grant missing'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_table_privilege('anon','public.profiles_dashboard','SELECT') OR has_table_privilege('authenticated','public.dashboard_domani_user_insights','SELECT') OR has_function_privilege('anon','public.list_dashboard_domani_users(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Exposed insights'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.list_dashboard_domani_users('{}'); RAISE EXCEPTION 'RPC leaked'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM public.dashboard_domani_user_insights; RAISE EXCEPTION 'View leaked'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
