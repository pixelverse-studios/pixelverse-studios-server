-- DEV-1007 repeatable public feed verification.
-- Run after migrations with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/dev_1007_public_release_feed_test.sql

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
        'public.list_public_domani_releases(text, public.release_platform, integer, text, integer, integer, integer, uuid)',
        'EXECUTE'
    )
    AND NOT has_function_privilege(
        'anon',
        'public.list_public_domani_releases(text, public.release_platform, integer, text, integer, integer, integer, uuid)',
        'EXECUTE'
    )
    AND NOT has_function_privilege(
        'authenticated',
        'public.list_public_domani_releases(text, public.release_platform, integer, text, integer, integer, integer, uuid)',
        'EXECUTE'
    ),
    'only service_role may execute the public release feed RPC'
);

INSERT INTO public.releases (
    id,
    version,
    slug,
    title,
    release_type,
    lifecycle_status,
    visibility,
    public_summary,
    target_month,
    confirmed_date,
    released_at,
    created_by,
    updated_by
) VALUES
    (
        '72000000-0000-4000-8000-000000000001',
        '900000001.1.0',
        'feed-first-preview',
        'First preview',
        'minor',
        'planned',
        'public_preview',
        'First preview summary.',
        NULL,
        '2026-09-15',
        NULL,
        '71000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001'
    ),
    (
        '72000000-0000-4000-8000-000000000002',
        '900000001.2.0',
        'feed-second-preview',
        'Second preview',
        'minor',
        'in_progress',
        'public_preview',
        'Second preview summary.',
        '2026-10-01',
        NULL,
        NULL,
        '71000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001'
    ),
    (
        '72000000-0000-4000-8000-000000000003',
        '900000001.3.0',
        'feed-untimed-preview',
        'Untimed preview',
        'minor',
        'planned',
        'public_preview',
        'Untimed preview summary.',
        NULL,
        NULL,
        NULL,
        '71000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001'
    ),
    (
        '72000000-0000-4000-8000-000000000004',
        '900000001.3.1',
        'feed-older-release',
        'Older release',
        'patch',
        'released',
        'published',
        'Older release summary.',
        NULL,
        NULL,
        '2026-08-01T12:00:00Z',
        '71000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001'
    ),
    (
        '72000000-0000-4000-8000-000000000005',
        '900000001.3.2',
        'feed-newer-release',
        'Newer release',
        'patch',
        'released',
        'published',
        'Newer release summary.',
        NULL,
        NULL,
        '2026-08-02T12:00:00Z',
        '71000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001'
    ),
    (
        '72000000-0000-4000-8000-000000000006',
        '900000001.4.0',
        'feed-canonical-release',
        'Canonical release',
        'minor',
        'released',
        'published',
        'Canonical release summary.',
        NULL,
        NULL,
        '2026-08-02T12:00:00Z',
        '71000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001'
    );

INSERT INTO public.release_notes (
    id,
    release_id,
    note_type,
    public_title,
    public_body,
    platforms,
    is_public,
    sort_order,
    created_by,
    updated_by
) VALUES
    (
        '73000000-0000-4000-8000-000000000001',
        '72000000-0000-4000-8000-000000000001',
        'feature',
        'First preview note',
        'First preview body.',
        ARRAY['ios']::public.release_platform[],
        true,
        0,
        '71000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001'
    ),
    (
        '73000000-0000-4000-8000-000000000002',
        '72000000-0000-4000-8000-000000000002',
        'improvement',
        'Second preview note',
        'Second preview body.',
        ARRAY['android']::public.release_platform[],
        true,
        0,
        '71000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001'
    ),
    (
        '73000000-0000-4000-8000-000000000003',
        '72000000-0000-4000-8000-000000000003',
        'feature',
        'Untimed preview note',
        'Untimed preview body.',
        ARRAY['ios', 'android']::public.release_platform[],
        true,
        0,
        '71000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001'
    ),
    (
        '73000000-0000-4000-8000-000000000004',
        '72000000-0000-4000-8000-000000000004',
        'fix',
        'Older release note',
        'Older release body.',
        ARRAY['ios', 'android']::public.release_platform[],
        true,
        0,
        '71000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001'
    ),
    (
        '73000000-0000-4000-8000-000000000005',
        '72000000-0000-4000-8000-000000000005',
        'fix',
        'Newer release note',
        'Newer release body.',
        ARRAY['ios', 'android']::public.release_platform[],
        true,
        0,
        '71000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001'
    ),
    (
        '73000000-0000-4000-8000-000000000006',
        '72000000-0000-4000-8000-000000000006',
        'feature',
        'Canonical release note',
        'Canonical release body.',
        ARRAY['ios', 'android']::public.release_platform[],
        true,
        0,
        '71000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001'
    );

