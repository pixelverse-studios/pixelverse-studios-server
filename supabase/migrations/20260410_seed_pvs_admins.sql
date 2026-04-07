-- ============================================================
-- Migration: Seed PVS admin rows for Phil and Sami (DEV-655)
--
-- PVS admins have is_pvs_admin = true, role = 'admin', client_id = NULL.
-- They get global access to all client CMS data.
--
-- This migration is idempotent and handles two cases:
-- 1. The admin has already signed in (auth.users row exists) — link immediately
-- 2. The admin hasn't signed in yet — pre-seed with auth_uid = NULL,
--    the auth middleware's first-login linking will populate it on first sign-in
-- ============================================================

DO $$
DECLARE
    admin_emails TEXT[] := ARRAY[
        'phil@pixelversestudios.io',
        'sami@pixelversestudios.io'
    ];
    admin_names TEXT[] := ARRAY['Phil', 'Sami'];
    i INT;
    existing_auth_uid UUID;
BEGIN
    FOR i IN 1..array_length(admin_emails, 1) LOOP
        -- Look up auth.users.id if it exists
        SELECT id INTO existing_auth_uid
        FROM auth.users
        WHERE email = admin_emails[i]
        LIMIT 1;

        -- Only insert if no active PVS admin row exists for this email
        IF NOT EXISTS (
            SELECT 1 FROM public.client_users
            WHERE email = admin_emails[i]
              AND is_pvs_admin = true
              AND active = true
        ) THEN
            INSERT INTO public.client_users (
                auth_uid,
                client_id,
                role,
                email,
                display_name,
                is_pvs_admin,
                active
            ) VALUES (
                existing_auth_uid,
                NULL,
                'admin',
                admin_emails[i],
                admin_names[i],
                true,
                true
            );
        END IF;
    END LOOP;
END $$;
