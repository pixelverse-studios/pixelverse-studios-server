-- ============================================================
-- Migration: Add RLS policies for CMS tables
-- Defense-in-depth security for client_users, cms_templates, cms_pages
-- (DEV-652)
--
-- IMPORTANT: The PVS API server uses the service_role key, which
-- bypasses RLS entirely. These policies only apply when a non-service
-- role (e.g., authenticated, anon) accesses the database directly.
-- Primary access control remains in Express middleware.
-- ============================================================

-- ============================================================
-- Helper functions (SECURITY DEFINER bypasses RLS to avoid recursion)
-- ============================================================

-- Returns true if the given auth uid is a PVS admin
CREATE OR REPLACE FUNCTION public.is_pvs_admin(uid UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.client_users
        WHERE auth_uid = uid
          AND is_pvs_admin = true
          AND active = true
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Returns true if the user has any access (view+) to a client's CMS data
CREATE OR REPLACE FUNCTION public.has_client_cms_access(uid UUID, target_client_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.client_users
        WHERE auth_uid = uid
          AND active = true
          AND (is_pvs_admin = true OR client_id = target_client_id)
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Returns true if the user has edit access to a client's CMS pages
CREATE OR REPLACE FUNCTION public.has_client_cms_edit_access(uid UUID, target_client_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.client_users
        WHERE auth_uid = uid
          AND active = true
          AND (
              is_pvs_admin = true
              OR (client_id = target_client_id AND role IN ('admin', 'editor'))
          )
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ============================================================
-- Enable RLS on all CMS tables
-- ============================================================
ALTER TABLE public.client_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_pages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- client_users policies
-- ============================================================

-- Users can read their own row(s); PVS admins can read all
CREATE POLICY client_users_select
    ON public.client_users
    FOR SELECT
    TO authenticated
    USING (
        auth_uid = (SELECT auth.uid())
        OR public.is_pvs_admin((SELECT auth.uid()))
    );

-- Only PVS admins can insert new client_users rows
CREATE POLICY client_users_insert_admin
    ON public.client_users
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_pvs_admin((SELECT auth.uid())));

-- Only PVS admins can update client_users rows
CREATE POLICY client_users_update_admin
    ON public.client_users
    FOR UPDATE
    TO authenticated
    USING (public.is_pvs_admin((SELECT auth.uid())))
    WITH CHECK (public.is_pvs_admin((SELECT auth.uid())));

-- Only PVS admins can delete client_users rows
CREATE POLICY client_users_delete_admin
    ON public.client_users
    FOR DELETE
    TO authenticated
    USING (public.is_pvs_admin((SELECT auth.uid())));

-- ============================================================
-- cms_templates policies
-- ============================================================

-- Any user with access to the client can read its templates
CREATE POLICY cms_templates_select
    ON public.cms_templates
    FOR SELECT
    TO authenticated
    USING (public.has_client_cms_access((SELECT auth.uid()), client_id));

-- Only PVS admins can create templates
CREATE POLICY cms_templates_insert_admin
    ON public.cms_templates
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_pvs_admin((SELECT auth.uid())));

-- Only PVS admins can update templates
CREATE POLICY cms_templates_update_admin
    ON public.cms_templates
    FOR UPDATE
    TO authenticated
    USING (public.is_pvs_admin((SELECT auth.uid())))
    WITH CHECK (public.is_pvs_admin((SELECT auth.uid())));

-- Only PVS admins can delete templates
CREATE POLICY cms_templates_delete_admin
    ON public.cms_templates
    FOR DELETE
    TO authenticated
    USING (public.is_pvs_admin((SELECT auth.uid())));

-- ============================================================
-- cms_pages policies
-- ============================================================

-- Any user with access to the client can read its pages
CREATE POLICY cms_pages_select
    ON public.cms_pages
    FOR SELECT
    TO authenticated
    USING (public.has_client_cms_access((SELECT auth.uid()), client_id));

-- Editors and admins can create pages for their client
CREATE POLICY cms_pages_insert_editor
    ON public.cms_pages
    FOR INSERT
    TO authenticated
    WITH CHECK (public.has_client_cms_edit_access((SELECT auth.uid()), client_id));

-- Editors and admins can update pages for their client
CREATE POLICY cms_pages_update_editor
    ON public.cms_pages
    FOR UPDATE
    TO authenticated
    USING (public.has_client_cms_edit_access((SELECT auth.uid()), client_id))
    WITH CHECK (public.has_client_cms_edit_access((SELECT auth.uid()), client_id));

-- Editors and admins can delete pages for their client
CREATE POLICY cms_pages_delete_editor
    ON public.cms_pages
    FOR DELETE
    TO authenticated
    USING (public.has_client_cms_edit_access((SELECT auth.uid()), client_id));
