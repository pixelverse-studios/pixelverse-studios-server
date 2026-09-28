-- Domani only. Apply after conversation persistence. No sending is enabled by SQL.
BEGIN;
ALTER TABLE public.domani_feedback_outbox ADD COLUMN payload jsonb,
 ADD COLUMN first_attempt_at timestamptz, ADD COLUMN last_error_code text,
 ADD COLUMN retryable boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.domani_feedback_reply_state(p_source text,p_id uuid,p_key uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
SELECT jsonb_build_object('message_id',m.id,'request_key',m.request_key,'subject',m.subject,'text',m.body_text,
 'delivery_status',CASE WHEN o.state='leased' AND o.lease_expires_at<now() THEN 'unknown' ELSE m.delivery_status END,
 'can_retry',o.state IN ('failed','uncertain') AND o.retryable AND o.attempts<8
   AND o.first_attempt_at>now()-interval '23 hours',
 'needs_reconciliation',o.state='uncertain' OR (o.state='leased' AND o.lease_expires_at<now()),
 'error_code',o.last_error_code)
FROM public.domani_feedback_conversations c JOIN public.domani_feedback_messages m ON m.conversation_id=c.id
JOIN public.domani_feedback_outbox o ON o.message_id=m.id
WHERE c.source=p_source AND c.feedback_id=p_id AND m.request_key=p_key
$$;
CREATE FUNCTION public.submit_domani_feedback_reply(p_source text,p_id uuid,p_actor_id uuid,p_actor_email text,
 p_subject text,p_text text,p_request_key uuid,p_html text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE intent jsonb; mid uuid;
BEGIN
 intent:=public.queue_domani_feedback_reply(p_source,p_id,p_actor_id,p_actor_email,p_subject,p_text,p_request_key);
 IF intent IS NULL THEN RETURN NULL; END IF;
 mid:=(intent->>'message_id')::uuid;
 -- Store the exact provider payload once: deployments and retries cannot change it.
 UPDATE public.domani_feedback_outbox o SET state='pending',payload=jsonb_build_object(
   'from','Domani <hello@domani-app.com>','to',m.recipient_email,'reply_to','hello@domani-app.com',
   'subject',m.subject,'text',m.body_text,'html',p_html)
 FROM public.domani_feedback_messages m WHERE o.message_id=mid AND m.id=mid AND o.state='held';
 RETURN public.domani_feedback_reply_state(p_source,p_id,p_request_key);
END $$;
CREATE FUNCTION public.retry_domani_feedback_reply(p_source text,p_id uuid,p_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE mid uuid;
BEGIN
 SELECT m.id INTO mid FROM public.domani_feedback_conversations c JOIN public.domani_feedback_messages m ON m.conversation_id=c.id
 WHERE c.source=p_source AND c.feedback_id=p_id AND m.request_key=p_key;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.domani_feedback_outbox SET state='pending',available_at=now(),lease_token=NULL,lease_expires_at=NULL
 WHERE message_id=mid AND state IN ('failed','uncertain') AND retryable AND attempts<8 AND first_attempt_at>now()-interval '23 hours';
 IF NOT FOUND THEN RAISE EXCEPTION 'Reply is not retryable' USING ERRCODE='DF409'; END IF;
 -- Unknown remains unknown until provider evidence resolves it.
 UPDATE public.domani_feedback_messages SET delivery_status='queued' WHERE id=mid AND delivery_status='failed';
 RETURN public.domani_feedback_reply_state(p_source,p_id,p_key);
END $$;
CREATE FUNCTION public.claim_domani_feedback_reply() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE job public.domani_feedback_outbox; tok uuid:=gen_random_uuid();
BEGIN
 -- Reclaim one job at a time to avoid waiting leases for an entire batch.
 SELECT * INTO job FROM public.domani_feedback_outbox
 WHERE (state='pending' AND available_at<=now()) OR (state='leased' AND lease_expires_at<=now())
 ORDER BY available_at,message_id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF job.first_attempt_at<=now()-interval '23 hours' OR job.attempts>=8 THEN
  UPDATE public.domani_feedback_outbox SET state='uncertain',retryable=false,last_error_code='RECONCILIATION_REQUIRED',lease_token=NULL,lease_expires_at=NULL WHERE message_id=job.message_id;
  UPDATE public.domani_feedback_messages SET delivery_status='unknown' WHERE id=job.message_id;
  RETURN jsonb_build_object('skipped',true);
 END IF;
 UPDATE public.domani_feedback_outbox SET state='leased',attempts=attempts+1,
  first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),lease_token=tok,lease_expires_at=clock_timestamp()+interval '2 minutes'
 WHERE message_id=job.message_id;
 UPDATE public.domani_feedback_messages SET delivery_status=CASE WHEN job.state='leased' OR delivery_status='unknown' THEN 'unknown' ELSE 'sending' END WHERE id=job.message_id;
 RETURN jsonb_build_object('message_id',job.message_id,'lease_token',tok,'payload',job.payload,
  'idempotency_key','domani-feedback/'||job.message_id::text,
  'send_before',least(coalesce(job.first_attempt_at,clock_timestamp())+interval '23 hours',clock_timestamp()+interval '90 seconds'));
END $$;
CREATE FUNCTION public.finish_domani_feedback_reply(p_message_id uuid,p_lease_token uuid,p_outcome text,p_provider_id text DEFAULT NULL,p_error_code text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE job public.domani_feedback_outbox; uncertain boolean; next_state text;
BEGIN
 IF p_outcome NOT IN ('accepted','retryable','permanent','unknown') OR p_outcome IS NULL
 OR (p_outcome='accepted' AND nullif(p_provider_id,'') IS NULL) THEN RAISE EXCEPTION 'Invalid outcome' USING ERRCODE='22023'; END IF;
 SELECT * INTO job FROM public.domani_feedback_outbox WHERE message_id=p_message_id AND state='leased' AND lease_token=p_lease_token FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT delivery_status='unknown' INTO uncertain FROM public.domani_feedback_messages WHERE id=p_message_id;
 uncertain:=uncertain OR p_outcome='unknown';
 next_state:=CASE WHEN p_outcome='accepted' THEN 'complete'
 WHEN p_outcome IN ('retryable','unknown') AND job.attempts<5 AND job.first_attempt_at>now()-interval '23 hours' THEN 'pending'
 WHEN uncertain THEN 'uncertain' ELSE 'failed' END;
 UPDATE public.domani_feedback_outbox SET state=next_state,lease_token=NULL,lease_expires_at=NULL,
  available_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,job.attempts-1)::int)),
  retryable=p_outcome IN ('retryable','unknown'),last_error_code=CASE WHEN p_outcome='accepted' THEN NULL ELSE p_error_code END
 WHERE message_id=p_message_id;
 UPDATE public.domani_feedback_messages SET delivery_status=CASE WHEN p_outcome='accepted' THEN 'accepted'
  WHEN uncertain THEN 'unknown' WHEN next_state='pending' THEN 'queued' ELSE 'failed' END,
  provider_message_id=CASE WHEN p_outcome='accepted' THEN p_provider_id ELSE provider_message_id END
 WHERE id=p_message_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.domani_feedback_reply_state(text,uuid,uuid),
 public.submit_domani_feedback_reply(text,uuid,uuid,text,text,text,uuid,text),public.retry_domani_feedback_reply(text,uuid,uuid),
 public.claim_domani_feedback_reply(),public.finish_domani_feedback_reply(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.domani_feedback_reply_state(text,uuid,uuid),
 public.submit_domani_feedback_reply(text,uuid,uuid,text,text,text,uuid,text),public.retry_domani_feedback_reply(text,uuid,uuid),
 public.claim_domani_feedback_reply(),public.finish_domani_feedback_reply(uuid,uuid,text,text,text) TO service_role;
COMMIT;