SET LOCAL ROLE service_role;

SELECT pg_temp.assert_true(
    (
        SELECT array_agg(feed.id ORDER BY feed.ordinality)
            = ARRAY[
                '72000000-0000-4000-8000-000000000001'::uuid,
                '72000000-0000-4000-8000-000000000002'::uuid
            ]
        FROM public.list_public_domani_releases(
            'coming-soon', NULL, 1, NULL, NULL, NULL, NULL, NULL
        ) WITH ORDINALITY AS feed
    ),
    'coming-soon returns the ordered row plus one lookahead row'
);

SELECT pg_temp.assert_true(
    (
        SELECT array_agg(feed.id ORDER BY feed.ordinality)
            = ARRAY[
                '72000000-0000-4000-8000-000000000002'::uuid,
                '72000000-0000-4000-8000-000000000003'::uuid
            ]
        FROM public.list_public_domani_releases(
            'coming-soon',
            NULL,
            20,
            '2026-09-15',
            900000001,
            1,
            0,
            '72000000-0000-4000-8000-000000000001'
        ) WITH ORDINALITY AS feed
    ),
    'coming-soon keyset resumes after a timed cursor and keeps untimed rows last'
);

SELECT pg_temp.assert_true(
    (
        SELECT array_agg(feed.id ORDER BY feed.ordinality)
            = ARRAY[
                '72000000-0000-4000-8000-000000000002'::uuid,
                '72000000-0000-4000-8000-000000000003'::uuid
            ]
        FROM public.list_public_domani_releases(
            'coming-soon', 'android', 20, NULL, NULL, NULL, NULL, NULL
        ) WITH ORDINALITY AS feed
    ),
    'platform filtering omits releases without matching public notes'
);

SELECT pg_temp.assert_true(
    (
        SELECT array_agg(feed.id ORDER BY feed.ordinality)
            = ARRAY[
                '72000000-0000-4000-8000-000000000006'::uuid,
                '72000000-0000-4000-8000-000000000005'::uuid,
                '72000000-0000-4000-8000-000000000004'::uuid
            ]
        FROM public.list_public_domani_releases(
            'changelog', NULL, 20, NULL, NULL, NULL, NULL, NULL
        ) WITH ORDINALITY AS feed
    ),
    'changelog orders released entries newest first'
);

SELECT pg_temp.assert_true(
    (
        SELECT array_agg(feed.id ORDER BY feed.ordinality)
            = ARRAY['72000000-0000-4000-8000-000000000004'::uuid]
        FROM public.list_public_domani_releases(
            'changelog',
            NULL,
            20,
            '2026-08-02 12:00:00+00',
            900000001,
            3,
            2,
            '72000000-0000-4000-8000-000000000005'
        ) WITH ORDINALITY AS feed
    ),
    'changelog keyset resumes after the newest released entry'
);

SELECT pg_temp.assert_true(
    (
        SELECT array_agg(feed.id ORDER BY feed.ordinality)
            = ARRAY[
                '72000000-0000-4000-8000-000000000005'::uuid,
                '72000000-0000-4000-8000-000000000004'::uuid
            ]
        FROM public.list_public_domani_releases(
            'changelog',
            NULL,
            20,
            '2026-08-02 12:00:00+00',
            900000001,
            4,
            -1,
            '72000000-0000-4000-8000-000000000006'
        ) WITH ORDINALITY AS feed
    ),
    'canonical changelog cursor advances without repeating its release'
);

RESET ROLE;
ROLLBACK;
