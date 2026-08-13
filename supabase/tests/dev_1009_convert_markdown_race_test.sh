#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is required" >&2
    exit 1
fi

actor_id="92000000-0000-4000-8000-000000000001"
release_id="92000000-0000-4000-8000-000000000002"
prd_id="92000000-0000-4000-8000-000000000003"
publisher_pid=""

cleanup() {
    if [[ -n "$publisher_pid" ]]; then
        wait "$publisher_pid" 2>/dev/null || true
    fi
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
        -v actor_id="$actor_id" -v release_id="$release_id" <<'SQL'
DELETE FROM public.release_audit_events WHERE release_id = :'release_id';
DELETE FROM public.release_notes WHERE release_id = :'release_id';
UPDATE public.release_prds SET latest_conversion_run_id = NULL WHERE release_id = :'release_id';
DELETE FROM public.release_conversion_runs WHERE release_id = :'release_id';
DELETE FROM public.release_prds WHERE release_id = :'release_id';
DELETE FROM public.releases WHERE id = :'release_id';
SQL
}
trap cleanup EXIT

cleanup

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -v actor_id="$actor_id" -v release_id="$release_id" -v prd_id="$prd_id" <<'SQL'
INSERT INTO public.releases (
    id, version, slug, title, release_type, lifecycle_status, visibility,
    public_summary, created_by, updated_by
) VALUES (
    :'release_id',
    '920000000.1',
    'dev-1009-lock-race',
    'DEV-1009 lock race',
    'minor',
    'planned',
    'public_preview',
    'Lock-race fixture',
    :'actor_id',
    :'actor_id'
);
INSERT INTO public.release_prds (
    id, release_id, raw_markdown, source_type, source_reference,
    source_content_sha256, intended_surface, created_by, updated_by
) VALUES (
    :'prd_id',
    :'release_id',
    '## Fix: Must not convert',
    'manual',
    'lock-race',
    repeat('b', 64),
    'changelog',
    :'actor_id',
    :'actor_id'
);
SQL

PGAPPNAME=dev1009-publisher psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -v release_id="$release_id" <<'SQL' &
BEGIN;
UPDATE public.releases
SET lifecycle_status = 'released',
    visibility = 'published',
    released_at = now(),
    row_version = row_version + 1
WHERE id = :'release_id';
SELECT pg_sleep(2);
COMMIT;
SQL
publisher_pid=$!

publisher_ready="false"
for _ in {1..100}; do
    publisher_ready="$(psql "$DATABASE_URL" -Atqc \
        "SELECT EXISTS (
            SELECT 1
            FROM pg_stat_activity
            WHERE application_name = 'dev1009-publisher'
              AND wait_event = 'PgSleep'
        )")"
    if [[ "$publisher_ready" == "t" ]]; then
        break
    fi
    sleep 0.05
done

if [[ "$publisher_ready" != "t" ]]; then
    echo "Publisher transaction did not acquire the release lock" >&2
    exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SET ROLE service_role;
DO $$
BEGIN
    BEGIN
        PERFORM public.convert_domani_release_markdown(
            '92000000-0000-4000-8000-000000000002',
            '92000000-0000-4000-8000-000000000003',
            1,
            1,
            'domani-markdown-v1',
            '[{"noteType":"fix","publicTitle":"Must not convert","publicBody":"Stale authorization.","technicalNotes":null,"platforms":["ios","android"]}]'::jsonb,
            NULL,
            NULL,
            '92000000-0000-4000-8000-000000000001',
            'editor@example.com',
            'editor',
            'dev-1009-lock-race'
        );
        RAISE EXCEPTION 'editor conversion unexpectedly succeeded';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'DEV1009_PUBLISHED_ADMIN_REQUIRED' THEN
            RAISE;
        END IF;
    END;
END;
$$;
RESET ROLE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.release_conversion_runs
        WHERE release_id = '92000000-0000-4000-8000-000000000002'
    ) OR EXISTS (
        SELECT 1 FROM public.release_notes
        WHERE release_id = '92000000-0000-4000-8000-000000000002'
    ) THEN
        RAISE EXCEPTION 'stale-visibility conversion left mutations behind';
    END IF;
END;
$$;
SQL

wait "$publisher_pid"
publisher_pid=""
