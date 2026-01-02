-- Update client_website_summary view to include status and priority for websites
-- This enables the kanban board to display and filter by project status

CREATE OR REPLACE VIEW client_website_summary AS
SELECT
    c.id AS client_id,
    c.firstname,
    c.lastname,
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
GROUP BY c.id, c.firstname, c.lastname, c.email, c.active
ORDER BY c.lastname, c.firstname;
