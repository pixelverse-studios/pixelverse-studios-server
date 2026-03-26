-- ============================================================
-- Migration: Create SEO audit tracking tables
-- Stores periodic SEO audit snapshots, keyword position history,
-- and competitor analysis per website
-- ============================================================

-- Core audit snapshots — one row per audit per website
CREATE TABLE public.seo_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    website_id UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
    audit_date DATE NOT NULL DEFAULT CURRENT_DATE,
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    grade TEXT NOT NULL CHECK (grade IN ('A+','A','A-','B+','B','B-','C+','C','C-','D','F')),
    auditor TEXT NOT NULL,
    findings_count INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    checklist JSONB NOT NULL DEFAULT '[]',
    changelog JSONB NOT NULL DEFAULT '[]',
    next_audit_due DATE,
    raw_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_seo_audits_website_id ON public.seo_audits(website_id);
CREATE INDEX idx_seo_audits_audit_date ON public.seo_audits(audit_date DESC);
CREATE UNIQUE INDEX idx_seo_audits_website_date ON public.seo_audits(website_id, audit_date);

-- Keyword position tracking — one row per keyword per audit
CREATE TABLE public.seo_keywords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id UUID NOT NULL REFERENCES public.seo_audits(id) ON DELETE CASCADE,
    website_id UUID NOT NULL REFERENCES public.websites(id),
    keyword TEXT NOT NULL,
    position INTEGER CHECK (position > 0),
    previous_position INTEGER CHECK (previous_position > 0),
    search_volume INTEGER,
    trend TEXT CHECK (trend IN ('up','down','stable','new','lost')),
    target_city TEXT,
    target_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_seo_keywords_audit_id ON public.seo_keywords(audit_id);
CREATE INDEX idx_seo_keywords_website_id ON public.seo_keywords(website_id);
CREATE INDEX idx_seo_keywords_keyword ON public.seo_keywords(keyword);
CREATE UNIQUE INDEX idx_seo_keywords_audit_keyword ON public.seo_keywords(audit_id, keyword);

-- Competitor tracking — one row per competitor per audit
CREATE TABLE public.seo_competitors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id UUID NOT NULL REFERENCES public.seo_audits(id) ON DELETE CASCADE,
    website_id UUID NOT NULL REFERENCES public.websites(id),
    competitor_domain TEXT NOT NULL,
    da_score INTEGER CHECK (da_score BETWEEN 0 AND 100),
    keyword_overlap INTEGER,
    overlap_keywords JSONB DEFAULT '[]',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_seo_competitors_audit_id ON public.seo_competitors(audit_id);
CREATE INDEX idx_seo_competitors_website_id ON public.seo_competitors(website_id);
CREATE UNIQUE INDEX idx_seo_competitors_audit_domain ON public.seo_competitors(audit_id, competitor_domain);
