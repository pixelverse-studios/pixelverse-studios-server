#!/usr/bin/env bash
# Creates an isolated local cluster with synthetic data. Never connects to a remote database.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
pg_bin=${PG_BINDIR:-$(pg_config --bindir)}
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/domani-feedback-test.XXXXXX")
cleanup() {
  "$pg_bin/pg_ctl" -D "$fixture_dir/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$fixture_dir"
}
trap cleanup EXIT
"$pg_bin/initdb" -D "$fixture_dir/data" -U postgres -A trust --no-locale >/dev/null
"$pg_bin/pg_ctl" -D "$fixture_dir/data" -l "$fixture_dir/postgres.log" -o "-k $fixture_dir -h ''" start >/dev/null
"$pg_bin/psql" -h "$fixture_dir" -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f "$repo/supabase/tests/domani_feedback_fixture.sql" \
  -f "$repo/supabase/migrations/20260917185008_domani_feedback_dashboard_foundation.sql" \
  -f "$repo/supabase/tests/domani_feedback_assertions.sql" \
  -f "$repo/supabase/migrations/20260918020000_domani_feedback_conversations.sql" \
  -f "$repo/supabase/tests/domani_feedback_conversation_assertions.sql"
# Separate sessions verify transaction contention, not just sequential replay.
psql_local() { "$pg_bin/psql" -X -q -h "$fixture_dir" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
cat > "$fixture_dir/enqueue.sql" <<'SQL'
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.queue_domani_feedback_reply('beta_feedback','00000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001','staff@example.test','Concurrent subject','Concurrent body','20000000-0000-4000-8000-000000000001');
SELECT pg_sleep(0.3);
COMMIT;
SQL
psql_local -f "$fixture_dir/enqueue.sql" > "$fixture_dir/enqueue1.log" &
enqueue1=$!
psql_local -f "$fixture_dir/enqueue.sql" > "$fixture_dir/enqueue2.log" &
enqueue2=$!
wait "$enqueue1"
wait "$enqueue2"
psql_local <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM public.domani_feedback_conversations)<>1 OR (SELECT count(*) FROM public.domani_feedback_messages)<>1
 OR (SELECT count(*) FROM public.domani_feedback_outbox WHERE state='held')<>1 THEN RAISE EXCEPTION 'Concurrent enqueue duplicated intent'; END IF;
END $$;
SET ROLE service_role;
INSERT INTO public.domani_feedback_messages(id,conversation_id,direction,subject,body_text,sender_email,recipient_email,delivery_status)
SELECT ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,id,'inbound','Reply','Concurrent read fixture','fixture@example.test','hello@domani-app.com','received'
FROM public.domani_feedback_conversations CROSS JOIN generate_series(1,2) n ORDER BY n;
SQL
for message_suffix in 000000000001 000000000002; do
  psql_local > "$fixture_dir/read-$message_suffix.log" <<SQL &
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.mark_domani_feedback_read('beta_feedback','00000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-$message_suffix');
SELECT pg_sleep(0.3);
COMMIT;
SQL
  if [ "$message_suffix" = 000000000001 ]; then read1=$!; else read2=$!; fi
done
wait "$read1"
wait "$read2"
psql_local <<'SQL'
DO $$ BEGIN
 IF (SELECT last_read_sequence FROM public.domani_feedback_read_cursors)<>3 THEN RAISE EXCEPTION 'Concurrent read cursor regressed'; END IF;
 IF public.get_dashboard_domani_feedback('beta_feedback','00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001')#>>'{conversation,unread_count}'<>'0' THEN RAISE EXCEPTION 'Concurrent unread count incorrect'; END IF;
END $$;
-- Simulate future source values/null metadata without altering deployed source schemas.
ALTER TABLE public.beta_feedback DROP CONSTRAINT beta_feedback_category_check;
ALTER TABLE public.beta_feedback ALTER COLUMN email DROP NOT NULL;
UPDATE public.beta_feedback SET email=NULL,category='future_category',created_at=NULL,platform=NULL WHERE id='00000000-0000-4000-8000-000000000002';
SET ROLE service_role;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.get_dashboard_domani_feedback('beta_feedback','00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
 IF r->>'category'<>'unknown' OR r->>'email' IS NOT NULL OR r->>'created_at' IS NOT NULL OR r#>>'{conversation,message_count}'<>'0' THEN RAISE EXCEPTION 'Unknown/null source data'; END IF;
 BEGIN
  PERFORM public.queue_domani_feedback_reply('beta_feedback','00000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000001','staff@example.test','Subject','Body','20000000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'Null recipient accepted';
 EXCEPTION WHEN SQLSTATE 'DF422' THEN NULL; END;
END $$;
SQL
printf '%s\n' 'Conversation SQL tests passed (including concurrent enqueue/read updates).'
