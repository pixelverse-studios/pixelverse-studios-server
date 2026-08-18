-- Keep the user-hidden slug in sync when version or title changes.

CREATE OR REPLACE FUNCTION public.sync_release_slug_from_identity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    IF NEW.version IS DISTINCT FROM OLD.version OR NEW.title IS DISTINCT FROM OLD.title THEN
        NEW.slug := lower(regexp_replace(
            regexp_replace(NEW.version || '-' || NEW.title, '[^a-zA-Z0-9]+', '-', 'g'),
            '(^-|-$)', '', 'g'
        ));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS releases_sync_derived_slug ON public.releases;
CREATE TRIGGER releases_sync_derived_slug
BEFORE UPDATE OF version,title ON public.releases
FOR EACH ROW EXECUTE FUNCTION public.sync_release_slug_from_identity();

REVOKE ALL ON FUNCTION public.sync_release_slug_from_identity()
FROM PUBLIC,anon,authenticated;

NOTIFY pgrst, 'reload schema';
