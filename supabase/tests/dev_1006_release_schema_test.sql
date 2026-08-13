-- DEV-1006 repeatable schema verification.
-- Run after migrations with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/dev_1006_release_schema_test.sql

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(condition boolean, message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    IF condition IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'assertion failed: %', message;
    END IF;
END;
$$;

SELECT pg_temp.assert_true(
    (
        SELECT count(*) = 6
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN (
              'releases',
              'release_prds',
              'release_conversion_runs',
              'release_notes',
              'release_audit_events',
              'release_cache_invalidation_jobs'
          )
          AND c.relkind = 'r'
          AND c.relrowsecurity
    ),
    'all six private release tables must exist with RLS enabled'
);

SELECT pg_temp.assert_true(
    NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
            'releases',
            'release_prds',
            'release_conversion_runs',
            'release_notes',
            'release_audit_events',
            'release_cache_invalidation_jobs'
        ]) AS table_name
        CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS role_name
        WHERE has_table_privilege(role_name, 'public.' || table_name, 'SELECT')
           OR has_table_privilege(role_name, 'public.' || table_name, 'INSERT')
           OR has_table_privilege(role_name, 'public.' || table_name, 'UPDATE')
           OR has_table_privilege(role_name, 'public.' || table_name, 'DELETE')
    ),
    'anon and authenticated must have no direct release-table privileges'
);

SELECT pg_temp.assert_true(
    NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
            'releases',
            'release_prds',
            'release_conversion_runs',
            'release_notes',
            'release_audit_events',
            'release_cache_invalidation_jobs'
        ]) AS table_name
        WHERE NOT has_table_privilege('service_role', 'public.' || table_name, 'SELECT')
           OR NOT has_table_privilege('service_role', 'public.' || table_name, 'INSERT')
    ),
    'service_role must have server read/insert privileges'
);

SELECT pg_temp.assert_true(
    NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
            'releases',
            'release_prds',
            'release_conversion_runs',
            'release_notes',
            'release_cache_invalidation_jobs'
        ]) AS table_name
        WHERE NOT has_table_privilege('service_role', 'public.' || table_name, 'UPDATE')
    )
    AND NOT has_table_privilege(
        'service_role',
        'public.release_audit_events',
        'UPDATE'
    )
    AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
            'releases',
            'release_prds',
            'release_conversion_runs',
            'release_notes',
            'release_audit_events',
            'release_cache_invalidation_jobs'
        ]) AS table_name
        WHERE has_table_privilege('service_role', 'public.' || table_name, 'DELETE')
    ),
    'service_role must have only the mutations required by the soft-archive model'
);

SELECT pg_temp.assert_true(
    to_regclass('public.releases_semantic_version_unique') IS NOT NULL
    AND to_regclass('public.releases_public_preview_idx') IS NOT NULL
    AND to_regclass('public.releases_changelog_idx') IS NOT NULL
    AND to_regclass('public.releases_admin_list_idx') IS NOT NULL
    AND to_regclass('public.release_prds_current_source_unique') IS NOT NULL
    AND to_regclass('public.release_prds_latest_conversion_idx') IS NOT NULL
    AND to_regclass('public.release_conversion_runs_source_idx') IS NOT NULL
    AND to_regclass('public.release_notes_release_sort_active_unique') IS NOT NULL
    AND to_regclass('public.release_notes_platforms_active_gin') IS NOT NULL
    AND to_regclass('public.release_notes_source_run_idx') IS NOT NULL
    AND to_regclass('public.release_audit_events_action_created_idx') IS NOT NULL
    AND to_regclass('public.release_cache_jobs_dispatch_idx') IS NOT NULL,
    'public, admin, source, note, audit, and outbox indexes must exist'
);

SET LOCAL TIME ZONE 'America/New_York';

INSERT INTO public.releases (
    id,
    version,
    slug,
    title,
    release_type,
    public_summary,
    target_month,
    created_by,
    updated_by
) VALUES (
    '20000000-0000-4000-8000-000000000001',
    '1.12',
    'calmer-evenings',
    'Calmer evenings',
    'minor',
    'A calmer planning flow.',
    '2026-09-01',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
);

SELECT pg_temp.assert_true(
    (
        SELECT version_major = 1
           AND version_minor = 12
           AND version_patch IS NULL
           AND lifecycle_status = 'draft'
           AND visibility = 'private'
           AND row_version = 1
        FROM public.releases
        WHERE id = '20000000-0000-4000-8000-000000000001'
    ),
    'canonical version components and private draft defaults must be generated'
);

