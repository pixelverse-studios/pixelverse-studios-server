-- Keep the PostgREST RPC in the exposed public schema while isolating the
-- privileged auth schema lookup in a non-exposed helper.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private
FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.verify_pvs_dashboard_actor()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    actor_id uuid := auth.uid();
    session_id uuid;
    actor_email text;
BEGIN
    IF actor_id IS NULL
       OR coalesce(auth.jwt()->>'role', '') <> 'authenticated' THEN
        RETURN NULL;
    END IF;

    BEGIN
        session_id := nullif(auth.jwt()->>'session_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RETURN NULL;
    END;

    IF session_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT u.email
    INTO actor_email
    FROM auth.users AS u
    JOIN auth.sessions AS s
      ON s.id = session_id
     AND s.user_id = u.id
    WHERE u.id = actor_id
      AND u.deleted_at IS NULL
      AND u.email_confirmed_at IS NOT NULL
      AND (u.banned_until IS NULL OR u.banned_until <= now())
      AND (s.not_after IS NULL OR s.not_after > now());

    IF NOT FOUND OR nullif(trim(actor_email), '') IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object('id', actor_id, 'email', actor_email);
END;
$$;

REVOKE ALL ON FUNCTION private.verify_pvs_dashboard_actor()
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.verify_pvs_dashboard_actor()
TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_pvs_dashboard_actor()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT private.verify_pvs_dashboard_actor();
$$;

REVOKE ALL ON FUNCTION public.verify_pvs_dashboard_actor()
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_pvs_dashboard_actor()
TO authenticated;

COMMIT;
