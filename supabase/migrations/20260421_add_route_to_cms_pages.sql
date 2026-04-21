-- Add first-class route metadata to CMS pages.
-- Route belongs to the page record, not the template-shaped content payload.

ALTER TABLE public.cms_pages
    ADD COLUMN route TEXT;

UPDATE public.cms_pages
SET route = '/' || slug
WHERE route IS NULL;

ALTER TABLE public.cms_pages
    ALTER COLUMN route SET NOT NULL;

ALTER TABLE public.cms_pages
    ADD CONSTRAINT cms_pages_route_format_check
    CHECK (
        route ~ '^/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$'
    );

CREATE UNIQUE INDEX idx_cms_pages_client_route
    ON public.cms_pages(client_id, route);
