BEGIN;
-- Same email, unrelated stable account IDs.
INSERT INTO public.beta_feedback(id,user_id,email,category,message,status,created_at)
VALUES ('90000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','fixture@example.test','general','unrelated','new',now());
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.list_dashboard_domani_feedback('{"user_id":"10000000-0000-4000-8000-000000000001","limit":100}');
 IF (r->>'total')::int<>126 OR (r#>>'{stats,total}')::int<>126 OR jsonb_array_length(r->'items')<>100 THEN RAISE EXCEPTION 'Scoped totals/page failed'; END IF;
 IF r->>'user_id'<>'10000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'Scope marker missing'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'items') i WHERE i->>'user_id'<>'10000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'Identity collision leaked'; END IF;
 r:=public.list_dashboard_domani_feedback('{"user_id":"10000000-0000-4000-8000-000000000001","offset":100}');
 IF jsonb_array_length(r->'items')<>26 THEN RAISE EXCEPTION 'Scoped second page failed'; END IF;
 r:=public.list_dashboard_domani_feedback('{"user_id":"20000000-0000-4000-8000-000000000001","search":"unrelated"}');
 IF (r->>'total')::int<>1 THEN RAISE EXCEPTION 'Scoped search failed'; END IF;
 IF (public.list_dashboard_domani_feedback('{"user_id":"30000000-0000-4000-8000-000000000001"}')->>'total')::int<>0 THEN RAISE EXCEPTION 'Missing user fell back to all'; END IF;
 IF (public.list_dashboard_domani_feedback('{}')->>'total')::int<>127 THEN RAISE EXCEPTION 'Unfiltered behavior changed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN IF has_function_privilege('anon','public.list_dashboard_domani_feedback(jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.list_dashboard_domani_feedback(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Public grant'; END IF; END $$;
ROLLBACK;
