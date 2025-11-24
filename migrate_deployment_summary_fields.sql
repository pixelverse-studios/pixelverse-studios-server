-- Migration to split deployment summary into two fields:
-- 1. deploy_summary: The actual deploy summary sent in emails
-- 2. internal_notes: Internal team notes (not sent in emails)

-- Step 1: Add new columns
ALTER TABLE website_deployments
ADD COLUMN deploy_summary TEXT,
ADD COLUMN internal_notes TEXT;

-- Step 2: Copy existing summary data to deploy_summary
UPDATE website_deployments
SET deploy_summary = summary;

-- Step 3: Make deploy_summary required (NOT NULL)
ALTER TABLE website_deployments
ALTER COLUMN deploy_summary SET NOT NULL;

-- Step 4: Drop the old summary column
ALTER TABLE website_deployments
DROP COLUMN summary;

-- Verify the migration
SELECT id, deploy_summary, internal_notes, created_at
FROM website_deployments
ORDER BY created_at DESC
LIMIT 5;
