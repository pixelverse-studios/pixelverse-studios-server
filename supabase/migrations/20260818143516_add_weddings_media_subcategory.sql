ALTER TABLE public.media_catalog_items
DROP CONSTRAINT media_catalog_items_service_sub_category_check,
DROP CONSTRAINT media_catalog_items_sub_category_check;

ALTER TABLE public.media_catalog_items
ADD CONSTRAINT media_catalog_items_sub_category_check CHECK (
    sub_category IS NULL
    OR sub_category IN (
        'Baby Shower',
        'Bridal Shower',
        'Weddings',
        'Gender Reveal',
        'Birthday',
        'Baptism',
        'Family',
        'Maternity',
        'Engagement',
        'Proposal',
        'Portrait'
    )
),
ADD CONSTRAINT media_catalog_items_service_sub_category_check CHECK (
    sub_category IS NULL
    OR (
        service = 'Events'
        AND sub_category IN (
            'Baby Shower',
            'Bridal Shower',
            'Weddings',
            'Gender Reveal',
            'Birthday',
            'Baptism'
        )
    )
    OR (service = 'Family' AND sub_category = 'Family')
    OR (service = 'Maternity' AND sub_category = 'Maternity')
    OR (
        service = 'Couples'
        AND sub_category IN ('Engagement', 'Proposal')
    )
    OR (service = 'Portrait' AND sub_category = 'Portrait')
);
