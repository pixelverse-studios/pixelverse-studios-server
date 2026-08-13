#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "DATABASE_URL is required" >&2
    exit 1
fi

editor_id="b2000000-0000-4000-8000-000000000001"
admin_id="b2000000-0000-4000-8000-000000000002"
release_id="b2000000-0000-4000-8000-000000000003"
publisher_pid=""

cleanup() {
    if [[ -n "$publisher_pid" ]]; then wait "$publisher_pid" 2>/dev/null || true; fi
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v editor_id="$editor_id" -v admin_id="$admin_id" -v release_id="$release_id" <<'SQL'
DELETE FROM public.release_cache_invalidation_jobs WHERE release_id=:'release_id';
DELETE FROM public.release_audit_events WHERE release_id=:'release_id';
DELETE FROM public.release_notes WHERE release_id=:'release_id';
DELETE FROM public.releases WHERE id=:'release_id';
SQL
}
trap cleanup EXIT
cleanup

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v editor_id="$editor_id" -v admin_id="$admin_id" -v release_id="$release_id" <<'SQL'
INSERT INTO public.releases(id,version,slug,title,release_type,lifecycle_status,visibility,public_summary,created_by,updated_by)
VALUES(:'release_id','200000000.1.0','dev-1042-lock-race','DEV-1042 lock race','minor','planned','public_preview','Race fixture',:'admin_id',:'admin_id');
INSERT INTO public.release_notes(release_id,note_type,public_title,public_body,platforms,is_public,sort_order,created_by,updated_by)
VALUES(:'release_id','feature','Existing note','Existing body',ARRAY['ios']::public.release_platform[],true,0,:'admin_id',:'admin_id');
SQL

PGAPPNAME=dev1042-publisher psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v release_id="$release_id" <<'SQL' &
BEGIN;
UPDATE public.releases SET lifecycle_status='released',visibility='published',released_at=now(),row_version=row_version+1 WHERE id=:'release_id';
SELECT pg_sleep(2);
COMMIT;
SQL
publisher_pid=$!

publisher_ready="false"
for _ in {1..100}; do
    publisher_ready="$(psql "$DATABASE_URL" -Atqc "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='dev1042-publisher' AND wait_event='PgSleep')")"
    if [[ "$publisher_ready" == "t" ]]; then break; fi
    sleep 0.05
done
if [[ "$publisher_ready" != "t" ]]; then echo "Publisher transaction did not acquire the release lock" >&2; exit 1; fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
    BEGIN
        PERFORM public.mutate_admin_domani_release(
            'note.create','b2000000-0000-4000-8000-000000000003',1,
            '{"noteType":"feature","publicTitle":"Must fail","publicBody":"Must fail","platforms":["ios"],"isPublic":false}',
            'b2000000-0000-4000-8000-000000000001','editor-race@example.com','editor','req-race');
        RAISE EXCEPTION 'editor mutation unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'DEV1042_PUBLISHED_ADMIN_REQUIRED' THEN RAISE; END IF;
    END;
    IF (SELECT count(*) FROM public.release_notes WHERE release_id='b2000000-0000-4000-8000-000000000003') <> 1 THEN RAISE EXCEPTION 'race created a note'; END IF;
    IF EXISTS(SELECT 1 FROM public.release_audit_events WHERE request_id='req-race') THEN RAISE EXCEPTION 'race wrote audit'; END IF;
END
$$;
SQL

wait "$publisher_pid"
publisher_pid=""

PGAPPNAME=dev1042-note-creator psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v admin_id="$admin_id" -v release_id="$release_id" <<'SQL' &
BEGIN;
UPDATE public.releases SET row_version=row_version+1 WHERE id=:'release_id';
INSERT INTO public.release_notes(release_id,note_type,public_title,public_body,platforms,is_public,sort_order,created_by,updated_by)
VALUES(:'release_id','fix','Concurrent winner','Winner',ARRAY['ios']::public.release_platform[],true,1,:'admin_id',:'admin_id');
SELECT pg_sleep(2);
COMMIT;
SQL
publisher_pid=$!

creator_ready="false"
for _ in {1..100}; do
    creator_ready="$(psql "$DATABASE_URL" -Atqc "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='dev1042-note-creator' AND wait_event='PgSleep')")"
    if [[ "$creator_ready" == "t" ]]; then break; fi
    sleep 0.05
done
if [[ "$creator_ready" != "t" ]]; then echo "First note creator did not acquire the aggregate lock" >&2; exit 1; fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
    BEGIN
        PERFORM public.mutate_admin_domani_release(
            'note.create','b2000000-0000-4000-8000-000000000003',2,
            '{"noteType":"fix","publicTitle":"Concurrent stale","publicBody":"Must roll back","platforms":["ios"],"isPublic":true}',
            'b2000000-0000-4000-8000-000000000002','admin-race@example.com','admin','req-race-stale-create');
        RAISE EXCEPTION 'concurrent stale note create unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'DEV1042_VERSION_CONFLICT' THEN RAISE; END IF;
    END;
END
$$;
SQL

wait "$publisher_pid"
publisher_pid=""

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
    IF (SELECT count(*) FROM public.release_notes WHERE release_id='b2000000-0000-4000-8000-000000000003')<>2 THEN RAISE EXCEPTION 'concurrent create did not serialize'; END IF;
    IF EXISTS(SELECT 1 FROM public.release_audit_events WHERE request_id='req-race-stale-create') THEN RAISE EXCEPTION 'stale concurrent create wrote audit'; END IF;
END
$$;
SQL
