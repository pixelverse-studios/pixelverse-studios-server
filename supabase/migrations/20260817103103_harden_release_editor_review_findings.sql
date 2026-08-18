-- Harden the simplified editor after cross-repository review.
-- Domani's release calendar is evaluated in America/New_York, draft slugs
-- follow the editable identity, and a slug freezes permanently at first publish.

ALTER TABLE public.releases
ADD COLUMN IF NOT EXISTS slug_frozen_at timestamptz;

UPDATE public.releases
SET slug_frozen_at = coalesce(
    (
        SELECT min(event.created_at)
        FROM public.release_audit_events event
        WHERE event.release_id = releases.id
          AND (
              event.after_data->>'visibility' IN ('public_preview','published')
              OR event.action IN ('release.preview_published','release.published')
          )
    ),
    released_at,
    updated_at,
    created_at,
    now()
)
WHERE slug_frozen_at IS NULL
  AND (
      visibility <> 'private'
      OR EXISTS (
          SELECT 1 FROM public.release_audit_events event
          WHERE event.release_id = releases.id
            AND event.after_data->>'visibility' IN ('public_preview','published')
      )
  );

CREATE OR REPLACE FUNCTION public.sync_release_slug_from_identity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.slug_frozen_at IS NOT NULL THEN
        NEW.slug := OLD.slug;
        NEW.slug_frozen_at := OLD.slug_frozen_at;
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT'
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.title IS DISTINCT FROM OLD.title THEN
        NEW.slug := lower(regexp_replace(
            regexp_replace(NEW.version || '-' || NEW.title, '[^a-zA-Z0-9]+', '-', 'g'),
            '(^-|-$)', '', 'g'
        ));
    END IF;

    IF NEW.visibility <> 'private' THEN
        NEW.slug_frozen_at := coalesce(NEW.slug_frozen_at, now());
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS releases_sync_derived_slug ON public.releases;
CREATE TRIGGER releases_sync_derived_slug
BEFORE INSERT OR UPDATE ON public.releases
FOR EACH ROW EXECUTE FUNCTION public.sync_release_slug_from_identity();

REVOKE ALL ON FUNCTION public.sync_release_slug_from_identity()
FROM PUBLIC,anon,authenticated;

ALTER FUNCTION public.save_admin_domani_release_editor(
    uuid,bigint,jsonb,uuid,text,public.dashboard_role,text
) RENAME TO save_admin_domani_release_editor_unchecked;

ALTER FUNCTION public.save_admin_domani_release_editor_unchecked(
    uuid,bigint,jsonb,uuid,text,public.dashboard_role,text
) SET timezone TO 'America/New_York';

REVOKE ALL ON FUNCTION public.save_admin_domani_release_editor_unchecked(
    uuid,bigint,jsonb,uuid,text,public.dashboard_role,text
) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.save_admin_domani_release_editor(
    p_release_id uuid,
    p_primary_if_match bigint,
    p_payload jsonb,
    p_actor_user_id uuid,
    p_actor_email text,
    p_actor_role public.dashboard_role,
    p_request_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET timezone = 'America/New_York'
AS $$
BEGIN
    IF p_payload->>'status' = 'draft'
       AND p_payload#>>'{timing,kind}' = 'date'
       AND (p_payload#>>'{timing,value}')::date < CURRENT_DATE THEN
        RAISE EXCEPTION 'DEV1042_TARGET_DATE_PAST';
    END IF;

    IF jsonb_typeof(p_payload->'highlights') = 'array'
       AND jsonb_array_length(p_payload->'highlights') <> (
           SELECT count(DISTINCT item->>'id')
           FROM jsonb_array_elements(p_payload->'highlights') item
       ) THEN
        RAISE EXCEPTION 'DEV1042_NOTE_SET_INVALID';
    END IF;

    RETURN public.save_admin_domani_release_editor_unchecked(
        p_release_id,
        p_primary_if_match,
        p_payload,
        p_actor_user_id,
        p_actor_email,
        p_actor_role,
        p_request_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.save_admin_domani_release_editor(
    uuid,bigint,jsonb,uuid,text,public.dashboard_role,text
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_admin_domani_release_editor(
    uuid,bigint,jsonb,uuid,text,public.dashboard_role,text
) TO service_role;

ALTER FUNCTION public.list_public_domani_releases(
    text,public.release_platform,integer,text,integer,integer,integer,uuid
) SET timezone TO 'America/New_York';

COMMENT ON COLUMN public.releases.slug_frozen_at
IS 'First instant this release became customer-visible; once populated, slug changes are rejected by the identity trigger.';

COMMENT ON FUNCTION public.save_admin_domani_release_editor(
    uuid,bigint,jsonb,uuid,text,public.dashboard_role,text
) IS 'Service-role-only atomic editor save with duplicate-highlight protection and New York release-calendar semantics.';

NOTIFY pgrst, 'reload schema';
