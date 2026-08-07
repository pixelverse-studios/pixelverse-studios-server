-- DEV-1009 repeatable transactional Markdown conversion verification.
-- Run after migrations with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/dev_1009_convert_markdown_test.sql

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
        'public.convert_domani_release_markdown(uuid, uuid, bigint, bigint, text, jsonb, text, text, uuid, text, public.dashboard_role, text)',
        'EXECUTE'
    )
    AND NOT has_function_privilege(
        'anon',
        'public.convert_domani_release_markdown(uuid, uuid, bigint, bigint, text, jsonb, text, text, uuid, text, public.dashboard_role, text)',
        'EXECUTE'
    )
    AND NOT has_function_privilege(
        'authenticated',
        'public.convert_domani_release_markdown(uuid, uuid, bigint, bigint, text, jsonb, text, text, uuid, text, public.dashboard_role, text)',
        'EXECUTE'
    ),
    'only service_role may execute the conversion RPC'
);

INSERT INTO auth.users (id) VALUES
    ('91000000-0000-4000-8000-000000000001'),
    ('91000000-0000-4000-8000-000000000002');

INSERT INTO public.dashboard_user_roles (user_id, role)
VALUES
    ('91000000-0000-4000-8000-000000000001', 'editor'),
    ('91000000-0000-4000-8000-000000000002', 'admin');

INSERT INTO public.releases (
    id, version, slug, title, release_type, lifecycle_status, visibility,
    created_by, updated_by
) VALUES (
    '91000000-0000-4000-8000-000000000010',
    '910000000.1',
    'dev-1009-conversion',
    'DEV-1009 conversion',
    'minor',
    'draft',
    'private',
    '91000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001'
);

INSERT INTO public.release_prds (
    id, release_id, raw_markdown, original_filename, source_type,
    source_reference, source_content_sha256, intended_surface,
    created_by, updated_by
) VALUES (
    '91000000-0000-4000-8000-000000000011',
    '91000000-0000-4000-8000-000000000010',
    '## Feature: Calm setup',
    'release.md',
    'manual',
    'DEV-1009',
    repeat('a', 64),
    'changelog',
    '91000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001'
);

INSERT INTO public.release_notes (
    id, release_id, note_type, public_title, public_body, platforms,
    is_public, sort_order, created_by, updated_by
) VALUES (
    '91000000-0000-4000-8000-000000000012',
    '91000000-0000-4000-8000-000000000010',
    'improvement',
    'Manual note',
    'This note must survive every conversion.',
    ARRAY['ios']::public.release_platform[],
    false,
    0,
    '91000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001'
);

CREATE TEMP TABLE conversion_results (payload jsonb);
GRANT SELECT, INSERT, DELETE, TRUNCATE ON conversion_results TO service_role;

SET LOCAL ROLE service_role;

INSERT INTO conversion_results (payload)
SELECT public.convert_domani_release_markdown(
    '91000000-0000-4000-8000-000000000010',
    '91000000-0000-4000-8000-000000000011',
    1,
    1,
    'domani-markdown-v1',
    '[
      {"noteType":"feature","publicTitle":"Calm setup","publicBody":"Guided setup.","technicalNotes":null,"platforms":["ios","android"]},
      {"noteType":"fix","publicTitle":"Crash recovery","publicBody":"Restores plans.","technicalNotes":null,"platforms":["ios","android"]}
    ]'::jsonb,
    NULL,
    NULL,
    '91000000-0000-4000-8000-000000000001',
    'editor@example.com',
    'editor',
    'dev-1009-success'
);

SELECT pg_temp.assert_true(
    (SELECT payload->'source'->>'conversionStatus' = 'needs_review'
         AND payload->'source'->>'rowVersion' = '2'
         AND payload->>'releaseRowVersion' = '2'
         AND payload->'conversionRun'->>'status' = 'succeeded'
         AND jsonb_array_length(payload->'notes') = 2
     FROM conversion_results)
    AND (
        SELECT count(*) = 2
           AND bool_and(is_public = false)
           AND bool_and(technical_notes IS NULL)
           AND min(sort_order) = 1
           AND max(sort_order) = 2
           AND count(DISTINCT source_conversion_run_id) = 1
        FROM public.release_notes
        WHERE source_prd_id = '91000000-0000-4000-8000-000000000011'
          AND archived_at IS NULL
    )
    AND (
        SELECT raw_markdown = '## Feature: Calm setup'
        FROM public.release_prds
        WHERE id = '91000000-0000-4000-8000-000000000011'
    ),
    'conversion creates only private provenance-linked drafts after manual notes and preserves raw Markdown'
);

