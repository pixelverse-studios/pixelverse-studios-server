ALTER TABLE public.media_catalog_items
    ADD COLUMN IF NOT EXISTS library text NOT NULL DEFAULT 'portfolio',
    ADD COLUMN IF NOT EXISTS site_category text;

UPDATE public.media_catalog_items
SET library = 'portfolio'
WHERE library IS NULL;

ALTER TABLE public.media_catalog_items
    ADD CONSTRAINT media_catalog_items_library_check
    CHECK (library IN ('portfolio', 'site')) NOT VALID;

ALTER TABLE public.media_catalog_items
    ADD CONSTRAINT media_catalog_items_site_category_check
    CHECK (
        site_category IS NULL
        OR site_category IN ('Home', 'About', 'Brand', 'Misc')
    ) NOT VALID;

ALTER TABLE public.media_catalog_items
    ADD CONSTRAINT media_catalog_items_library_metadata_check
    CHECK (
        (library = 'portfolio' AND site_category IS NULL)
        OR (library = 'site' AND service IS NULL AND sub_category IS NULL)
    ) NOT VALID;

ALTER TABLE public.media_catalog_items
    ADD CONSTRAINT media_catalog_items_publish_library_metadata_check
    CHECK (
        status <> 'published'
        OR (
            NULLIF(BTRIM(alt), '') IS NOT NULL
            AND aspect_ratio IS NOT NULL
            AND (
                (
                    library = 'portfolio'
                    AND service IS NOT NULL
                    AND sub_category IS NOT NULL
                )
                OR (library = 'site' AND site_category IS NOT NULL)
            )
        )
    ) NOT VALID;

CREATE INDEX IF NOT EXISTS media_catalog_items_website_library_status_idx
    ON public.media_catalog_items (website_id, library, status);

CREATE INDEX IF NOT EXISTS media_catalog_items_site_category_status_idx
    ON public.media_catalog_items (website_id, site_category, status)
    WHERE library = 'site';
