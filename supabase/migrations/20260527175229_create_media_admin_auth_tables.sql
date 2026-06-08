-- DEV-935: Media admin magic-link auth tables
--
-- Stores hashed one-time magic-link tokens and hashed admin session tokens.
-- Raw tokens never belong in persistence or logs.

CREATE TABLE public.media_admin_magic_links (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text        NOT NULL,
    token_hash    text        NOT NULL UNIQUE,
    requested_ip  text,
    user_agent    text,
    expires_at    timestamptz NOT NULL,
    used_at       timestamptz,
    created_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT media_admin_magic_links_email_lower_check CHECK (
        email = lower(email)
    ),
    CONSTRAINT media_admin_magic_links_expiry_check CHECK (
        expires_at > created_at
    )
);

CREATE INDEX media_admin_magic_links_email_created_at_idx
    ON public.media_admin_magic_links (email, created_at DESC);

CREATE INDEX media_admin_magic_links_expires_at_idx
    ON public.media_admin_magic_links (expires_at);

CREATE TABLE public.media_admin_sessions (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email          text        NOT NULL,
    session_hash   text        NOT NULL UNIQUE,
    created_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
    expires_at     timestamptz NOT NULL,
    last_seen_at   timestamptz,
    revoked_at     timestamptz,
    CONSTRAINT media_admin_sessions_email_lower_check CHECK (
        email = lower(email)
    ),
    CONSTRAINT media_admin_sessions_expiry_check CHECK (
        expires_at > created_at
    )
);

CREATE INDEX media_admin_sessions_email_created_at_idx
    ON public.media_admin_sessions (email, created_at DESC);

CREATE INDEX media_admin_sessions_expires_at_idx
    ON public.media_admin_sessions (expires_at);

ALTER TABLE public.media_admin_magic_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_admin_sessions ENABLE ROW LEVEL SECURITY;
