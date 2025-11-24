-- Alter website_deployments table to track indexing per URL
-- Changes changed_urls from TEXT[] to JSONB to store objects with indexed_at

-- Step 1: Add new column
ALTER TABLE website_deployments
ADD COLUMN changed_urls_new JSONB;

-- Step 2: Migrate existing data
-- Convert TEXT[] to JSONB array of objects
UPDATE website_deployments
SET changed_urls_new = (
    SELECT jsonb_agg(
        jsonb_build_object('url', url, 'indexed_at', NULL)
    )
    FROM unnest(changed_urls) AS url
);

-- Step 3: Drop old column
ALTER TABLE website_deployments
DROP COLUMN changed_urls;

-- Step 4: Rename new column
ALTER TABLE website_deployments
RENAME COLUMN changed_urls_new TO changed_urls;

-- Step 5: Add constraint to ensure it's an array
ALTER TABLE website_deployments
ADD CONSTRAINT changed_urls_is_array CHECK (jsonb_typeof(changed_urls) = 'array');

-- Add index on the JSONB column for better query performance
CREATE INDEX idx_website_deployments_changed_urls ON website_deployments USING gin(changed_urls);
