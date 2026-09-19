-- Domani only. Receiving and sending stay disabled until explicitly configured.
BEGIN;
ALTER TABLE public.domani_feedback_messages ADD COLUMN attachment_count integer NOT NULL DEFAULT 0 CHECK(attachment_count BETWEEN 0 AND 1000);
CREATE UNIQUE INDEX domani_inbound_rfc_unique ON public.domani_feedback_messages(rfc_message_id) WHERE direction='inbound' AND rfc_message_id IS NOT NULL;
CREATE TABLE public.domani_feedback_reply_routes (
 message_id uuid PRIMARY KEY REFERENCES public.domani_feedback_messages(id) ON DELETE CASCADE,
 address text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.domani_feedback_inbound_receipts (
 provider_id text PRIMARY KEY CHECK(length(provider_id) BETWEEN 1 AND 250),
 event_id text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','complete','quarantined','failed')),
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, lease_expires_at timestamptz,
 reason text,
 payload jsonb,
 conversation_id uuid REFERENCES public.domani_feedback_conversations(id) ON DELETE CASCADE,
 message_id uuid REFERENCES public.domani_feedback_messages(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.domani_feedback_inbound_receipts(available_at) WHERE state IN ('pending','leased');
ALTER TABLE public.domani_feedback_reply_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domani_feedback_inbound_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.domani_feedback_reply_routes,public.domani_feedback_inbound_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.domani_feedback_reply_routes,public.domani_feedback_inbound_receipts TO service_role;

-- New overload: old callers/payloads retain hello mailbox routing.
CREATE FUNCTION public.submit_domani_feedback_reply(p_source text,p_id uuid,p_actor_id uuid,p_actor_email text,
 p_subject text,p_text text,p_request_key uuid,p_html text,p_reply_domain text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE intent jsonb; mid uuid; alias text;
BEGIN
 IF p_reply_domain IS NULL OR p_reply_domain !~ '^[a-z0-9-]+([.][a-z0-9-]+)+$' OR length(p_reply_domain)>180 THEN RAISE EXCEPTION 'Invalid receiving domain' USING ERRCODE='22023'; END IF;
 intent:=public.queue_domani_feedback_reply(p_source,p_id,p_actor_id,p_actor_email,p_subject,p_text,p_request_key);
 IF intent IS NULL THEN RETURN NULL; END IF;
 mid:=(intent->>'message_id')::uuid;
 PERFORM 1 FROM public.domani_feedback_outbox WHERE message_id=mid AND state='held' FOR UPDATE;
 IF FOUND THEN
  alias:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')||'@'||p_reply_domain;
  INSERT INTO public.domani_feedback_reply_routes(message_id,address) VALUES(mid,alias);
  UPDATE public.domani_feedback_outbox o SET state='pending',payload=jsonb_build_object(
   'from','Domani <hello@domani-app.com>','to',m.recipient_email,'reply_to',alias,
   'subject',m.subject,'text',m.body_text,'html',p_html,
   'tags',jsonb_build_array(jsonb_build_object('name','domani_feedback_message','value',mid::text)))
  FROM public.domani_feedback_messages m WHERE o.message_id=mid AND m.id=mid;
 END IF;
 RETURN public.domani_feedback_reply_state(p_source,p_id,p_request_key);
END $$;
CREATE FUNCTION public.receive_domani_feedback_inbound(p_event_id text,p_provider_id text) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 INSERT INTO public.domani_feedback_inbound_receipts(event_id,provider_id) VALUES(p_event_id,p_provider_id) ON CONFLICT DO NOTHING
$$;
CREATE FUNCTION public.claim_domani_feedback_inbound() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.domani_feedback_inbound_receipts; token uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO r FROM public.domani_feedback_inbound_receipts WHERE
 (state='pending' AND available_at<=now()) OR (state='leased' AND lease_expires_at<=now())
 ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF r.attempts>=8 THEN
  UPDATE public.domani_feedback_inbound_receipts SET state='failed',reason='INGESTION_RETRY_EXHAUSTED' WHERE provider_id=r.provider_id;
  RETURN jsonb_build_object('skipped',true);
 END IF;
 UPDATE public.domani_feedback_inbound_receipts SET state='leased',attempts=attempts+1,lease_token=token,lease_expires_at=clock_timestamp()+interval '2 minutes' WHERE provider_id=r.provider_id;
 RETURN jsonb_build_object('provider_id',r.provider_id,'lease_token',token);
END $$;
CREATE FUNCTION public.finish_domani_feedback_inbound(p_provider_id text,p_lease_token uuid,p_payload jsonb,p_error text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.domani_feedback_inbound_receipts; outbound public.domani_feedback_messages; candidates integer; alias text; mid uuid; outcome_reason text;
BEGIN
 SELECT * INTO r FROM public.domani_feedback_inbound_receipts WHERE provider_id=p_provider_id AND state='leased' AND lease_token=p_lease_token FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_error IS NOT NULL THEN
  UPDATE public.domani_feedback_inbound_receipts SET state='pending',reason='PROVIDER_RETRIEVAL_FAILED',lease_token=NULL,lease_expires_at=NULL,
   available_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,r.attempts-1)::int)) WHERE provider_id=p_provider_id;
  RETURN true;
 END IF;
 outcome_reason:=p_payload->>'quarantine_reason';
 SELECT count(DISTINCT rt.message_id) INTO candidates FROM public.domani_feedback_reply_routes rt
 WHERE rt.address IN (SELECT jsonb_array_elements_text(p_payload->'to'));
 IF candidates<>1 THEN outcome_reason:=coalesce(outcome_reason,'UNMATCHED_OR_AMBIGUOUS_ROUTE');
 ELSE
  SELECT m.* INTO outbound FROM public.domani_feedback_messages m JOIN public.domani_feedback_reply_routes rt ON rt.message_id=m.id
   WHERE rt.address IN (SELECT jsonb_array_elements_text(p_payload->'to')) LIMIT 1;
  SELECT rt.address INTO alias FROM public.domani_feedback_reply_routes rt WHERE rt.message_id=outbound.id;
  -- The opaque route is the capability. From alone never selects/authorizes a conversation.
  IF lower(outbound.recipient_email)<>p_payload->>'from' THEN outcome_reason:=coalesce(outcome_reason,'PARTICIPANT_MISMATCH'); END IF;
  IF p_payload->>'in_reply_to' IS NOT NULL AND outbound.rfc_message_id IS NOT NULL AND p_payload->>'in_reply_to'<>outbound.rfc_message_id
   AND NOT (p_payload->'references' ? outbound.rfc_message_id) THEN outcome_reason:=coalesce(outcome_reason,'THREAD_MISMATCH'); END IF;
 END IF;
 IF outcome_reason IS NULL THEN
  -- Unique RFC ids stop provider re-delivery under another provider id as well.
  INSERT INTO public.domani_feedback_messages(conversation_id,direction,subject,body_text,sender_email,recipient_email,
   provider_message_id,rfc_message_id,in_reply_to,reference_ids,delivery_status,created_at,attachment_count)
  VALUES(outbound.conversation_id,'inbound',p_payload->>'subject',p_payload->>'text',p_payload->>'from',alias,
   p_provider_id,p_payload->>'message_id',p_payload->>'in_reply_to',ARRAY(SELECT jsonb_array_elements_text(p_payload->'references')),
   'received',(p_payload->>'created_at')::timestamptz,(p_payload->>'attachment_count')::integer)
  ON CONFLICT DO NOTHING RETURNING id INTO mid;
  IF mid IS NULL THEN outcome_reason:='DUPLICATE_MESSAGE'; END IF;
 END IF;
 UPDATE public.domani_feedback_inbound_receipts SET state=CASE WHEN outcome_reason IS NULL THEN 'complete' ELSE 'quarantined' END,
  reason=outcome_reason,payload=CASE WHEN outcome_reason IS NULL THEN NULL ELSE p_payload END,
  -- Unique-route association controls private retention, not admission to history.
  conversation_id=outbound.conversation_id,message_id=mid,lease_token=NULL,lease_expires_at=NULL
 WHERE provider_id=p_provider_id;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.summarize_domani_feedback(p_items jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
WITH items AS MATERIALIZED (SELECT value AS item,ordinality FROM jsonb_array_elements(p_items) WITH ORDINALITY),
selected AS MATERIALIZED (
    SELECT i.*,c.id AS cid,r.last_read_sequence FROM items i
    LEFT JOIN public.domani_feedback_conversations c ON c.source=i.item->>'source' AND c.feedback_id=(i.item->>'id')::uuid
    LEFT JOIN public.domani_feedback_read_cursors r ON r.conversation_id=c.id AND r.actor_id=p_actor_id
), counts AS (
    SELECT s.cid,count(m.id) AS message_count,count(m.id) FILTER(WHERE m.direction='outbound') AS reply_count,
        count(m.id) FILTER(WHERE m.direction='inbound' AND m.sequence>coalesce(s.last_read_sequence,0)) AS unread_count
    FROM selected s LEFT JOIN public.domani_feedback_messages m ON m.conversation_id=s.cid GROUP BY s.cid
), latest AS (
    SELECT DISTINCT ON(m.conversation_id) m.conversation_id,m.created_at,m.delivery_status,m.direction,left(m.body_text,160) AS preview
    FROM public.domani_feedback_messages m JOIN selected s ON s.cid=m.conversation_id
    ORDER BY m.conversation_id,m.sequence DESC
)
SELECT coalesce(jsonb_agg(s.item || jsonb_build_object('conversation',jsonb_build_object(
    'id',s.cid,'message_count',coalesce(c.message_count,0),'reply_count',coalesce(c.reply_count,0),
    'unread_count',coalesce(c.unread_count,0),'last_message_at',l.created_at,'last_delivery_status',l.delivery_status,'last_message_preview',l.preview,'last_direction',l.direction,'last_incoming_at',(SELECT created_at FROM public.domani_feedback_messages WHERE conversation_id=s.cid AND direction='inbound' ORDER BY sequence DESC LIMIT 1),'last_incoming_preview',(SELECT left(body_text,160) FROM public.domani_feedback_messages WHERE conversation_id=s.cid AND direction='inbound' ORDER BY sequence DESC LIMIT 1)
)) ORDER BY s.ordinality),'[]'::jsonb)
FROM selected s LEFT JOIN counts c ON c.cid=s.cid LEFT JOIN latest l ON l.conversation_id=s.cid
$$;
CREATE OR REPLACE FUNCTION public.list_domani_feedback_messages(p_source text,p_id uuid,p_actor_id uuid,p_limit integer DEFAULT 50,p_after uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE cid uuid; after_sequence bigint:=0; result jsonb;
BEGIN
    IF p_actor_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'Invalid history request' USING ERRCODE='22023';
    END IF;
    PERFORM 1 FROM public.dashboard_domani_feedback WHERE source=p_source AND id=p_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT id INTO cid FROM public.domani_feedback_conversations WHERE source=p_source AND feedback_id=p_id;
    IF p_after IS NOT NULL THEN
        SELECT sequence INTO after_sequence FROM public.domani_feedback_messages WHERE conversation_id=cid AND id=p_after;
        IF NOT FOUND THEN RAISE EXCEPTION 'Invalid conversation cursor' USING ERRCODE='DF400'; END IF;
    END IF;
    WITH page AS MATERIALIZED (
        SELECT * FROM public.domani_feedback_messages WHERE conversation_id=cid AND sequence>after_sequence ORDER BY sequence LIMIT p_limit+1
    ), shown AS (SELECT * FROM page ORDER BY sequence LIMIT p_limit)
    SELECT jsonb_build_object('conversation_id',cid,'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id',id,'direction',direction,'subject',subject,'text',body_text,
        'author',jsonb_build_object('id',actor_id,'email',coalesce(actor_email,sender_email)),
        'sender_email',sender_email,'recipient_email',recipient_email,'created_at',created_at,'updated_at',updated_at,
        'delivery_status',delivery_status,'delivery_event_at',delivery_event_at,'request_key',request_key,'attachment_count',attachment_count,'unread',(direction='inbound' AND sequence>coalesce((SELECT last_read_sequence FROM public.domani_feedback_read_cursors WHERE conversation_id=cid AND actor_id=p_actor_id),0)),
        'can_retry',coalesce((public.domani_feedback_reply_state(p_source,p_id,request_key)->>'can_retry')::boolean,false),
        'needs_reconciliation',coalesce((public.domani_feedback_reply_state(p_source,p_id,request_key)->>'needs_reconciliation')::boolean,false)
    ) ORDER BY sequence) FROM shown),'[]'::jsonb),
    'next_cursor',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT id FROM shown ORDER BY sequence DESC LIMIT 1) END,
    'limit',p_limit) INTO result;
    RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.list_domani_feedback_messages_latest(p_source text,p_id uuid,p_actor_id uuid,p_limit integer DEFAULT 20,p_before uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE cid uuid; before_sequence bigint:=9223372036854775807; result jsonb;
BEGIN
 IF p_actor_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid history request' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.dashboard_domani_feedback WHERE source=p_source AND id=p_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT id INTO cid FROM public.domani_feedback_conversations WHERE source=p_source AND feedback_id=p_id;
 IF p_before IS NOT NULL THEN
  SELECT sequence INTO before_sequence FROM public.domani_feedback_messages WHERE conversation_id=cid AND id=p_before;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid cursor' USING ERRCODE='DF400'; END IF;
 END IF;
 WITH page AS MATERIALIZED (SELECT * FROM public.domani_feedback_messages WHERE conversation_id=cid AND sequence<before_sequence ORDER BY sequence DESC LIMIT p_limit+1),
 shown AS (SELECT * FROM page ORDER BY sequence DESC LIMIT p_limit)
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'id',id,'direction',direction,'subject',subject,'text',body_text,'sender_email',sender_email,'recipient_email',recipient_email,
  'author',jsonb_build_object('id',actor_id,'email',coalesce(actor_email,sender_email)),
  'created_at',created_at,'delivery_status',delivery_status,'delivery_event_at',delivery_event_at,'request_key',request_key,'attachment_count',attachment_count,'unread',(direction='inbound' AND sequence>coalesce((SELECT last_read_sequence FROM public.domani_feedback_read_cursors WHERE conversation_id=cid AND actor_id=p_actor_id),0)),
  'can_retry',coalesce((public.domani_feedback_reply_state(p_source,p_id,request_key)->>'can_retry')::boolean,false),
  'needs_reconciliation',coalesce((public.domani_feedback_reply_state(p_source,p_id,request_key)->>'needs_reconciliation')::boolean,false)
 ) ORDER BY sequence) FROM shown),'[]'::jsonb),
 'previous_cursor',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT id FROM shown ORDER BY sequence LIMIT 1) END,
 'next_cursor',NULL) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.submit_domani_feedback_reply(text,uuid,uuid,text,text,text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_domani_feedback_reply(text,uuid,uuid,text,text,text,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.receive_domani_feedback_inbound(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.receive_domani_feedback_inbound(text,text) TO service_role;
REVOKE ALL ON FUNCTION public.claim_domani_feedback_inbound() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_domani_feedback_inbound() TO service_role;
REVOKE ALL ON FUNCTION public.finish_domani_feedback_inbound(text,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_domani_feedback_inbound(text,uuid,jsonb,text) TO service_role;
CREATE FUNCTION public.record_domani_feedback_rfc_id(p_provider_id text,p_rfc_id text) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 UPDATE public.domani_feedback_messages SET rfc_message_id=p_rfc_id
 WHERE provider_message_id=p_provider_id AND direction='outbound' AND rfc_message_id IS NULL
$$;
REVOKE ALL ON FUNCTION public.record_domani_feedback_rfc_id(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_domani_feedback_rfc_id(text,text) TO service_role;
COMMIT;
