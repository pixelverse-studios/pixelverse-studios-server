-- ============================================================
-- Migration: Drop legacy cms table (DEV-659)
--
-- The original `cms` table was a flat key-value store predating the
-- DEV-650 epic. It is replaced by the schema-registry pair
-- `cms_templates` and `cms_pages` (created in 20260406_create_cms_schema.sql).
--
-- The legacy table was unused — there were no service callers,
-- and the only references in the codebase were in the now-removed
-- `src/routes/cms.ts` and `src/controllers/cms.ts`.
-- ============================================================

DROP TABLE IF EXISTS public.cms;
