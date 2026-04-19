-- ============================================================
-- Migration: Enforce one active PVS admin row per email
--
-- 1. Deactivates duplicate active PVS admin rows, keeping the best
--    candidate per email (linked rows first, then oldest row)
-- 2. Adds a unique partial index so future duplicate active PVS admin
--    rows cannot be created for the same email
-- ============================================================

WITH ranked_admins AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY email
            ORDER BY
                CASE WHEN auth_uid IS NOT NULL THEN 0 ELSE 1 END,
                created_at ASC,
                id ASC
        ) AS row_num
    FROM public.client_users
    WHERE is_pvs_admin = true
      AND active = true
),
duplicate_admins AS (
    SELECT id
    FROM ranked_admins
    WHERE row_num > 1
)
UPDATE public.client_users AS cu
SET
    active = false,
    updated_at = now()
FROM duplicate_admins AS da
WHERE cu.id = da.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_users_pvs_admin_email_active
    ON public.client_users(email)
    WHERE is_pvs_admin = true
      AND active = true;
