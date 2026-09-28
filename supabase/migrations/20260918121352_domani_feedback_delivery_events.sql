-- Domani only. Additive event ledger; no provider configuration or sending is enabled.
BEGIN;
ALTER TABLE public.domani_feedback_messages DROP CONSTRAINT domani_feedback_messages_delivery_status_check;
ALTER TABLE public.domani_feedback_messages ADD CONSTRAINT domani_feedback_messages_delivery_status_check
 CHECK(delivery_status IN ('received','queued','sending','accepted','delivered','delayed','failed','bounced','complained','unknown'));
ALTER TABLE public.domani_feedback_messages ADD COLUMN delivery_event_at timestamptz, ADD COLUMN delivery_checked_at timestamptz;
CREATE TABLE public.domani_feedback_delivery_events (
 event_id text PRIMARY KEY CHECK(length(event_id) BETWEEN 1 AND 250),
 provider_id text NOT NULL CHECK(length(provider_id) BETWEEN 1 AND 250),
 event_type text NOT NULL CHECK(length(event_type) BETWEEN 1 AND 100),
 occurred_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 tagged_message_id uuid,
 message_id uuid REFERENCES public.domani_feedback_messages(id) ON DELETE SET NULL,
 state text NOT NULL DEFAULT 'unmatched' CHECK(state IN ('unmatched','applied','ignored'))
);
CREATE INDEX ON public.domani_feedback_delivery_events(provider_id) WHERE state='unmatched';
CREATE INDEX ON public.domani_feedback_delivery_events(tagged_message_id) WHERE state='unmatched';
CREATE INDEX ON public.domani_feedback_delivery_events(received_at) WHERE state='unmatched';
ALTER TABLE public.domani_feedback_delivery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.domani_feedback_delivery_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.domani_feedback_delivery_events TO service_role;

CREATE FUNCTION public.domani_delivery_rank(p_status text) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE p_status WHEN 'accepted' THEN 1 WHEN 'delayed' THEN 2 WHEN 'delivered' THEN 3
 WHEN 'failed' THEN 4 WHEN 'bounced' THEN 5 WHEN 'complained' THEN 6 ELSE 0 END
$$;
CREATE FUNCTION public.apply_domani_feedback_delivery(p_event_id text) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE e public.domani_feedback_delivery_events; m public.domani_feedback_messages; mid uuid; target text;
BEGIN
 SELECT * INTO e FROM public.domani_feedback_delivery_events WHERE event_id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 'missing'; END IF;
 IF e.state<>'unmatched' THEN RETURN e.state; END IF;
 target:=CASE e.event_type WHEN 'email.sent' THEN 'accepted' WHEN 'email.delivered' THEN 'delivered'
 WHEN 'email.delivery_delayed' THEN 'delayed' WHEN 'email.bounced' THEN 'bounced'
 WHEN 'email.complained' THEN 'complained' WHEN 'email.failed' THEN 'failed' WHEN 'email.suppressed' THEN 'failed' END;
 IF target IS NULL THEN
  UPDATE public.domani_feedback_delivery_events SET state='ignored' WHERE event_id=p_event_id;
  RETURN 'ignored';
 END IF;
 SELECT id INTO mid FROM public.domani_feedback_messages WHERE provider_message_id=e.provider_id AND direction='outbound';
 IF mid IS NULL AND e.tagged_message_id IS NOT NULL THEN
  -- A signed tag must match the exact immutable payload our dispatcher stored.
  SELECT m0.id INTO mid FROM public.domani_feedback_messages m0 JOIN public.domani_feedback_outbox o ON o.message_id=m0.id
  WHERE m0.id=e.tagged_message_id AND m0.direction='outbound' AND m0.provider_message_id IS NULL
   AND o.payload->'tags' @> jsonb_build_array(jsonb_build_object('name','domani_feedback_message','value',m0.id::text));
 END IF;
 IF mid IS NULL THEN RETURN 'unmatched'; END IF;
 -- Match dispatcher lock order, and invalidate any still-running send completion.
 PERFORM 1 FROM public.domani_feedback_outbox WHERE message_id=mid FOR UPDATE;
 SELECT * INTO m FROM public.domani_feedback_messages WHERE id=mid FOR UPDATE;
 IF m.provider_message_id IS NOT NULL AND m.provider_message_id<>e.provider_id THEN RETURN 'unmatched'; END IF;
 UPDATE public.domani_feedback_outbox SET state='complete',retryable=false,lease_token=NULL,lease_expires_at=NULL,
 last_error_code=CASE WHEN target IN ('failed','bounced','complained') THEN upper(target) ELSE NULL END WHERE message_id=mid;
 IF m.delivery_event_at IS NULL OR public.domani_delivery_rank(target)>public.domani_delivery_rank(m.delivery_status)
 OR (target=m.delivery_status AND e.occurred_at>m.delivery_event_at) THEN
  UPDATE public.domani_feedback_messages SET provider_message_id=e.provider_id,delivery_status=target,
   delivery_event_at=e.occurred_at WHERE id=mid;
 END IF;
 UPDATE public.domani_feedback_delivery_events SET state='applied',message_id=mid WHERE event_id=p_event_id;
 RETURN 'applied';
