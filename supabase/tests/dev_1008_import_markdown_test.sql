-- DEV-1008 repeatable transactional Markdown import verification.
-- Run after migrations with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/dev_1008_import_markdown_test.sql

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
    has_function_privilege(
        'service_role',
        'public.import_domani_release_markdown(uuid, text, text, text, public.release_type, public.release_source_type, text, text, text, text, public.release_intended_surface, bigint, uuid, text, public.dashboard_role, text)',
        'EXECUTE'
    )
    AND NOT has_function_privilege(
        'anon',
        'public.import_domani_release_markdown(uuid, text, text, text, public.release_type, public.release_source_type, text, text, text, text, public.release_intended_surface, bigint, uuid, text, public.dashboard_role, text)',
        'EXECUTE'
    )
    AND NOT has_function_privilege(
        'authenticated',
        'public.import_domani_release_markdown(uuid, text, text, text, public.release_type, public.release_source_type, text, text, text, text, public.release_intended_surface, bigint, uuid, text, public.dashboard_role, text)',
        'EXECUTE'
    ),
    'only service_role may execute the Markdown import RPC'
);

INSERT INTO auth.users (id) VALUES
    ('81000000-0000-4000-8000-000000000001'),
    ('81000000-0000-4000-8000-000000000002');

INSERT INTO public.dashboard_user_roles (user_id, role)
VALUES
    ('81000000-0000-4000-8000-000000000001', 'editor'),
    ('81000000-0000-4000-8000-000000000002', 'admin');

CREATE TEMP TABLE import_results (payload jsonb);
GRANT SELECT, INSERT, DELETE, TRUNCATE ON import_results TO service_role;

SET LOCAL ROLE service_role;

INSERT INTO import_results (payload)
SELECT public.import_domani_release_markdown(
    NULL,
    '800000001.1',
    'Imported release',
    'dev-1008-imported-release',
    'minor',
    'linear_epic',
    'DEV-1004',
    '# Imported release',
    'release.md',
    encode(digest('# Imported release', 'sha256'), 'hex'),
    'changelog',
    NULL,
    '81000000-0000-4000-8000-000000000001',
    'editor@example.com',
    'editor',
    'dev-1008-create'
);

SELECT pg_temp.assert_true(
    (
        SELECT payload->>'duplicate' = 'false'
           AND payload->'release'->>'rowVersion' = '1'
           AND payload->'release'->>'visibility' = 'private'
           AND payload->'source'->>'rawMarkdown' = '# Imported release'
           AND payload->'source'->>'conversionStatus' = 'raw'
        FROM import_results
        LIMIT 1
    ),
    'new-version import creates a private draft release and raw source'
);

SELECT pg_temp.assert_true(
    (
        SELECT count(*) = 2
        FROM public.release_audit_events AS event
        JOIN public.releases AS release ON release.id = event.release_id
        WHERE release.version = '800000001.1'
          AND event.action IN ('release.created', 'source.imported')
          AND event.before_data IS NULL
          AND NOT (event.after_data ? 'rawMarkdown')
          AND event.after_data::text NOT LIKE '%# Imported release%'
    ),
    'creation and source import are audited without raw Markdown'
);

TRUNCATE import_results;

INSERT INTO import_results (payload)
SELECT public.import_domani_release_markdown(
    NULL,
    '800000001.1',
    NULL,
    NULL,
    NULL,
    'linear_epic',
    'DEV-1004',
    '# Imported release',
    'release.md',
    encode(digest('# Imported release', 'sha256'), 'hex'),
    'changelog',
    1,
    '81000000-0000-4000-8000-000000000001',
    'editor@example.com',
    'editor',
    'dev-1008-duplicate'
);

SELECT pg_temp.assert_true(
    (SELECT payload->>'duplicate' = 'true' FROM import_results LIMIT 1)
    AND (
        SELECT row_version = 1
        FROM public.releases
        WHERE version = '800000001.1'
    )
    AND (
        SELECT count(*) = 2
        FROM public.release_audit_events AS event
        JOIN public.releases AS release ON release.id = event.release_id
        WHERE release.version = '800000001.1'
    ),
    'exact duplicate is read-only and emits no audit event'
);

DO $$
DECLARE
    v_release_id uuid;
