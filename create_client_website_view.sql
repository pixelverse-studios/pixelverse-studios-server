-- Comprehensive view for client website data
-- This view aggregates all related data for each website including:
-- - Website details
-- - Client information
-- - Contact form submissions
-- - CMS content pages
-- - Newsletter subscribers
--
-- Based on actual database schema from Supabase

CREATE OR REPLACE VIEW client_website_complete AS
SELECT
    -- Website core fields
    w.id AS website_id,
    w.created_at AS website_created_at,
    w.client_id,
    w.title AS website_title,
    w.domain,
    w.type AS website_type,
    w.features,
    w.contact_email AS website_contact_email,
    w.website_slug,
    w."places-key" AS places_key,

    -- Client information
    c.firstname AS client_firstname,
    c.lastname AS client_lastname,
    c.email AS client_email,
    c.phone AS client_phone,
    c.active AS client_active,
    c.created_at AS client_created_at,
    c.updated_at AS client_updated_at,

    -- Aggregated contact form submissions as JSON array
    COALESCE(
        json_agg(
            DISTINCT jsonb_build_object(
                'id', cfs.id,
                'created_at', cfs.created_at,
                'fullname', cfs.fullname,
                'email', cfs.email,
                'phone', cfs.phone,
                'data', cfs.data
            )
        ) FILTER (WHERE cfs.id IS NOT NULL),
        '[]'::json
    ) AS contact_form_submissions,

    -- Aggregated CMS content as JSON array
    COALESCE(
        json_agg(
            DISTINCT jsonb_build_object(
                'id', cms.id,
                'created_at', cms.created_at,
                'updated_at', cms.updated_at,
                'page_slug', cms.page_slug,
                'page_title', cms.page_title,
                'content', cms.content
            )
        ) FILTER (WHERE cms.id IS NOT NULL),
        '[]'::json
    ) AS cms_contents,

    -- Aggregated newsletter subscribers as JSON array
    COALESCE(
        json_agg(
            DISTINCT jsonb_build_object(
                'id', nl.id,
                'created_at', nl.created_at,
                'updated_at', nl.updated_at,
                'firstname', nl.firstname,
                'lastname', nl.lastname,
                'email', nl.email,
                'subscribed', nl.subscribed
            )
        ) FILTER (WHERE nl.id IS NOT NULL),
        '[]'::json
    ) AS newsletter_subscribers,

    -- Summary counts
    COUNT(DISTINCT cfs.id) AS total_contact_submissions,
    COUNT(DISTINCT cms.id) AS total_cms_pages,
    COUNT(DISTINCT nl.id) AS total_newsletter_subscribers,
    COUNT(DISTINCT CASE WHEN nl.subscribed = true THEN nl.id END) AS total_active_subscribers

FROM websites w
LEFT JOIN clients c ON w.client_id = c.id
LEFT JOIN contact_form_submissions cfs ON w.id = cfs.website_id
LEFT JOIN cms_contents cms ON w.id = cms.website_id
LEFT JOIN newsletter nl ON w.id = nl.website_id

GROUP BY
    w.id,
    w.created_at,
    w.client_id,
    w.title,
    w.domain,
    w.type,
    w.features,
    w.contact_email,
    w.website_slug,
    w."places-key",
    c.firstname,
    c.lastname,
    c.email,
    c.phone,
    c.active,
    c.created_at,
    c.updated_at;

-- Create indexes for better query performance (if they don't already exist)
CREATE INDEX IF NOT EXISTS idx_websites_client_id ON websites(client_id);
CREATE INDEX IF NOT EXISTS idx_contact_form_submissions_website_id ON contact_form_submissions(website_id);
CREATE INDEX IF NOT EXISTS idx_cms_contents_website_id ON cms_contents(website_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_website_id ON newsletter(website_id);

-- Example queries to use this view:

-- Get all data for a specific website by ID
-- SELECT * FROM client_website_complete WHERE website_id = 'your-website-uuid';

-- Get all data for a specific client by client_id
-- SELECT * FROM client_website_complete WHERE client_id = 'your-client-uuid';

-- Get all data for a website by slug
-- SELECT * FROM client_website_complete WHERE website_slug = 'your-slug';

-- Get websites with high engagement
-- SELECT website_title, website_slug, total_contact_submissions, total_active_subscribers
-- FROM client_website_complete
-- WHERE total_contact_submissions > 10
-- ORDER BY total_contact_submissions DESC;

-- Get complete client overview with all their websites
-- SELECT client_firstname, client_lastname, json_agg(
--     json_build_object(
--         'website', website_title,
--         'slug', website_slug,
--         'submissions', total_contact_submissions,
--         'subscribers', total_active_subscribers
--     )
-- ) as websites
-- FROM client_website_complete
-- WHERE client_id = 'your-client-uuid'
-- GROUP BY client_firstname, client_lastname;
