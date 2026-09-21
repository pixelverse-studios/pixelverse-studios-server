BEGIN;
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; a jsonb; b jsonb;
 item_keys text[]:=ARRAY['id','email','full_name','signup_cohort','signup_method','timezone','created_at','profile_created_at','joined_at','last_sign_in_at','last_active_at','activity_source','deleted_at','deletion_scheduled_for','banned_until','email_confirmed_at','email_verification_status','account_status','login_providers','latest_device_observation','feedback_count'];
 device_keys text[]:=ARRAY['source_id','source','observed_at','platform','device_brand','device_model','os_version','app_version','app_build'];
BEGIN
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
 IF ((r#>'{items,0}')-item_keys)<>'{}'::jsonb OR NOT ((r#>'{items,0}')?&item_keys) THEN RAISE EXCEPTION 'User response allowlist changed'; END IF;
 IF ((r#>'{items,0,latest_device_observation}')-device_keys)<>'{}'::jsonb OR NOT ((r#>'{items,0,latest_device_observation}')?&device_keys) THEN RAISE EXCEPTION 'Device response allowlist changed'; END IF;
 IF (r#>>'{stats,active_30d}')::int<>1 THEN RAISE EXCEPTION 'Recent activity failed'; END IF;
 r:=public.list_dashboard_domani_users('{"include_deleted":true}');
 IF (r#>>'{stats,activity_unknown}')::int<>123 OR (r#>>'{stats,deleted}')::int<>2 THEN RAISE EXCEPTION 'Aggregate counts failed'; END IF;
 IF (public.list_dashboard_domani_users('{}')->>'total')::int<>123 THEN RAISE EXCEPTION 'Legacy deleted default failed'; END IF;
 IF (public.list_dashboard_domani_users('{"platform":"android"}')->>'total')::int<>1 THEN RAISE EXCEPTION 'Platform filter failed'; END IF;
 IF (public.list_dashboard_domani_users('{"app_version":"5.0"}')->>'total')::int<>1 THEN RAISE EXCEPTION 'App version filter failed'; END IF;
 IF (public.list_dashboard_domani_users('{"verification":"unverified"}')->>'total')::int<>1 THEN RAISE EXCEPTION 'Verification filter failed'; END IF;
 IF (public.list_dashboard_domani_users('{"activity":"recent"}')->>'total')::int<>1
 OR (public.list_dashboard_domani_users('{"activity":"older"}')->>'total')::int<>1
 OR (public.list_dashboard_domani_users('{"activity":"unknown"}')->>'total')::int<>121
 THEN RAISE EXCEPTION 'Activity classification failed'; END IF;
 r:=public.list_dashboard_domani_users('{"search":"user7@"}');
 IF r#>'{items,0,last_active_at}'<>'null'::jsonb OR r#>'{items,0,activity_source}'<>'null'::jsonb THEN RAISE EXCEPTION 'Future client activity was trusted'; END IF;
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
