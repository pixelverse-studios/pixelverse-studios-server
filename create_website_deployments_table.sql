-- Create website_deployments table for tracking deploy history
-- This table stores deployment records with changed URLs that need Google Search Console re-indexing

CREATE TABLE website_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,

    -- Core deployment data
    changed_urls TEXT[] NOT NULL, -- Array of URLs that need re-indexing in GSC
    deploy_summary TEXT NOT NULL, -- Client-facing markdown summary sent in email
    internal_notes TEXT, -- Internal team notes (NOT sent in email)

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    indexed_at TIMESTAMPTZ -- Set when URLs are re-indexed in Google Search Console (nullable)
);

-- Create indexes for performance
CREATE INDEX idx_website_deployments_website_id ON website_deployments(website_id);
CREATE INDEX idx_website_deployments_created_at ON website_deployments(created_at DESC);

-- Example queries to verify the table:
-- SELECT * FROM website_deployments WHERE website_id = 'your-website-uuid' ORDER BY created_at DESC;
-- SELECT * FROM website_deployments WHERE indexed_at IS NULL; -- Get deployments not yet indexed
