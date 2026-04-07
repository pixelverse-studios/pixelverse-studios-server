-- ============================================================
-- Migration: Add RLS policies for CMS tables
-- Defense-in-depth security for client_users, cms_templates, cms_pages
-- (DEV-652)
--
-- IMPORTANT: The PVS API server uses the service_role key, which
-- bypasses RLS entirely. These policies only apply when a non-service
-- role (e.g., authenticated, anon) accesses the database directly.
-- Primary access control remains in Express middleware.
--
-- Note on roles:
-- - service_role: bypasses RLS by default (Supabase) — used by the API server
-- - authenticated: scoped by the policies below
-- - anon: intentionally has no policies — public CMS reads go through the
--   API's public endpoint using service_role, never directly via anon key
-- ============================================================

-- ============================================================
-- Helper functions (SECURITY DEFINER bypasses RLS to avoid recursion)
-- All read auth.uid() internally rather than accepting it as a parameter,
-- preventing misuse where a caller could pass an arbitrary uid.
-- ============================================================

-- Returns true if the current authenticated user is a PVS admin
CREATE OR REPLACE FUNCTION public.is_pvs_admin()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.client_users
        WHERE auth_uid = auth.uid()
          AND is_pvs_admin IS TRUE
          AND active IS TRUE
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Returns true if the current user has any access (view+) to a client's CMS data
CREATE OR REPLACE FUNCTION public.has_client_cms_access(target_client_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.client_users
        WHERE auth_uid = auth.uid()
          AND active IS TRUE
          AND (is_pvs_admin IS TRUE OR client_id = target_client_id)
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Returns true if the current user has edit access to a client's CMS pages
CREATE OR REPLACE FUNCTION public.has_client_cms_edit_access(target_client_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.client_users
        WHERE auth_uid = auth.uid()
          AND active IS TRUE
          AND (
              is_pvs_admin IS TRUE
              OR (client_id = target_client_id AND role IN ('admin', 'editor'))
          )
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Lock down EXECUTE permissions on the helper functions.
-- Default GRANT to PUBLIC on functions is removed, then granted explicitly
-- to authenticated only. service_role inherits from postgres and is unaffected.
REVOKE EXECUTE ON FUNCTION public.is_pvs_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_client_cms_access(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_client_cms_edit_access(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_pvs_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_client_cms_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_client_cms_edit_access(UUID) TO authenticated;

-- ============================================================
-- Trigger: prevent client_id mutation on cms_pages
-- A page belongs to one client for its entire lifetime. This prevents
-- an editor with access to two clients from moving a page between them.
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_cms_pages_client_id_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
        RAISE EXCEPTION 'cms_pages.client_id is immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cms_pages_lock_client_id
    BEFORE UPDATE OF client_id ON public.cms_pages
    FOR EACH ROW EXECUTE FUNCTION public.prevent_cms_pages_client_id_change();

-- ============================================================
-- Enable RLS on all CMS tables
-- ============================================================
ALTER TABLE public.client_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_pages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- client_users policies
-- ============================================================

-- Drop policies if they exist (for local dev re-runs)
DROP POLICY IF EXISTS client_users_select ON public.client_users;
DROP POLICY IF EXISTS client_users_insert_admin ON public.client_users;
DROP POLICY IF EXISTS client_users_update_admin ON public.client_users;
DROP POLICY IF EXISTS client_users_delete_admin ON public.client_users;

-- Users can read their own row(s); PVS admins can read all
CREATE POLICY client_users_select
    ON public.client_users
    FOR SELECT
    TO authenticated
    USING (
        auth_uid = (SELECT auth.uid())
        OR public.is_pvs_admin()
    );

-- Only PVS admins can insert new client_users rows
CREATE POLICY client_users_insert_admin
    ON public.client_users
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_pvs_admin());

-- Only PVS admins can update client_users rows
CREATE POLICY client_users_update_admin
    ON public.client_users
    FOR UPDATE
    TO authenticated
    USING (public.is_pvs_admin())
    WITH CHECK (public.is_pvs_admin());

-- Only PVS admins can delete client_users rows
CREATE POLICY client_users_delete_admin
    ON public.client_users
    FOR DELETE
    TO authenticated
    USING (public.is_pvs_admin());

-- ============================================================
-- cms_templates policies
-- ============================================================

DROP POLICY IF EXISTS cms_templates_select ON public.cms_templates;
DROP POLICY IF EXISTS cms_templates_insert_admin ON public.cms_templates;
DROP POLICY IF EXISTS cms_templates_update_admin ON public.cms_templates;
DROP POLICY IF EXISTS cms_templates_delete_admin ON public.cms_templates;

-- Any user with access to the client can read its templates
CREATE POLICY cms_templates_select
    ON public.cms_templates
    FOR SELECT
    TO authenticated
    USING (public.has_client_cms_access(client_id));

-- Only PVS admins can create templates
CREATE POLICY cms_templates_insert_admin
    ON public.cms_templates
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_pvs_admin());

-- Only PVS admins can update templates
CREATE POLICY cms_templates_update_admin
    ON public.cms_templates
    FOR UPDATE
    TO authenticated
    USING (public.is_pvs_admin())
    WITH CHECK (public.is_pvs_admin());

-- Only PVS admins can delete templates
CREATE POLICY cms_templates_delete_admin
    ON public.cms_templates
    FOR DELETE
    TO authenticated
    USING (public.is_pvs_admin());

-- ============================================================
-- cms_pages policies
-- ============================================================

DROP POLICY IF EXISTS cms_pages_select ON public.cms_pages;
DROP POLICY IF EXISTS cms_pages_insert_editor ON public.cms_pages;
DROP POLICY IF EXISTS cms_pages_update_editor ON public.cms_pages;
DROP POLICY IF EXISTS cms_pages_delete_editor ON public.cms_pages;

-- Any user with access to the client can read its pages
CREATE POLICY cms_pages_select
    ON public.cms_pages
    FOR SELECT
    TO authenticated
    USING (public.has_client_cms_access(client_id));

-- Editors and admins can create pages for their client
CREATE POLICY cms_pages_insert_editor
    ON public.cms_pages
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_client_cms_edit_access(client_id));

-- Editors and admins can update pages for their client
-- (client_id mutation is blocked by trg_cms_pages_lock_client_id)
CREATE POLICY cms_pages_update_editor
    ON public.cms_pages
    FOR UPDATE
    TO authenticated
    USING (public.has_client_cms_edit_access(client_id))
    WITH CHECK (public.has_client_cms_edit_access(client_id));

-- Editors and admins can delete pages for their client
CREATE POLICY cms_pages_delete_editor
    ON public.cms_pages
    FOR DELETE
    TO authenticated
    USING (public.has_client_cms_edit_access(client_id));
