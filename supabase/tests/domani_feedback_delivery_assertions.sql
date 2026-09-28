BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE r jsonb; mid uuid; job jsonb; status text;
BEGIN
 r:=public.submit_domani_feedback_reply('beta_feedback','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','staff@example.test','Subject','Body','20000000-0000-4000-8000-000000000090','<p>Body</p>');
 mid:=(r->>'message_id')::uuid;
 job:=public.claim_domani_feedback_reply();
 -- Timeout/unknown provider id can be recovered from our immutable signed tag.
 status:=public.receive_domani_feedback_delivery('event-delivered','provider-1','email.delivered',now(),mid);
 IF status<>'applied' OR (SELECT delivery_status FROM public.domani_feedback_messages WHERE id=mid)<>'delivered' THEN RAISE EXCEPTION 'Tagged delivery not applied'; END IF;
 IF public.finish_domani_feedback_reply(mid,(job->>'lease_token')::uuid,'accepted','provider-1',NULL) THEN RAISE EXCEPTION 'Stale dispatcher overwrote delivery'; END IF;
 PERFORM public.receive_domani_feedback_delivery('event-sent-late','provider-1','email.sent',now()+interval '1 minute');
 PERFORM public.receive_domani_feedback_delivery('event-delay-late','provider-1','email.delivery_delayed',now()+interval '2 minutes');
 IF (SELECT delivery_status FROM public.domani_feedback_messages WHERE id=mid)<>'delivered' THEN RAISE EXCEPTION 'Delivery regressed'; END IF;
 PERFORM public.receive_domani_feedback_delivery('event-bounce','provider-1','email.bounced',now());
 PERFORM public.receive_domani_feedback_delivery('event-complaint','provider-1','email.complained',now());
 PERFORM public.receive_domani_feedback_delivery('event-delivered-again','provider-1','email.delivered',now()+interval '3 minutes');
 PERFORM public.receive_domani_feedback_delivery('event-delivered-again','provider-1','email.delivered',now()+interval '3 minutes');
 IF (SELECT delivery_status FROM public.domani_feedback_messages WHERE id=mid)<>'complained' THEN RAISE EXCEPTION 'Terminal outcome regressed'; END IF;
 IF (SELECT count(*) FROM public.domani_feedback_delivery_events WHERE event_id='event-delivered-again')<>1 THEN RAISE EXCEPTION 'Duplicate receipt'; END IF;
 r:=public.domani_feedback_reply_state('beta_feedback','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000090');
 IF (r->>'can_retry')::boolean THEN RAISE EXCEPTION 'Complaint retry allowed'; END IF;
 BEGIN
  PERFORM public.retry_domani_feedback_reply('beta_feedback','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000090');
  RAISE EXCEPTION 'Retry unexpectedly succeeded';
 EXCEPTION WHEN SQLSTATE 'DF409' THEN NULL; END;
 IF public.receive_domani_feedback_delivery('unknown','campaign-provider','email.delivered',now())<>'unmatched' THEN RAISE EXCEPTION 'Campaign event applied'; END IF;
 IF public.receive_domani_feedback_delivery('unsupported','provider-1','email.opened',now())<>'ignored' THEN RAISE EXCEPTION 'Tracking event applied'; END IF;
 -- A previously unmatched event is recoverable once provider identity is saved.
 r:=public.submit_domani_feedback_reply('support_request','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','staff@example.test','Subject','Body','20000000-0000-4000-8000-000000000091','<p>Body</p>');
 mid:=(r->>'message_id')::uuid;
 PERFORM public.receive_domani_feedback_delivery('early','provider-2','email.delivered',now());
 job:=public.claim_domani_feedback_reply();
 PERFORM public.finish_domani_feedback_reply(mid,(job->>'lease_token')::uuid,'accepted','provider-2',NULL);
 PERFORM public.replay_domani_feedback_delivery();
 IF (SELECT delivery_status FROM public.domani_feedback_messages WHERE id=mid)<>'delivered' THEN RAISE EXCEPTION 'Unmatched replay failed'; END IF;
 IF public.claim_domani_feedback_delivery_check('support_request','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000091') IS NULL THEN RAISE EXCEPTION 'Missing reconciliation'; END IF;
 IF public.claim_domani_feedback_delivery_check('support_request','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000091') IS NOT NULL THEN RAISE EXCEPTION 'Reconciliation not rate limited'; END IF;
 r:=public.list_domani_feedback_messages_latest('support_request','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1);
 IF r#>>'{items,0,delivery_status}'<>'delivered' OR r#>>'{items,0,sender_email}'<>'hello@domani-app.com' THEN RAISE EXCEPTION 'History contract'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.domani_feedback_delivery_events'::regclass) THEN RAISE EXCEPTION 'RLS missing'; END IF;
 IF has_table_privilege('authenticated','public.domani_feedback_delivery_events','SELECT') OR has_function_privilege('anon','public.receive_domani_feedback_delivery(text,text,text,timestamptz,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Client access'; END IF;
END $$;
ROLLBACK;
