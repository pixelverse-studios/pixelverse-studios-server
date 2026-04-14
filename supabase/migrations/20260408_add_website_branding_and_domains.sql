-- ============================================================
-- Migration: Add website branding, R2 config, and website_domains table
-- (DEV-660)
-- ============================================================

-- ============================================================
-- Add r2_config and branding JSONB columns to websites
--
-- branding: white-label theme returned by the public hostname-resolution
-- endpoint. Constrained to prevent stored XSS via malicious URLs/colors.
--
-- r2_config: per-website R2 storage override. Constrained to prevent
-- path traversal in key_prefix and malformed bucket names. Must NEVER
-- be returned by a public endpoint — operational config only.
-- ============================================================
ALTER TABLE public.websites
    ADD COLUMN r2_config JSONB,
    ADD COLUMN branding JSONB;

-- Branding must be a JSON object with safe URL/color values
ALTER TABLE public.websites
    ADD CONSTRAINT chk_websites_branding_shape CHECK (
        branding IS NULL OR (
            jsonb_typeof(branding) = 'object'
            AND (
                NOT branding ? 'logo_url'
                OR (branding ->> 'logo_url') ~ '^https://'
            )
            AND (
                NOT branding ? 'favicon_url'
                OR (branding ->> 'favicon_url') ~ '^https://'
            )
            AND (
                NOT branding ? 'primary_color'
                OR (branding ->> 'primary_color') ~ '^#[0-9a-fA-F]{3,8}$'
            )
            AND (
                NOT branding ? 'secondary_color'
                OR (branding ->> 'secondary_color') ~ '^#[0-9a-fA-F]{3,8}$'
            )
            AND (
                NOT branding ? 'accent_color'
                OR (branding ->> 'accent_color') ~ '^#[0-9a-fA-F]{3,8}$'
            )
        )
    );

-- r2_config: bucket must match S3 naming, key_prefix must not enable path traversal
ALTER TABLE public.websites
    ADD CONSTRAINT chk_websites_r2_config_shape CHECK (
        r2_config IS NULL OR (
            jsonb_typeof(r2_config) = 'object'
            AND (
                NOT r2_config ? 'bucket'
                OR (r2_config ->> 'bucket') ~ '^[a-z0-9][a-z0-9-]{1,62}$'
            )
            AND (
                NOT r2_config ? 'public_base_url'
                OR (r2_config ->> 'public_base_url') ~ '^https://'
            )
            AND (
                NOT r2_config ? 'key_prefix'
                OR (
                    (r2_config ->> 'key_prefix') ~ '^[a-zA-Z0-9_\-/]*$'
                    AND (r2_config ->> 'key_prefix') NOT LIKE '%..%'
                )
            )
        )
    );

COMMENT ON COLUMN public.websites.r2_config IS
'Cloudflare R2 storage configuration. NULL means use shared PVS defaults.
Shape: { bucket, public_base_url, key_prefix }
WARNING: This column may contain operational config — never return it
from a public/unauthenticated endpoint.';

COMMENT ON COLUMN public.websites.branding IS
'White-label branding for the CMS dashboard. NULL means use PVS default theme.
Shape: { logo_url, favicon_url, primary_color, secondary_color,
accent_color, font_family, heading_font_family }
URLs must be https://. Colors must be hex (#rgb, #rrggbb, or #rrggbbaa).';

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
    -- RFC 1123 hostname: lowercase, dot-separated labels of [a-z0-9-]
    -- max 253 chars total, each label max 63, no leading/trailing hyphen
    hostname        TEXT NOT NULL CHECK (
        hostname = lower(hostname)
        AND length(hostname) > 0
        AND length(hostname) <= 253
        AND hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
    ),
    purpose         public.website_domain_purpose NOT NULL DEFAULT 'dashboard',
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique hostname only among active rows (allows soft-deleted duplicates).
-- DEV-662 hostname-resolution lookups MUST query with `WHERE active = true`
-- to use this partial index.
CREATE UNIQUE INDEX idx_website_domains_hostname
    ON public.website_domains(hostname)
    WHERE active = true;

-- Prevent multiple active dashboard/production domains per website.
-- A website should have one canonical dashboard URL and one canonical
-- production URL. Staging and preview can have multiple.
CREATE UNIQUE INDEX idx_website_domains_singleton_purpose
    ON public.website_domains(website_id, purpose)
    WHERE active = true AND purpose IN ('dashboard', 'production');

CREATE INDEX idx_website_domains_website_id
    ON public.website_domains(website_id);

-- updated_at trigger reuses set_updated_at() from 20260406_create_cms_schema.sql
CREATE TRIGGER trg_website_domains_updated_at
    BEFORE UPDATE ON public.website_domains
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- RLS (defense-in-depth — service_role bypasses by default)
-- Matches the convention from 20260407_add_cms_rls_policies.sql.
-- No policies for authenticated/anon since DEV-662 hostname resolution
-- and DEV-661 R2 uploads go through the API server using service_role.
-- ============================================================
ALTER TABLE public.website_domains ENABLE ROW LEVEL SECURITY;
