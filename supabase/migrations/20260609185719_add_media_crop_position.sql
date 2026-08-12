ALTER TABLE public.media_catalog_items
ADD COLUMN IF NOT EXISTS crop_position text DEFAULT 'center center';

UPDATE public.media_catalog_items
SET crop_position = 'center center'
WHERE crop_position IS NULL;

ALTER TABLE public.media_catalog_items
DROP CONSTRAINT IF EXISTS media_catalog_items_crop_position_check;

ALTER TABLE public.media_catalog_items
ADD CONSTRAINT media_catalog_items_crop_position_check CHECK (
    crop_position IS NULL
    OR crop_position IN (
        'center center',
        'center top',
        'center bottom',
        'left center',
        'right center'
    )
    OR crop_position ~ '^((100(\.0{1,2})?)|([0-9]{1,2}(\.[0-9]{1,2})?))% ((100(\.0{1,2})?)|([0-9]{1,2}(\.[0-9]{1,2})?))%$'
);

NOTIFY pgrst, 'reload schema';
