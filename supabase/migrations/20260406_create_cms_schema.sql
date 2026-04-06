-- ============================================================
-- Migration: Create CMS schema
-- Creates client_users, cms_templates, cms_pages tables
-- for the client CMS dashboard feature (DEV-651)
-- ============================================================

-- Enums
CREATE TYPE public.cms_role AS ENUM ('admin', 'editor', 'viewer');
CREATE TYPE public.cms_publish_status AS ENUM ('draft', 'published', 'archived');

-- ============================================================
-- Table: client_users
-- Links Supabase auth users to clients with role-based access
-- ============================================================
CREATE TABLE public.client_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_uid        UUID,
    client_id       UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    role            public.cms_role NOT NULL DEFAULT 'viewer',
    email           TEXT NOT NULL,
    display_name    TEXT,
    is_pvs_admin    BOOLEAN NOT NULL DEFAULT false,
    invited_by      UUID,
    invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login      TIMESTAMPTZ,
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A user can only have one role per client
CREATE UNIQUE INDEX idx_client_users_auth_client
    ON public.client_users(auth_uid, client_id)
    WHERE client_id IS NOT NULL;

-- Only one PVS admin row per auth_uid
CREATE UNIQUE INDEX idx_client_users_pvs_admin
    ON public.client_users(auth_uid)
    WHERE is_pvs_admin = true;

CREATE INDEX idx_client_users_auth_uid ON public.client_users(auth_uid);
CREATE INDEX idx_client_users_client_id ON public.client_users(client_id);
CREATE INDEX idx_client_users_email ON public.client_users(email);

-- ============================================================
-- Table: cms_templates (Schema Registry)
-- Defines the content shape (field definitions) per client/page
-- ============================================================
CREATE TABLE public.cms_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    slug            TEXT NOT NULL,
    label           TEXT NOT NULL,
    description     TEXT,
    fields          JSONB NOT NULL DEFAULT '[]',
    version         INTEGER NOT NULL DEFAULT 1,
    active          BOOLEAN NOT NULL DEFAULT true,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_cms_templates_client_slug
    ON public.cms_templates(client_id, slug);

CREATE INDEX idx_cms_templates_client_id ON public.cms_templates(client_id);

COMMENT ON COLUMN public.cms_templates.fields IS
'JSON array of field definitions. Each element:
{
  "key": "hero_title",
  "label": "Hero Title",
  "type": "text|richtext|image|number|boolean|json|array|select",
  "required": true,
  "default": "",
  "options": ["opt1","opt2"],
  "max_length": 200,
  "min": 0, "max": 100,
  "description": "Help text for the field"
}';

-- ============================================================
-- Table: cms_pages
-- Stores actual page content validated against templates
-- ============================================================
CREATE TABLE public.cms_pages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    template_id         UUID NOT NULL REFERENCES public.cms_templates(id) ON DELETE RESTRICT,
    slug                TEXT NOT NULL,
    content             JSONB NOT NULL DEFAULT '{}',
    status              public.cms_publish_status NOT NULL DEFAULT 'draft',
    template_version    INTEGER NOT NULL DEFAULT 1,
    published_at        TIMESTAMPTZ,
    published_by        UUID,
    last_edited_by      UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_cms_pages_client_slug
    ON public.cms_pages(client_id, slug);

CREATE INDEX idx_cms_pages_client_id ON public.cms_pages(client_id);
CREATE INDEX idx_cms_pages_template_id ON public.cms_pages(template_id);
CREATE INDEX idx_cms_pages_status ON public.cms_pages(client_id, status);