BEGIN
    SELECT id INTO v_release_id
    FROM public.releases
    WHERE version = '800000001.1';

    BEGIN
        PERFORM public.import_domani_release_markdown(
            v_release_id,
            NULL,
            NULL,
            NULL,
            NULL,
            'linear_epic',
            'DEV-1004',
            '# Imported release',
            'release.md',
            encode(digest('# Imported release', 'sha256'), 'hex'),
            'both',
            1,
            '81000000-0000-4000-8000-000000000001',
            'editor@example.com',
            'editor',
            'dev-1008-conflict'
        );
        RAISE EXCEPTION 'expected idempotency conflict';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'DEV1008_IDEMPOTENCY_CONFLICT' THEN
            RAISE;
        END IF;
    END;
END;
$$;

TRUNCATE import_results;

INSERT INTO import_results (payload)
SELECT public.import_domani_release_markdown(
    release.id,
    NULL,
    NULL,
    NULL,
    NULL,
    'linear_epic',
    'DEV-1004',
    '# Revised source',
    'release-v2.md',
    encode(digest('# Revised source', 'sha256'), 'hex'),
    'both',
    1,
    '81000000-0000-4000-8000-000000000001',
    'editor@example.com',
    'editor',
    'dev-1008-revision'
)
FROM public.releases AS release
WHERE release.version = '800000001.1';

SELECT pg_temp.assert_true(
    (
        SELECT row_version = 2
        FROM public.releases
        WHERE version = '800000001.1'
    )
    AND (
        SELECT count(*) FILTER (WHERE conversion_status = 'superseded') = 1
           AND count(*) FILTER (WHERE conversion_status = 'raw') = 1
        FROM public.release_prds AS source
        JOIN public.releases AS release ON release.id = source.release_id
        WHERE release.version = '800000001.1'
    )
    AND (
        SELECT count(*) FILTER (WHERE action = 'source.imported') = 2
           AND count(*) FILTER (WHERE action = 'source.superseded') = 1
        FROM public.release_audit_events AS event
        JOIN public.releases AS release ON release.id = event.release_id
        WHERE release.version = '800000001.1'
    ),
    'changed source supersedes history, audits both changes, and increments aggregate once'
);

TRUNCATE import_results;

INSERT INTO import_results (payload)
SELECT public.import_domani_release_markdown(
    release.id,
    NULL,
    NULL,
    NULL,
    NULL,
    'linear_epic',
    'DEV-1004',
    '# Revised source',
    'release-v2.md',
    encode(digest('# Revised source', 'sha256'), 'hex'),
    'both',
    1,
    '81000000-0000-4000-8000-000000000001',
    'editor@example.com',
    'editor',
    'dev-1008-revision-retry'
)
FROM public.releases AS release
WHERE release.version = '800000001.1';

SELECT pg_temp.assert_true(
    (SELECT payload->>'duplicate' = 'true' FROM import_results LIMIT 1)
    AND (
        SELECT row_version = 2
        FROM public.releases
        WHERE version = '800000001.1'
    ),
    'exact retry remains idempotent after the original import increments the aggregate'
);

DO $$
DECLARE
    v_release_id uuid;
    v_source_count integer;
BEGIN
    SELECT id INTO v_release_id
    FROM public.releases
    WHERE version = '800000001.1';
    SELECT count(*) INTO v_source_count
    FROM public.release_prds
    WHERE release_id = v_release_id;

    BEGIN
        PERFORM public.import_domani_release_markdown(
            v_release_id,
            NULL,
            NULL,
            NULL,
            NULL,
            'manual',
            'stale-test',
            '# Stale write',
            NULL,
            encode(digest('# Stale write', 'sha256'), 'hex'),
            'changelog',
            1,
            '81000000-0000-4000-8000-000000000001',
            'editor@example.com',
            'editor',
            'dev-1008-stale'
        );
        RAISE EXCEPTION 'expected version conflict';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'DEV1008_VERSION_CONFLICT' THEN
            RAISE;
        END IF;
    END;

    PERFORM pg_temp.assert_true(
        (SELECT count(*) FROM public.release_prds WHERE release_id = v_release_id) = v_source_count,
        'stale import must not create a source'
    );
END;
$$;

SELECT pg_temp.assert_true(
    NOT EXISTS (
        SELECT 1
        FROM public.release_notes AS note
        JOIN public.releases AS release ON release.id = note.release_id
        WHERE release.version = '800000001.1'
    ),
    'import never creates release notes'
);

RESET ROLE;
ROLLBACK;