SELECT pg_temp.assert_true(
    (
        SELECT count(*) = 2
           AND bool_and(before_data IS NULL)
           AND bool_and(NOT COALESCE(after_data, '{}'::jsonb) ? 'rawMarkdown')
           AND bool_and(COALESCE(after_data, '{}'::jsonb)::text NOT LIKE '%Feature: Calm setup%')
        FROM public.release_audit_events
        WHERE release_id = '91000000-0000-4000-8000-000000000010'
          AND action IN ('conversion.started', 'conversion.succeeded')
    ),
    'conversion emits lifecycle audits without raw Markdown'
);

-- Simulate a human edit. Reruns may archive pristine generated drafts, but must
-- retain any generated note that a person has edited or made public.
UPDATE public.release_notes
SET public_body = 'Human-edited body.', is_public = true, row_version = row_version + 1
WHERE source_prd_id = '91000000-0000-4000-8000-000000000011'
  AND public_title = 'Calm setup';

TRUNCATE conversion_results;
INSERT INTO conversion_results (payload)
SELECT public.convert_domani_release_markdown(
    '91000000-0000-4000-8000-000000000010',
    '91000000-0000-4000-8000-000000000011',
    2,
    2,
    'domani-markdown-v1',
    '[{"noteType":"improvement","publicTitle":"Replacement draft","publicBody":"Fresh conversion.","technicalNotes":null,"platforms":["ios","android"]}]'::jsonb,
    NULL,
    NULL,
    '91000000-0000-4000-8000-000000000001',
    'editor@example.com',
    'editor',
    'dev-1009-rerun'
);

SELECT pg_temp.assert_true(
    (
        SELECT count(*) FILTER (WHERE status = 'superseded') = 1
           AND count(*) FILTER (WHERE status = 'succeeded') = 1
        FROM public.release_conversion_runs
        WHERE prd_id = '91000000-0000-4000-8000-000000000011'
    )
    AND (
        SELECT count(*) FILTER (WHERE public_title = 'Crash recovery' AND archived_at IS NOT NULL) = 1
           AND count(*) FILTER (WHERE public_title = 'Calm setup' AND archived_at IS NULL AND row_version = 2 AND is_public) = 1
           AND count(*) FILTER (WHERE public_title = 'Replacement draft' AND archived_at IS NULL AND sort_order = 2) = 1
           AND count(*) FILTER (WHERE public_title = 'Manual note' AND archived_at IS NULL AND sort_order = 0) = 1
        FROM public.release_notes
        WHERE release_id = '91000000-0000-4000-8000-000000000010'
    )
    AND (
        SELECT row_version = 3 AND conversion_status = 'needs_review'
        FROM public.release_prds
        WHERE id = '91000000-0000-4000-8000-000000000011'
    )
    AND (
        SELECT row_version = 3
        FROM public.releases
        WHERE id = '91000000-0000-4000-8000-000000000010'
    ),
    'rerun supersedes its prior run, archives only pristine drafts, and preserves edited/manual notes'
);

-- Failed deterministic conversion is also persisted atomically, without notes.
TRUNCATE conversion_results;
INSERT INTO conversion_results (payload)
SELECT public.convert_domani_release_markdown(
    '91000000-0000-4000-8000-000000000010',
    '91000000-0000-4000-8000-000000000011',
    3,
    3,
    'domani-markdown-v1',
    NULL,
    'NO_CONVERSION_CANDIDATES',
    'No eligible release notes were found.',
    '91000000-0000-4000-8000-000000000001',
    'editor@example.com',
    'editor',
    'dev-1009-failure'
);

SELECT pg_temp.assert_true(
    (SELECT payload->>'failed' = 'true' FROM conversion_results)
    AND (
        SELECT conversion_status = 'failed'
           AND conversion_error_code = 'NO_CONVERSION_CANDIDATES'
           AND row_version = 4
           AND raw_markdown = '## Feature: Calm setup'
        FROM public.release_prds
        WHERE id = '91000000-0000-4000-8000-000000000011'
    )
    AND (
        SELECT row_version = 4
        FROM public.releases
        WHERE id = '91000000-0000-4000-8000-000000000010'
    )
    AND (
        SELECT count(*) FILTER (WHERE status = 'failed') = 1
        FROM public.release_conversion_runs
        WHERE prd_id = '91000000-0000-4000-8000-000000000011'
    ),
    'content failure records a failed run and source status without creating notes'
);

DO $$
DECLARE
    v_runs integer;