SELECT pg_temp.assert_true(
    (
        SELECT abs(extract(epoch FROM (created_at - now()))) < 1
           AND abs(extract(epoch FROM (updated_at - now()))) < 1
        FROM public.releases
        WHERE id = '20000000-0000-4000-8000-000000000001'
    ),
    'timestamptz defaults must preserve the current instant outside UTC sessions'
);

UPDATE public.releases
SET title = 'Calmer evenings updated'
WHERE id = '20000000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
    (
        SELECT abs(extract(epoch FROM (updated_at - now()))) < 1
        FROM public.releases
        WHERE id = '20000000-0000-4000-8000-000000000001'
    ),
    'updated_at triggers must preserve the current instant outside UTC sessions'
);

SET LOCAL TIME ZONE 'UTC';

INSERT INTO public.releases (
    id,
    version,
    slug,
    title,
    release_type,
    created_by,
    updated_by
) VALUES (
    '20000000-0000-4000-8000-000000000002',
    '1.12.0',
    'canonical-patch-release',
    'Canonical patch release',
    'patch',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
);

SELECT pg_temp.assert_true(
    (
        SELECT version_major = 1
           AND version_minor = 12
           AND version_patch = 0
        FROM public.releases
        WHERE id = '20000000-0000-4000-8000-000000000002'
    ),
    'minor 1.12 and canonical patch 1.12.0 must remain distinct releases'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO public.releases (
            version, slug, title, release_type, created_by, updated_by
        ) VALUES (
            '01.12',
            'invalid-leading-zero',
            'Invalid leading zero',
            'minor',
            '10000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'expected leading-zero version rejection';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO public.releases (
            version,
            slug,
            title,
            release_type,
            lifecycle_status,
            visibility,
            public_summary,
            created_by,
            updated_by
        ) VALUES (
            '1.13.1',
            'invalid-patch-preview',
            'Invalid patch preview',
            'patch',
            'planned',
            'public_preview',
            'Must not be accepted.',
            '10000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'expected patch preview rejection';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE public.releases
        SET target_month = '2026-09-02'
        WHERE id = '20000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'expected non-month-start rejection';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO public.release_prds (
    id,
    release_id,
    raw_markdown,
    original_filename,
    source_type,
    source_reference,
    source_content_sha256,
    intended_surface,
    created_by,
    updated_by
) VALUES (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '# Domani 1.12',
    'domani-1.12.md',
    'linear_epic',
    'DEV-1004',
    repeat('a', 64),
    'both',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
);

INSERT INTO public.release_prds (
    id,
    release_id,
    raw_markdown,
    original_filename,
    source_type,
    source_reference,
    source_content_sha256,
    intended_surface,
    created_by,
    updated_by
) VALUES (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    '# Domani 1.12.0',
    'domani-1.12.0.md',
    'linear_epic',
    'DEV-1004',
    repeat('b', 64),
    'both',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
);

DO $$
BEGIN
    BEGIN
        UPDATE public.release_prds
        SET raw_markdown = '# Changed'
        WHERE id = '30000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'expected immutable Markdown rejection';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO public.release_prds (
            release_id,
            raw_markdown,
            source_type,
            source_reference,
            source_content_sha256,
            created_by,
            updated_by
        ) VALUES (
            '20000000-0000-4000-8000-000000000001',
            '# Replacement',
            'linear_epic',
            'DEV-1004',
            repeat('b', 64),
            '10000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'expected one-current-source rejection';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;
END;
$$;

DO $$
BEGIN
    BEGIN
        INSERT INTO public.release_conversion_runs (
            release_id,
            prd_id,
            source_content_sha256,
            converter_version,
            status,
            created_by
        ) VALUES (
            '20000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001',
            repeat('c', 64),
            'domani-markdown-v1',
            'running',
            '10000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'expected conversion source-hash mismatch rejection';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO public.release_conversion_runs (
            release_id,
            prd_id,
            source_content_sha256,
            converter_version,
            status,
            created_by
        ) VALUES (
            '20000000-0000-4000-8000-000000000002',
            '30000000-0000-4000-8000-000000000001',
            repeat('a', 64),
            'domani-markdown-v1',
            'running',
            '10000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'expected cross-release conversion source rejection';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;
END;
$$;

INSERT INTO public.release_conversion_runs (
    id,
    release_id,
    prd_id,
    source_content_sha256,
    converter_version,
    status,
    created_by
) VALUES (
    '40000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    'domani-markdown-v1',
    'running',
    '10000000-0000-4000-8000-000000000001'
);

INSERT INTO public.release_conversion_runs (
    id,
    release_id,
    prd_id,
    source_content_sha256,
    converter_version,
    status,
    created_by
) VALUES (
    '40000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    repeat('b', 64),
    'domani-markdown-v1',
    'running',
    '10000000-0000-4000-8000-000000000001'
);

UPDATE public.release_prds
SET latest_conversion_run_id = '40000000-0000-4000-8000-000000000001'
WHERE id = '30000000-0000-4000-8000-000000000001';

DO $$
BEGIN
    BEGIN
        UPDATE public.release_prds
        SET latest_conversion_run_id = '40000000-0000-4000-8000-000000000002'
        WHERE id = '30000000-0000-4000-8000-000000000001';

        SET CONSTRAINTS release_prds_latest_conversion_fk IMMEDIATE;
        RAISE EXCEPTION 'expected latest conversion run source mismatch rejection';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    SET CONSTRAINTS release_prds_latest_conversion_fk DEFERRED;
END;
$$;

INSERT INTO public.release_notes (
    id,
    release_id,
    note_type,
    public_title,
    public_body,
    technical_notes,
    platforms,
    sort_order,
    source_prd_id,
    source_conversion_run_id,
    created_by,
    updated_by
) VALUES (
    '50000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'feature',
    'Guided planning',
    'Plan tomorrow with a calmer walkthrough.',
    'Private implementation detail.',
    ARRAY['ios', 'android']::public.release_platform[],
    0,
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO public.release_notes (
            release_id,
            note_type,
            public_title,
            public_body,
            platforms,
            sort_order,
            source_prd_id,
            source_conversion_run_id,
            created_by,
            updated_by
        ) VALUES (
            '20000000-0000-4000-8000-000000000002',
            'feature',
            'Cross-release generated note',
            'This generated note must be rejected.',
            ARRAY['ios']::public.release_platform[],
            0,
            '30000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'expected cross-release generated-note source rejection';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;
END;
$$;

DO $$
BEGIN
    BEGIN
        INSERT INTO public.release_notes (
            release_id,
            note_type,
            public_title,
            public_body,
            platforms,
            sort_order,
            created_by,
            updated_by
        ) VALUES (
            '20000000-0000-4000-8000-000000000001',
            'fix',
            'Duplicate platform',
            'This note must be rejected.',
            ARRAY['ios', 'ios']::public.release_platform[],
            1,
            '10000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'expected duplicate-platform rejection';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO public.release_notes (
            release_id,
            note_type,
            public_title,
            public_body,
            platforms,
            sort_order,
            created_by,
            updated_by
        ) VALUES (
            '20000000-0000-4000-8000-000000000001',
            'fix',
            'Duplicate order',
            'This note must be rejected.',
            ARRAY['ios']::public.release_platform[],
            0,
            '10000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'expected active-order rejection';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;
END;
$$;

INSERT INTO public.release_audit_events (
    id,
    actor_user_id,
    actor_email,
    actor_role,
    action,
    entity_type,
    entity_id,
    release_id,
    request_id,
    after_data
) VALUES (
    '60000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'admin@pixelversestudios.com',
    'admin',
    'release.created',
    'release',
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'req-dev-1006',
    '{"version":"1.12"}'::jsonb
);

DO $$
BEGIN
    BEGIN
        UPDATE public.release_audit_events
        SET action = 'release.updated'
        WHERE id = '60000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'expected immutable audit rejection';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO public.release_audit_events (
            actor_user_id,
            actor_email,
            actor_role,
            action,
            entity_type,
            entity_id,
            release_id,
            request_id
        ) VALUES (
            '10000000-0000-4000-8000-000000000001',
            'admin@pixelversestudios.com',
            'admin',
            'release.unknown',
            'release',
            '20000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001',
            'req-invalid-action'
        );
        RAISE EXCEPTION 'expected unknown audit action rejection';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

INSERT INTO public.release_cache_invalidation_jobs (
    release_id,
    event_key,
    targets
) VALUES (
    '20000000-0000-4000-8000-000000000001',
    'release.created:60000000-0000-4000-8000-000000000001',
    ARRAY['/api/domani/releases/coming-soon', '/coming-soon']
);

DO $$
BEGIN
    BEGIN
        INSERT INTO public.release_cache_invalidation_jobs (
            release_id,
            event_key,
            targets
        ) VALUES (
            '20000000-0000-4000-8000-000000000001',
            'invalid-duplicate-targets',
            ARRAY['/changelog', '/changelog']
        );
        RAISE EXCEPTION 'expected duplicate cache-target rejection';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END;
$$;

SELECT pg_temp.assert_true(
    NOT EXISTS (
        SELECT 1
        FROM information_schema.views
        WHERE table_schema = 'public'
          AND table_name LIKE 'release%'
    ),
    'migration must not create a broad public view over private fields'
);

ROLLBACK;
