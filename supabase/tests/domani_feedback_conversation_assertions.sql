\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE fid uuid:='00000000-0000-4000-8000-000000000001';
 actor uuid:='10000000-0000-4000-8000-000000000001';
 actor2 uuid:='10000000-0000-4000-8000-000000000002';
 key uuid:='20000000-0000-4000-8000-000000000001';
 r jsonb; again jsonb; cid uuid; mid uuid; incoming uuid; newest uuid; other uuid; item jsonb;
BEGIN
 r:=public.list_domani_feedback_messages('beta_feedback',fid,actor);
 IF r->'items'<>'[]'::jsonb OR r->>'conversation_id' IS NOT NULL THEN RAISE EXCEPTION 'Empty history'; END IF;
 IF EXISTS(SELECT 1 FROM public.domani_feedback_conversations) THEN RAISE EXCEPTION 'Reads must not create conversations'; END IF;
 r:=public.queue_domani_feedback_reply('beta_feedback',fid,actor,'staff@example.test','A subject','Private test body',key);
 cid:=(r->>'conversation_id')::uuid; mid:=(r->>'message_id')::uuid;
 again:=public.queue_domani_feedback_reply('beta_feedback',fid,actor,'staff@example.test','A subject','Private test body',key);
 IF again->>'message_id'<>r->>'message_id' OR again->>'replayed'<>'true' THEN RAISE EXCEPTION 'Idempotency failed'; END IF;
 IF (SELECT count(*) FROM public.domani_feedback_messages)<>1 OR (SELECT count(*) FROM public.domani_feedback_outbox WHERE state='held')<>1
 OR (SELECT count(*) FROM public.domani_feedback_message_audit)<>1 THEN RAISE EXCEPTION 'Atomic persistence or deduplication'; END IF;
 IF (SELECT status FROM public.beta_feedback WHERE id=fid)<>'new' THEN RAISE EXCEPTION 'Reply changed lifecycle'; END IF;
 BEGIN
  PERFORM public.queue_domani_feedback_reply('beta_feedback',fid,actor,'staff@example.test','Changed subject','Private test body',key);
  RAISE EXCEPTION 'Changed replay accepted';
 EXCEPTION WHEN SQLSTATE 'DF409' THEN NULL; END;
 BEGIN
  UPDATE public.domani_feedback_messages SET body_text='Changed' WHERE id=mid;
  RAISE EXCEPTION 'Message edited';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  INSERT INTO public.domani_feedback_conversations(beta_feedback_id,support_request_id) VALUES(fid,fid);
  RAISE EXCEPTION 'Ambiguous source accepted';
 EXCEPTION WHEN check_violation OR unique_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.domani_feedback_conversations(beta_feedback_id) VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff');
  RAISE EXCEPTION 'Orphan source accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 -- Same UUID in the other source remains a separate conversation.
 r:=public.queue_domani_feedback_reply('support_request',fid,actor,'staff@example.test','Support subject','Body',key);
 other:=(r->>'message_id')::uuid;
 IF (r->>'conversation_id')::uuid=cid THEN RAISE EXCEPTION 'Source collision'; END IF;
 INSERT INTO public.domani_feedback_messages(conversation_id,direction,subject,body_text,sender_email,recipient_email,delivery_status,created_at)
 VALUES(cid,'inbound','Re: A subject','Synthetic incoming message','fixture@example.test','hello@domani-app.com','received','2020-01-01Z') RETURNING id INTO incoming;
 r:=public.list_domani_feedback_messages('beta_feedback',fid,actor,1);
 IF r#>>'{items,0,id}'<>mid::text OR r->>'next_cursor'<>mid::text THEN RAISE EXCEPTION 'First page ordering'; END IF;
 r:=public.list_domani_feedback_messages('beta_feedback',fid,actor,1,mid);
 IF r#>>'{items,0,id}'<>incoming::text OR r->>'next_cursor' IS NOT NULL THEN RAISE EXCEPTION 'Next page ordering'; END IF;
 IF (r->'items'->0) ?| ARRAY['request_key','provider_message_id','reference_ids'] THEN RAISE EXCEPTION 'Internal fields exposed'; END IF;
 BEGIN
  PERFORM public.list_domani_feedback_messages('beta_feedback',fid,actor,50,other);
  RAISE EXCEPTION 'Cross-conversation history cursor accepted';
 EXCEPTION WHEN SQLSTATE 'DF400' THEN NULL; END;
 BEGIN
  PERFORM public.mark_domani_feedback_read('beta_feedback',fid,actor,other);
  RAISE EXCEPTION 'Cross-conversation read accepted';
 EXCEPTION WHEN SQLSTATE 'DF400' THEN NULL; END;
 item:=public.get_dashboard_domani_feedback('beta_feedback',fid,actor);
 IF item#>>'{conversation,message_count}'<>'2' OR item#>>'{conversation,reply_count}'<>'1'
 OR item#>>'{conversation,unread_count}'<>'1' THEN RAISE EXCEPTION 'Summary counts'; END IF;
 PERFORM public.mark_domani_feedback_read('beta_feedback',fid,actor,incoming);
 PERFORM public.mark_domani_feedback_read('beta_feedback',fid,actor,mid);
 IF public.get_dashboard_domani_feedback('beta_feedback',fid,actor)#>>'{conversation,unread_count}'<>'0' THEN RAISE EXCEPTION 'Read cursor regressed'; END IF;
 IF public.get_dashboard_domani_feedback('beta_feedback',fid,actor2)#>>'{conversation,unread_count}'<>'1' THEN RAISE EXCEPTION 'Cross-staff read leak'; END IF;
 INSERT INTO public.domani_feedback_messages(conversation_id,direction,subject,body_text,sender_email,recipient_email,delivery_status,created_at)
 VALUES(cid,'inbound','Re: A subject','Late arriving mail','fixture@example.test','hello@domani-app.com','received','2019-01-01Z') RETURNING id INTO newest;
 IF public.get_dashboard_domani_feedback('beta_feedback',fid,actor)#>>'{conversation,unread_count}'<>'1' THEN RAISE EXCEPTION 'Late arrival lost'; END IF;
 r:=public.list_dashboard_domani_feedback_with_conversations('{"limit":100,"sort_order":"asc"}',actor);
 IF (r->>'total')::int<>126 OR jsonb_array_length(r->'items')<>100 THEN RAISE EXCEPTION 'Global totals changed'; END IF;
 IF r#>>'{items,0,conversation,unread_count}'<>'1' OR r#>>'{items,1,conversation,message_count}'<>'0' THEN RAISE EXCEPTION 'Page summaries'; END IF;
 r:=public.list_dashboard_domani_feedback_with_conversations('{"limit":100,"offset":100}',actor);
 IF jsonb_array_length(r->'items')<>26 THEN RAISE EXCEPTION 'Second page'; END IF;
 UPDATE public.domani_feedback_messages SET delivery_status='accepted',provider_message_id='synthetic-provider-id' WHERE id=mid;
 IF (SELECT count(*) FROM public.domani_feedback_message_audit WHERE message_id=mid AND action='delivery_changed')<>1 THEN RAISE EXCEPTION 'Delivery audit missing'; END IF;
 -- Missing and invalid recipients cannot leave a conversation/outbox behind.
 UPDATE public.beta_feedback SET email='' WHERE id='00000000-0000-4000-8000-000000000002';
 BEGIN
  PERFORM public.queue_domani_feedback_reply('beta_feedback','00000000-0000-4000-8000-000000000002',actor,'staff@example.test','Subject','Body',key);
  RAISE EXCEPTION 'Absent recipient accepted';
 EXCEPTION WHEN SQLSTATE 'DF422' THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.domani_feedback_conversations WHERE feedback_id='00000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'Failed enqueue left records'; END IF;
 IF public.list_domani_feedback_messages('beta_feedback','ffffffff-ffff-4fff-8fff-ffffffffffff',actor) IS NOT NULL THEN RAISE EXCEPTION 'Missing history'; END IF;
END $$;
RESET ROLE;
-- Parent deletion must remove all private child data, without touching the other source.
DELETE FROM public.beta_feedback WHERE id='00000000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.domani_feedback_messages)<>1 OR (SELECT count(*) FROM public.domani_feedback_outbox)<>1
 OR (SELECT count(*) FROM public.domani_feedback_message_audit)<>1 OR EXISTS(SELECT 1 FROM public.domani_feedback_read_cursors)
 THEN RAISE EXCEPTION 'Source deletion did not cascade'; END IF;
END $$;
DO $$ DECLARE t text; r text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['domani_feedback_conversations','domani_feedback_messages','domani_feedback_outbox','domani_feedback_read_cursors','domani_feedback_message_audit'] LOOP
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass) THEN RAISE EXCEPTION 'RLS disabled on %',t; END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Public table privilege: % %',r,t; END IF;
  END LOOP;
 END LOOP;
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%domani_feedback%' LOOP
  IF has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('authenticated',f.oid,'EXECUTE') THEN RAISE EXCEPTION 'Public RPC privilege'; END IF;
 END LOOP;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM * FROM public.domani_feedback_messages; RAISE EXCEPTION 'Client can read messages'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.list_domani_feedback_messages('beta_feedback','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'Client can call history'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
