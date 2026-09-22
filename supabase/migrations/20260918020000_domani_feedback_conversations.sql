-- Domani project only. Requires the feedback dashboard foundation migration.
BEGIN;
CREATE TABLE public.domani_feedback_conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    beta_feedback_id uuid UNIQUE REFERENCES public.beta_feedback(id) ON DELETE CASCADE,
    support_request_id uuid UNIQUE REFERENCES public.support_requests(id) ON DELETE CASCADE,
    source text GENERATED ALWAYS AS (CASE WHEN beta_feedback_id IS NOT NULL THEN 'beta_feedback' ELSE 'support_request' END) STORED,
    feedback_id uuid GENERATED ALWAYS AS (coalesce(beta_feedback_id,support_request_id)) STORED,
    last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence BETWEEN 0 AND 9007199254740991),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(beta_feedback_id,support_request_id)=1),
    UNIQUE (source,feedback_id)
);
CREATE TABLE public.domani_feedback_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES public.domani_feedback_conversations(id) ON DELETE CASCADE,
    sequence bigint NOT NULL,
    direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
    subject text NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 200 AND subject !~ '[\r\n]'),
    body_text text NOT NULL CHECK (length(trim(body_text)) BETWEEN 1 AND 20000),
    sender_email text NOT NULL CHECK (length(trim(sender_email)) BETWEEN 3 AND 320 AND sender_email !~ '[\r\n]'),
    recipient_email text NOT NULL CHECK (length(trim(recipient_email)) BETWEEN 3 AND 320 AND recipient_email !~ '[\r\n]'),
    actor_id uuid,
    actor_email text,
    request_key uuid,
    provider_message_id text UNIQUE,
    rfc_message_id text,
    in_reply_to text,
    reference_ids text[] NOT NULL DEFAULT '{}',
    delivery_status text NOT NULL CHECK (delivery_status IN ('received','queued','sending','accepted','delivered','failed','bounced','complained','unknown')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((direction='outbound' AND actor_id IS NOT NULL AND nullif(trim(actor_email),'') IS NOT NULL AND request_key IS NOT NULL AND delivery_status<>'received')
        OR (direction='inbound' AND actor_id IS NULL AND actor_email IS NULL AND request_key IS NULL AND delivery_status='received')),
    UNIQUE (conversation_id,sequence),
    UNIQUE (conversation_id,request_key)
);
CREATE TABLE public.domani_feedback_outbox (
    message_id uuid PRIMARY KEY REFERENCES public.domani_feedback_messages(id) ON DELETE CASCADE,
    -- Persistence only: no dispatcher in DEV-1393. DEV-1394 owns activation and leases.
    state text NOT NULL DEFAULT 'held' CHECK (state IN ('held','pending','leased','complete','failed','uncertain')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_token uuid,
    lease_expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((state='leased') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX ON public.domani_feedback_outbox(available_at,message_id) WHERE state='pending';
CREATE TABLE public.domani_feedback_read_cursors (
    conversation_id uuid NOT NULL REFERENCES public.domani_feedback_conversations(id) ON DELETE CASCADE,
    actor_id uuid NOT NULL,
    last_read_sequence bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id,actor_id),
    FOREIGN KEY (conversation_id,last_read_sequence) REFERENCES public.domani_feedback_messages(conversation_id,sequence) ON DELETE CASCADE
);
CREATE INDEX ON public.domani_feedback_read_cursors(conversation_id,last_read_sequence);
CREATE TABLE public.domani_feedback_message_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id uuid NOT NULL REFERENCES public.domani_feedback_messages(id) ON DELETE CASCADE,
    action text NOT NULL CHECK (action IN ('created','delivery_changed')),
    actor_id uuid,
    old_status text,
    new_status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.domani_feedback_message_audit(message_id,created_at);

-- Serializing inserts on the conversation gives commit-safe ordering, even if callers
-- supply old mail timestamps. Read cursors therefore cannot hide a late-arriving message.
CREATE FUNCTION public.prepare_domani_feedback_message() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        UPDATE public.domani_feedback_conversations SET last_sequence=last_sequence+1
        WHERE id=NEW.conversation_id RETURNING last_sequence INTO NEW.sequence;
        IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE='23503'; END IF;
    ELSE
        IF ROW(NEW.id,NEW.conversation_id,NEW.sequence,NEW.direction,NEW.subject,NEW.body_text,
            NEW.sender_email,NEW.recipient_email,NEW.actor_id,NEW.actor_email,NEW.request_key,NEW.created_at)
          IS DISTINCT FROM ROW(OLD.id,OLD.conversation_id,OLD.sequence,OLD.direction,OLD.subject,OLD.body_text,
            OLD.sender_email,OLD.recipient_email,OLD.actor_id,OLD.actor_email,OLD.request_key,OLD.created_at) THEN
            RAISE EXCEPTION 'Authored message is immutable' USING ERRCODE='22023';
        END IF;
        NEW.updated_at := clock_timestamp();
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER prepare_message BEFORE INSERT OR UPDATE ON public.domani_feedback_messages
FOR EACH ROW EXECUTE FUNCTION public.prepare_domani_feedback_message();
CREATE FUNCTION public.audit_domani_feedback_message() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        INSERT INTO public.domani_feedback_message_audit(message_id,action,actor_id,new_status)
        VALUES(NEW.id,'created',NEW.actor_id,NEW.delivery_status);
        IF NEW.direction='outbound' THEN
            INSERT INTO public.domani_feedback_outbox(message_id) VALUES(NEW.id);
        END IF;
    ELSIF NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
        INSERT INTO public.domani_feedback_message_audit(message_id,action,old_status,new_status)
        VALUES(NEW.id,'delivery_changed',OLD.delivery_status,NEW.delivery_status);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER audit_message AFTER INSERT OR UPDATE ON public.domani_feedback_messages
FOR EACH ROW EXECUTE FUNCTION public.audit_domani_feedback_message();

-- Internal service-only persistence primitive, intentionally not exposed over HTTP yet.
-- Each immutable outbound message and its held outbox record commit atomically.
CREATE FUNCTION public.queue_domani_feedback_reply(p_source text,p_id uuid,p_actor_id uuid,p_actor_email text,
    p_subject text,p_text text,p_request_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE recipient text; cid uuid; existing public.domani_feedback_messages; result public.domani_feedback_messages;
BEGIN
    IF p_source IS NULL OR p_source NOT IN ('beta_feedback','support_request') OR p_id IS NULL OR p_actor_id IS NULL
      OR nullif(trim(p_actor_email),'') IS NULL OR p_request_key IS NULL OR p_subject IS NULL OR p_text IS NULL
      OR length(trim(p_subject)) NOT BETWEEN 1 AND 200 OR p_subject ~ '[\r\n]'
      OR length(trim(p_text)) NOT BETWEEN 1 AND 20000 THEN
        RAISE EXCEPTION 'Invalid reply' USING ERRCODE='22023';
    END IF;
    IF p_source='beta_feedback' THEN
        SELECT email INTO recipient FROM public.beta_feedback WHERE id=p_id FOR KEY SHARE;
    ELSE
        SELECT email INTO recipient FROM public.support_requests WHERE id=p_id FOR KEY SHARE;
    END IF;
    IF NOT FOUND THEN RETURN NULL; END IF;
    INSERT INTO public.domani_feedback_conversations(beta_feedback_id,support_request_id)
    VALUES(CASE WHEN p_source='beta_feedback' THEN p_id END,CASE WHEN p_source='support_request' THEN p_id END)
    -- Cover both the source FK uniqueness and generated composite identity.
    ON CONFLICT DO NOTHING;
    SELECT id INTO cid FROM public.domani_feedback_conversations WHERE source=p_source AND feedback_id=p_id FOR UPDATE;
    SELECT * INTO existing FROM public.domani_feedback_messages WHERE conversation_id=cid AND request_key=p_request_key;
    IF FOUND THEN
        IF ROW(existing.subject,existing.body_text,existing.actor_id) IS DISTINCT FROM ROW(p_subject,p_text,p_actor_id) THEN
            RAISE EXCEPTION 'Request key already used' USING ERRCODE='DF409';
        END IF;
        RETURN jsonb_build_object('message_id',existing.id,'conversation_id',cid,'replayed',true);
    END IF;
    IF recipient IS NULL OR length(recipient)>320 OR recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
        RAISE EXCEPTION 'Recipient unavailable' USING ERRCODE='DF422';
    END IF;
    INSERT INTO public.domani_feedback_messages(conversation_id,direction,subject,body_text,sender_email,recipient_email,
        actor_id,actor_email,request_key,delivery_status)
    VALUES(cid,'outbound',p_subject,p_text,'hello@domani-app.com',recipient,p_actor_id,p_actor_email,p_request_key,'queued')
    RETURNING * INTO result;
    RETURN jsonb_build_object('message_id',result.id,'conversation_id',cid,'replayed',false);
END $$;

-- Add summaries for just the returned page in one set operation, preserving page order
-- and the foundation function's globally filtered counts and snapshot.
CREATE FUNCTION public.summarize_domani_feedback(p_items jsonb,p_actor_id uuid) RETURNS jsonb
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
    SELECT DISTINCT ON(m.conversation_id) m.conversation_id,m.created_at,m.delivery_status
    FROM public.domani_feedback_messages m JOIN selected s ON s.cid=m.conversation_id
    ORDER BY m.conversation_id,m.sequence DESC
)
SELECT coalesce(jsonb_agg(s.item || jsonb_build_object('conversation',jsonb_build_object(
    'id',s.cid,'message_count',coalesce(c.message_count,0),'reply_count',coalesce(c.reply_count,0),
    'unread_count',coalesce(c.unread_count,0),'last_message_at',l.created_at,'last_delivery_status',l.delivery_status
)) ORDER BY s.ordinality),'[]'::jsonb)
FROM selected s LEFT JOIN counts c ON c.cid=s.cid LEFT JOIN latest l ON l.conversation_id=s.cid
$$;
CREATE FUNCTION public.list_dashboard_domani_feedback_with_conversations(p_query jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
WITH result AS MATERIALIZED (SELECT public.list_dashboard_domani_feedback(p_query) AS value)
SELECT value || jsonb_build_object('items',public.summarize_domani_feedback(value->'items',p_actor_id)) FROM result
$$;
CREATE FUNCTION public.get_dashboard_domani_feedback(p_source text,p_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
SELECT public.summarize_domani_feedback(jsonb_build_array(to_jsonb(f)),p_actor_id)->0
FROM public.dashboard_domani_feedback f WHERE f.source=p_source AND f.id=p_id
$$;
CREATE FUNCTION public.list_domani_feedback_messages(p_source text,p_id uuid,p_actor_id uuid,p_limit integer DEFAULT 50,p_after uuid DEFAULT NULL)
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
        'delivery_status',delivery_status,'can_retry',false
    ) ORDER BY sequence) FROM shown),'[]'::jsonb),
    'next_cursor',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN (SELECT id FROM shown ORDER BY sequence DESC LIMIT 1) END,
    'limit',p_limit) INTO result;
    RETURN result;
