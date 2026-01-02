-- Add company_name column to clients table
-- This separates business/company name from contact person name (firstname/lastname)

ALTER TABLE clients
ADD COLUMN company_name text;

-- Add comment explaining the field
COMMENT ON COLUMN clients.company_name IS 'Business or company name (e.g., "360 Degree Care"). Firstname/lastname are for the contact person.';

-- Update client_website_summary view to include company_name
CREATE OR REPLACE VIEW client_website_summary AS
SELECT
    c.id AS client_id,
    c.firstname,
    c.lastname,
    c.company_name,
    c.email AS client_email,
    c.active AS client_active,
    count(DISTINCT w.id) AS website_count,
    COALESCE(
        jsonb_agg(
            DISTINCT jsonb_build_object(
                'website_id', w.id,
                'website_title', w.title,
                'domain', w.domain,
                'status', w.status,
                'priority', w.priority
            )
        ) FILTER (WHERE w.id IS NOT NULL),
        '[]'::jsonb
    ) AS websites,
    COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'deployment_id', d.id,
                'website_id', d.website_id,
                'website_title', w.title,
                'deploy_summary', d.deploy_summary,
                'indexing_status', d.indexing_status,
                'created_at', d.created_at
            )
        ) FILTER (WHERE d.id IS NOT NULL AND d.created_at >= (now() - '30 days'::interval)),
        '[]'::jsonb
    ) AS recent_deployments,
    count(d.id) FILTER (WHERE d.created_at >= (now() - '30 days'::interval)) AS deployment_count_30d
FROM clients c
LEFT JOIN websites w ON w.client_id = c.id
LEFT JOIN website_deployments d ON d.website_id = w.id
GROUP BY c.id, c.firstname, c.lastname, c.company_name, c.email, c.active
ORDER BY c.lastname, c.firstname;
