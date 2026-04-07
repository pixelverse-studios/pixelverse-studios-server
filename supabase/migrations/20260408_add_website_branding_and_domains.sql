-- ============================================================
-- Migration: Add website branding, R2 config, and website_domains table
-- (DEV-660)
-- ============================================================

-- ============================================================
-- Add r2_config and branding JSONB columns to websites
-- ============================================================
ALTER TABLE public.websites
    ADD COLUMN r2_config JSONB,
    ADD COLUMN branding JSONB;

COMMENT ON COLUMN public.websites.r2_config IS
'Cloudflare R2 storage configuration. NULL means use shared PVS defaults.
{
  "bucket": "iffers-pictures",
  "public_base_url": "https://pub-....r2.dev",
  "key_prefix": ""
}';

COMMENT ON COLUMN public.websites.branding IS
'White-label branding for the CMS dashboard. NULL means use PVS default theme.
{
  "logo_url": "https://...",
  "favicon_url": "https://...",
  "primary_color": "#1a9b8e",
  "secondary_color": "#...",
  "accent_color": "#...",
  "font_family": "Inter",
  "heading_font_family": "Playfair Display"
}';

-- ============================================================
-- Create website_domains table
-- Maps hostnames to websites for white-labeled dashboard access
-- ============================================================
CREATE TYPE public.website_domain_purpose AS ENUM (
    'dashboard',
    'production',
    'staging',
    'preview'
);

CREATE TABLE public.website_domains (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    website_id      UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
    hostname        TEXT NOT NULL CHECK (hostname = lower(hostname) AND length(hostname) > 0),
    purpose         public.website_domain_purpose NOT NULL DEFAULT 'dashboard',
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique hostname only among active rows (allows soft-deleted duplicates)
CREATE UNIQUE INDEX idx_website_domains_hostname
    ON public.website_domains(hostname)
    WHERE active = true;

CREATE INDEX idx_website_domains_website_id
    ON public.website_domains(website_id);

-- Reuses set_updated_at() from the CMS schema migration (20260406)
CREATE TRIGGER trg_website_domains_updated_at
    BEFORE UPDATE ON public.website_domains
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