END $$;
CREATE FUNCTION public.mark_domani_feedback_read(p_source text,p_id uuid,p_actor_id uuid,p_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE cid uuid; seq bigint; actual bigint; mid uuid;
BEGIN
    IF p_actor_id IS NULL OR p_message_id IS NULL THEN RAISE EXCEPTION 'Invalid read cursor' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.dashboard_domani_feedback WHERE source=p_source AND id=p_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT id INTO cid FROM public.domani_feedback_conversations WHERE source=p_source AND feedback_id=p_id FOR KEY SHARE;
    SELECT sequence INTO seq FROM public.domani_feedback_messages WHERE conversation_id=cid AND id=p_message_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid conversation cursor' USING ERRCODE='DF400'; END IF;
    INSERT INTO public.domani_feedback_read_cursors(conversation_id,actor_id,last_read_sequence)
    VALUES(cid,p_actor_id,seq) ON CONFLICT(conversation_id,actor_id) DO UPDATE
    SET last_read_sequence=greatest(public.domani_feedback_read_cursors.last_read_sequence,excluded.last_read_sequence),updated_at=clock_timestamp()
    RETURNING last_read_sequence INTO actual;
    SELECT id INTO mid FROM public.domani_feedback_messages WHERE conversation_id=cid AND sequence=actual;
    RETURN jsonb_build_object('conversation_id',cid,'last_read_message_id',mid);
END $$;

-- No client policies: staff authorization happens on the server before service RPCs.
ALTER TABLE public.domani_feedback_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domani_feedback_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domani_feedback_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domani_feedback_read_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domani_feedback_message_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.domani_feedback_conversations,public.domani_feedback_messages,public.domani_feedback_outbox,
    public.domani_feedback_read_cursors,public.domani_feedback_message_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.domani_feedback_conversations,public.domani_feedback_messages,
    public.domani_feedback_outbox,public.domani_feedback_read_cursors TO service_role;
GRANT SELECT,INSERT ON public.domani_feedback_message_audit TO service_role;
REVOKE ALL ON FUNCTION public.prepare_domani_feedback_message(),public.audit_domani_feedback_message(),
    public.queue_domani_feedback_reply(text,uuid,uuid,text,text,text,uuid),public.summarize_domani_feedback(jsonb,uuid),
    public.list_dashboard_domani_feedback_with_conversations(jsonb,uuid),public.get_dashboard_domani_feedback(text,uuid,uuid),
    public.list_domani_feedback_messages(text,uuid,uuid,integer,uuid),public.mark_domani_feedback_read(text,uuid,uuid,uuid)
    FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_domani_feedback_message(),public.audit_domani_feedback_message(),
    public.queue_domani_feedback_reply(text,uuid,uuid,text,text,text,uuid),public.summarize_domani_feedback(jsonb,uuid),
    public.list_dashboard_domani_feedback_with_conversations(jsonb,uuid),public.get_dashboard_domani_feedback(text,uuid,uuid),
    public.list_domani_feedback_messages(text,uuid,uuid,integer,uuid),public.mark_domani_feedback_read(text,uuid,uuid,uuid)
    TO service_role;
COMMIT;