BEGIN
    SELECT count(*) INTO v_runs
    FROM public.release_conversion_runs
    WHERE prd_id = '91000000-0000-4000-8000-000000000011';

    BEGIN
        PERFORM public.convert_domani_release_markdown(
            '91000000-0000-4000-8000-000000000010',
            '91000000-0000-4000-8000-000000000011',
            3, 4, 'domani-markdown-v1',
            '[{"noteType":"fix","publicTitle":"Stale source","publicBody":"No mutation.","technicalNotes":null,"platforms":["ios","android"]}]'::jsonb,
            NULL, NULL,
            '91000000-0000-4000-8000-000000000001',
            'editor@example.com', 'editor', 'dev-1009-stale-source'
        );
        RAISE EXCEPTION 'expected source version conflict';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'DEV1009_SOURCE_VERSION_CONFLICT' THEN RAISE; END IF;
    END;

    BEGIN
        PERFORM public.convert_domani_release_markdown(
            '91000000-0000-4000-8000-000000000010',
            '91000000-0000-4000-8000-000000000011',
            4, 3, 'domani-markdown-v1',
            '[{"noteType":"fix","publicTitle":"Stale release","publicBody":"No mutation.","technicalNotes":null,"platforms":["ios","android"]}]'::jsonb,
            NULL, NULL,
            '91000000-0000-4000-8000-000000000001',
            'editor@example.com', 'editor', 'dev-1009-stale-release'
        );
        RAISE EXCEPTION 'expected release version conflict';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'DEV1009_RELEASE_VERSION_CONFLICT' THEN RAISE; END IF;
    END;

    IF (SELECT count(*) FROM public.release_conversion_runs
        WHERE prd_id = '91000000-0000-4000-8000-000000000011') <> v_runs THEN
        RAISE EXCEPTION 'version conflicts left conversion runs behind';
    END IF;
END;
$$;

RESET ROLE;

UPDATE public.releases
SET lifecycle_status = 'released',
    visibility = 'published',
    public_summary = 'Published fixture',
    released_at = now()
WHERE id = '91000000-0000-4000-8000-000000000010';

SET LOCAL ROLE service_role;

DO $$
BEGIN
    BEGIN
        PERFORM public.convert_domani_release_markdown(
            '91000000-0000-4000-8000-000000000010',
            '91000000-0000-4000-8000-000000000011',
            4, 4, 'domani-markdown-v1',
            '[{"noteType":"fix","publicTitle":"Editor blocked","publicBody":"Published boundary.","technicalNotes":null,"platforms":["ios","android"]}]'::jsonb,
            NULL, NULL,
            '91000000-0000-4000-8000-000000000001',
            'editor@example.com', 'editor', 'dev-1009-published-editor'
        );
        RAISE EXCEPTION 'expected published editor rejection';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'DEV1009_PUBLISHED_ADMIN_REQUIRED' THEN RAISE; END IF;
    END;
END;
$$;

TRUNCATE conversion_results;
INSERT INTO conversion_results (payload)
SELECT public.convert_domani_release_markdown(
    '91000000-0000-4000-8000-000000000010',
    '91000000-0000-4000-8000-000000000011',
    4,
    4,
    'domani-markdown-v1',
    '[{"noteType":"fix","publicTitle":"Admin conversion","publicBody":"Explicit published mutation.","technicalNotes":null,"platforms":["ios","android"]}]'::jsonb,
    NULL,
    NULL,
    '91000000-0000-4000-8000-000000000002',
    'admin@example.com',
    'admin',
    'dev-1009-published-admin'
);

SELECT pg_temp.assert_true(
    (SELECT payload->'conversionRun'->>'status' = 'succeeded' FROM conversion_results)
    AND (
        SELECT row_version = 5
        FROM public.releases
        WHERE id = '91000000-0000-4000-8000-000000000010'
    ),
    'admin may explicitly convert against the published aggregate boundary'
);

RESET ROLE;
UPDATE public.release_prds
SET conversion_status = 'superseded'
WHERE id = '91000000-0000-4000-8000-000000000011';
SET LOCAL ROLE service_role;

DO $$
BEGIN
    BEGIN
        PERFORM public.convert_domani_release_markdown(
            '91000000-0000-4000-8000-000000000010',
            '91000000-0000-4000-8000-000000000011',
            5, 5, 'domani-markdown-v1',
            '[{"noteType":"fix","publicTitle":"Superseded","publicBody":"No mutation.","technicalNotes":null,"platforms":["ios","android"]}]'::jsonb,
            NULL, NULL,
            '91000000-0000-4000-8000-000000000002',
            'admin@example.com', 'admin', 'dev-1009-superseded'
        );
        RAISE EXCEPTION 'expected superseded source rejection';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'DEV1009_SOURCE_SUPERSEDED' THEN RAISE; END IF;
    END;
END;
$$;

ROLLBACK;