END $$;
CREATE FUNCTION public.receive_domani_feedback_delivery(p_event_id text,p_provider_id text,p_event_type text,p_occurred_at timestamptz,p_tagged_message_id uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 INSERT INTO public.domani_feedback_delivery_events(event_id,provider_id,event_type,occurred_at,tagged_message_id)
 VALUES(p_event_id,p_provider_id,p_event_type,p_occurred_at,p_tagged_message_id) ON CONFLICT(event_id) DO NOTHING;
 RETURN public.apply_domani_feedback_delivery(p_event_id);
END $$;
CREATE FUNCTION public.replay_domani_feedback_delivery() RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE e record; total integer:=0;
BEGIN
 FOR e IN SELECT d.event_id FROM public.domani_feedback_delivery_events d
 WHERE d.state='unmatched' AND EXISTS(SELECT 1 FROM public.domani_feedback_messages m
 WHERE m.provider_message_id=d.provider_id OR (m.id=d.tagged_message_id AND m.provider_message_id IS NULL
 AND EXISTS(SELECT 1 FROM public.domani_feedback_outbox o WHERE o.message_id=m.id
 AND o.payload->'tags' @> jsonb_build_array(jsonb_build_object('name','domani_feedback_message','value',m.id::text)))))
 ORDER BY d.received_at LIMIT 25 FOR UPDATE SKIP LOCKED LOOP
  PERFORM public.apply_domani_feedback_delivery(e.event_id); total:=total+1;
 END LOOP;
 RETURN total;
END $$;
CREATE FUNCTION public.claim_domani_feedback_delivery_check(p_source text,p_id uuid,p_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m public.domani_feedback_messages;
BEGIN
 UPDATE public.domani_feedback_messages m0 SET delivery_checked_at=clock_timestamp()
 FROM public.domani_feedback_conversations c WHERE c.id=m0.conversation_id AND c.source=p_source AND c.feedback_id=p_id
 AND m0.request_key=p_key AND m0.provider_message_id IS NOT NULL
 AND (m0.delivery_checked_at IS NULL OR m0.delivery_checked_at<clock_timestamp()-interval '30 seconds')
 RETURNING m0.* INTO m;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('provider_id',m.provider_message_id,'message_id',m.id);
END $$;
CREATE OR REPLACE FUNCTION public.submit_domani_feedback_reply(p_source text,p_id uuid,p_actor_id uuid,p_actor_email text,
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
   'subject',m.subject,'text',m.body_text,'html',p_html,
   'tags',jsonb_build_array(jsonb_build_object('name','domani_feedback_message','value',mid::text)))
 FROM public.domani_feedback_messages m WHERE o.message_id=mid AND m.id=mid AND o.state='held';
 RETURN public.domani_feedback_reply_state(p_source,p_id,p_request_key);
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
    SELECT DISTINCT ON(m.conversation_id) m.conversation_id,m.created_at,m.delivery_status,left(m.body_text,160) AS preview
    FROM public.domani_feedback_messages m JOIN selected s ON s.cid=m.conversation_id
    ORDER BY m.conversation_id,m.sequence DESC
)
SELECT coalesce(jsonb_agg(s.item || jsonb_build_object('conversation',jsonb_build_object(
    'id',s.cid,'message_count',coalesce(c.message_count,0),'reply_count',coalesce(c.reply_count,0),
    'unread_count',coalesce(c.unread_count,0),'last_message_at',l.created_at,'last_delivery_status',l.delivery_status,'last_message_preview',l.preview
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
        'delivery_status',delivery_status,'delivery_event_at',delivery_event_at,'request_key',request_key,
        'can_retry',coalesce((public.domani_feedback_reply_state(p_source,p_id,request_key)->>'can_retry')::boolean,false),
        'needs_reconciliation',coalesce((public.domani_feedback_reply_state(p_source,p_id,request_key)->>'needs_reconciliation')::boolean,false)
    ) ORDER BY sequence) FROM shown),'[]'::jsonb),
    'next_cursor',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT id FROM shown ORDER BY sequence DESC LIMIT 1) END,
    'limit',p_limit) INTO result;
    RETURN result;
END $$;

CREATE FUNCTION public.list_domani_feedback_messages_latest(p_source text,p_id uuid,p_actor_id uuid,p_limit integer DEFAULT 20,p_before uuid DEFAULT NULL)
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
  'created_at',created_at,'delivery_status',delivery_status,'delivery_event_at',delivery_event_at,'request_key',request_key,
  'can_retry',coalesce((public.domani_feedback_reply_state(p_source,p_id,request_key)->>'can_retry')::boolean,false),
  'needs_reconciliation',coalesce((public.domani_feedback_reply_state(p_source,p_id,request_key)->>'needs_reconciliation')::boolean,false)
 ) ORDER BY sequence) FROM shown),'[]'::jsonb),
 'previous_cursor',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT id FROM shown ORDER BY sequence LIMIT 1) END,
 'next_cursor',NULL) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.domani_delivery_rank(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.domani_delivery_rank(text) TO service_role;
REVOKE ALL ON FUNCTION public.apply_domani_feedback_delivery(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_domani_feedback_delivery(text) TO service_role;
REVOKE ALL ON FUNCTION public.receive_domani_feedback_delivery(text,text,text,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.receive_domani_feedback_delivery(text,text,text,timestamptz,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.replay_domani_feedback_delivery() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replay_domani_feedback_delivery() TO service_role;
REVOKE ALL ON FUNCTION public.claim_domani_feedback_delivery_check(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_domani_feedback_delivery_check(text,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.list_domani_feedback_messages_latest(text,uuid,uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_domani_feedback_messages_latest(text,uuid,uuid,integer,uuid) TO service_role;
COMMIT;
