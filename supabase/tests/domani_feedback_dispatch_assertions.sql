BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE fid uuid:='00000000-0000-4000-8000-000000000003'; actor uuid:='10000000-0000-4000-8000-000000000001';
 key uuid:='20000000-0000-4000-8000-000000000003'; r jsonb; job jsonb; job2 jsonb; mid uuid; tok uuid;
BEGIN
 r:=public.submit_domani_feedback_reply('beta_feedback',fid,actor,'staff@example.test','Subject','Plain body',key,'<p>Plain body</p>');
 mid:=(r->>'message_id')::uuid;
 IF r->>'delivery_status'<>'queued' THEN RAISE EXCEPTION 'Not queued'; END IF;
 PERFORM public.submit_domani_feedback_reply('beta_feedback',fid,actor,'staff@example.test','Subject','Plain body',key,'changed template');
 IF (SELECT payload->>'html' FROM public.domani_feedback_outbox WHERE message_id=mid)<>'<p>Plain body</p>' THEN RAISE EXCEPTION 'Replay changed provider payload'; END IF;
 job:=public.claim_domani_feedback_reply(); tok:=(job->>'lease_token')::uuid;
 IF job#>>'{payload,to}'<>'fixture@example.test' OR job#>>'{payload,from}'<>'Domani <hello@domani-app.com>' OR job#>>'{payload,reply_to}'<>'hello@domani-app.com' THEN RAISE EXCEPTION 'Authoritative recipient/sender'; END IF;
 IF public.claim_domani_feedback_reply() IS NOT NULL THEN RAISE EXCEPTION 'Double claimed'; END IF;
 IF public.finish_domani_feedback_reply(mid,gen_random_uuid(),'accepted','wrong-worker') THEN RAISE EXCEPTION 'Stale worker accepted'; END IF;
 PERFORM public.finish_domani_feedback_reply(mid,tok,'unknown',NULL,'PROVIDER_UNCERTAIN');
 IF (SELECT delivery_status FROM public.domani_feedback_messages WHERE id=mid)<>'unknown' THEN RAISE EXCEPTION 'Timeout not uncertain'; END IF;
 UPDATE public.domani_feedback_outbox SET available_at=now()-interval '1 second' WHERE message_id=mid;
 job2:=public.claim_domani_feedback_reply();
 IF job2->>'idempotency_key'<>job->>'idempotency_key' OR job2->'payload'<>job->'payload' THEN RAISE EXCEPTION 'Retry changed identity'; END IF;
 -- Simulate crash after send: no completion write, then lease recovery.
 UPDATE public.domani_feedback_outbox SET lease_expires_at=now()-interval '1 second' WHERE message_id=mid;
 job:=public.claim_domani_feedback_reply();
 IF public.finish_domani_feedback_reply(mid,(job2->>'lease_token')::uuid,'accepted','stale-provider') THEN RAISE EXCEPTION 'Old lease completed'; END IF;
 PERFORM public.finish_domani_feedback_reply(mid,(job->>'lease_token')::uuid,'accepted','provider-id');
 r:=public.domani_feedback_reply_state('beta_feedback',fid,key);
 IF r->>'delivery_status'<>'accepted' OR r->>'can_retry'<>'false' THEN RAISE EXCEPTION 'Acceptance semantics'; END IF;
 IF public.claim_domani_feedback_reply() IS NOT NULL THEN RAISE EXCEPTION 'Resent completed job'; END IF;
 -- Before provider dedup expiration: uncertain jobs can retry the same intent.
 UPDATE public.domani_feedback_outbox SET state='uncertain',retryable=true,attempts=5 WHERE message_id=mid;
 UPDATE public.domani_feedback_messages SET delivery_status='unknown' WHERE id=mid;
 r:=public.retry_domani_feedback_reply('beta_feedback',fid,key);
 IF r->>'delivery_status'<>'unknown' THEN RAISE EXCEPTION 'Retry erased uncertainty'; END IF;
 -- Beyond conservative 23-hour retention window: never call provider again.
 UPDATE public.domani_feedback_outbox SET first_attempt_at=now()-interval '24 hours' WHERE message_id=mid;
 job:=public.claim_domani_feedback_reply();
 IF job->>'skipped'<>'true' THEN RAISE EXCEPTION 'Expired key dispatched'; END IF;
 r:=public.domani_feedback_reply_state('beta_feedback',fid,key);
 IF r->>'can_retry'<>'false' OR r->>'needs_reconciliation'<>'true' THEN RAISE EXCEPTION 'Unsafe expired retry'; END IF;
 BEGIN PERFORM public.retry_domani_feedback_reply('beta_feedback',fid,key); RAISE EXCEPTION 'Expired retry allowed'; EXCEPTION WHEN SQLSTATE 'DF409' THEN NULL; END;
END $$;
RESET ROLE;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%domani_feedback%' LOOP
  IF has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('authenticated',f.oid,'EXECUTE') THEN RAISE EXCEPTION 'Public RPC exposure'; END IF;
 END LOOP;
END $$;
ROLLBACK;
