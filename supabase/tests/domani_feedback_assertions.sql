\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE r jsonb; item jsonb; n integer;
BEGIN
 r := public.list_dashboard_domani_feedback('{"limit":50,"offset":100}');
 IF (r->>'total')::int <>126 OR jsonb_array_length(r->'items')<>26 OR (r#>>'{stats,by_status,new}')::int<>126 THEN RAISE EXCEPTION 'Global count/page mismatch: %',r; END IF;
 r := public.list_dashboard_domani_feedback('{"source":"support_request","platform":"unknown"}');
 IF (r->>'total')::int <>1 OR r#>>'{items,0,category}' <> 'support' OR r#>>'{items,0,status}' <> 'new' THEN RAISE EXCEPTION 'Support normalization'; END IF;
 r := public.list_dashboard_domani_feedback('{"search":"%_"}');
 IF (r->>'total')::int<>1 THEN RAISE EXCEPTION 'Search must be literal'; END IF;
 r := public.list_dashboard_domani_feedback('{"start_date":"2026-09-17T00:00:00Z","end_date":"2026-09-17T23:59:59.999Z"}');
 IF (r->>'total')::int<>1 THEN RAISE EXCEPTION 'Inclusive UTC date boundary'; END IF;
 UPDATE public.support_requests SET created_at='2026-09-17T23:59:59.999500Z';
 r := public.list_dashboard_domani_feedback('{"start_date":"2026-09-17T00:00:00Z","end_date":"2026-09-18T00:00:00Z","end_date_exclusive":true}');
 IF (r->>'total')::int<>1 THEN RAISE EXCEPTION 'Date-only end must include sub-millisecond timestamps'; END IF;
 UPDATE public.support_requests SET created_at='2026-09-18T00:00:00Z';
 r := public.list_dashboard_domani_feedback('{"start_date":"2026-09-17T00:00:00Z","end_date":"2026-09-18T00:00:00Z","end_date_exclusive":true}');
 IF (r->>'total')::int<>0 THEN RAISE EXCEPTION 'Date-only end must exclude next midnight'; END IF;
 r := public.list_dashboard_domani_feedback('{"start_date":"2026-09-18T00:00:00Z","end_date":"2026-09-18T00:00:00Z"}');
 IF (r->>'total')::int<>1 THEN RAISE EXCEPTION 'Explicit timestamp end must remain inclusive'; END IF;
 r := public.list_dashboard_domani_feedback('{"category":"bug","limit":1,"sort_order":"asc"}');
 IF (r->>'total')::int<>125 OR r#>>'{items,0,id}'<>'00000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'Category mapping/sort'; END IF;
 r := public.list_dashboard_domani_feedback('{"search":"absent-value"}');
 IF (r->>'total')::int<>0 OR jsonb_array_length(r->'items')<>0 OR (r#>>'{stats,by_status,new}')::int<>0 THEN RAISE EXCEPTION 'Empty results'; END IF;
 item := public.set_dashboard_domani_feedback_status('support_request','00000000-0000-4000-8000-000000000001','resolved','10000000-0000-4000-8000-000000000001','staff@example.test');
 IF item->>'original_status'<>'resolved' THEN RAISE EXCEPTION 'Support status mapping'; END IF;
 item := public.set_dashboard_domani_feedback_status('beta_feedback','00000000-0000-4000-8000-000000000001','resolved','10000000-0000-4000-8000-000000000001','staff@example.test');
 IF item->>'original_status'<>'actioned' THEN RAISE EXCEPTION 'Beta status mapping'; END IF;
 SELECT count(*) INTO n FROM public.domani_feedback_status_audit;
 IF n<>2 THEN RAISE EXCEPTION 'Missing atomic audit'; END IF;
 PERFORM public.set_dashboard_domani_feedback_status('beta_feedback','00000000-0000-4000-8000-000000000001','resolved','10000000-0000-4000-8000-000000000001','staff@example.test');
 SELECT count(*) INTO n FROM public.domani_feedback_status_audit;
 IF n<>2 THEN RAISE EXCEPTION 'Duplicate audit on no-op'; END IF;
 UPDATE public.beta_feedback SET status='archived' WHERE id='00000000-0000-4000-8000-000000000001';
 item := public.set_dashboard_domani_feedback_status('beta_feedback','00000000-0000-4000-8000-000000000001','resolved','10000000-0000-4000-8000-000000000001','staff@example.test');
 IF item->>'original_status'<>'archived' THEN RAISE EXCEPTION 'Must preserve archived no-op'; END IF;
 item := public.set_dashboard_domani_feedback_status('beta_feedback','ffffffff-ffff-4fff-8fff-ffffffffffff','new','10000000-0000-4000-8000-000000000001','staff@example.test');
 IF item IS NOT NULL THEN RAISE EXCEPTION 'Missing record should return null'; END IF;
 BEGIN
  PERFORM public.set_dashboard_domani_feedback_status('invalid','00000000-0000-4000-8000-000000000001','new','10000000-0000-4000-8000-000000000001','staff@example.test');
  RAISE EXCEPTION 'Invalid source accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF has_table_privilege('anon','public.dashboard_domani_feedback','SELECT') OR has_table_privilege('authenticated','public.dashboard_domani_feedback','SELECT') THEN RAISE EXCEPTION 'Public view exposure'; END IF;
 IF has_function_privilege('anon','public.list_dashboard_domani_feedback(jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.set_dashboard_domani_feedback_status(text,uuid,text,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'Public RPC exposure'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.domani_feedback_status_audit'::regclass) THEN RAISE EXCEPTION 'Audit RLS not enabled'; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM * FROM public.dashboard_domani_feedback; RAISE EXCEPTION 'Anon view access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.list_dashboard_domani_feedback('{}'); RAISE EXCEPTION 'Anon RPC access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
