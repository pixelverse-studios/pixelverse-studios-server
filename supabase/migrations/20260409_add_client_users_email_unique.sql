-- ============================================================
-- Migration: Tighten client_users email uniqueness for active rows
-- (DEV-654 race-condition fix)
-- ============================================================

-- Drop the existing index that doesn't filter by active
DROP INDEX IF EXISTS public.idx_client_users_email_client;

-- Recreate filtering by active=true so soft-deleted rows can be reinvited
-- and concurrent invites cannot both succeed.
CREATE UNIQUE INDEX idx_client_users_email_client_active
    ON public.client_users(email, client_id)
    WHERE client_id IS NOT NULL AND active = true;
