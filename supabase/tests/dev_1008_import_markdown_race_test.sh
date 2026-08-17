#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is required" >&2
    exit 1
fi

actor_id="82000000-0000-4000-8000-000000000001"
release_id="82000000-0000-4000-8000-000000000002"
publisher_pid=""

cleanup() {
    if [[ -n "$publisher_pid" ]]; then
        wait "$publisher_pid" 2>/dev/null || true
    fi
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
        -v actor_id="$actor_id" -v release_id="$release_id" <<'SQL'
DELETE FROM public.release_audit_events WHERE release_id = :'release_id';
DELETE FROM public.release_prds WHERE release_id = :'release_id';
DELETE FROM public.releases WHERE id = :'release_id';
SQL
}
trap cleanup EXIT

cleanup

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -v actor_id="$actor_id" -v release_id="$release_id" <<'SQL'
INSERT INTO public.releases (
    id,
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
    :'release_id',
    '820000000.1.0',
    'dev-1008-lock-race',
    'DEV-1008 lock race',
    'minor',
    'planned',
    'public_preview',
    'Lock-race authorization fixture',
    :'actor_id',
    :'actor_id'
);
SQL

PGAPPNAME=dev1008-publisher psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -v release_id="$release_id" <<'SQL' &
BEGIN;
UPDATE public.releases
SET lifecycle_status = 'released',
    visibility = 'published',
    released_at = now()
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
            WHERE application_name = 'dev1008-publisher'
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

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -v actor_id="$actor_id" -v release_id="$release_id" <<'SQL'
SET ROLE service_role;
DO $$
BEGIN
    BEGIN
        PERFORM public.import_domani_release_markdown(
            '82000000-0000-4000-8000-000000000002',
            NULL,
            NULL,
            NULL,
            NULL,
            'manual',
            'lock-race',
            '# Must not import from stale visibility',
            'lock-race.md',
            repeat('a', 64),
            'changelog',
            1,
            '82000000-0000-4000-8000-000000000001',
            'editor@example.com',
            'editor',
            'dev-1008-lock-race'
        );
        RAISE EXCEPTION 'editor import unexpectedly succeeded';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'DEV1008_PUBLISHED_ADMIN_REQUIRED' THEN
            RAISE;
        END IF;
    END;
END;
$$;
RESET ROLE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.release_prds
        WHERE release_id = '82000000-0000-4000-8000-000000000002'
    ) THEN
        RAISE EXCEPTION 'stale-visibility import created a source';
    END IF;
END;
$$;
SQL

wait "$publisher_pid"
publisher_pid=""
