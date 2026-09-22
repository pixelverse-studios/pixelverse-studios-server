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
  -f "$repo/supabase/tests/domani_feedback_conversation_assertions.sql" \
  -f "$repo/supabase/migrations/20260918030000_domani_feedback_dispatch.sql" \
  -f "$repo/supabase/tests/domani_feedback_dispatch_assertions.sql" \
  -f "$repo/supabase/migrations/20260918121352_domani_feedback_delivery_events.sql" \
  -f "$repo/supabase/tests/domani_feedback_delivery_assertions.sql"
echo "Delivery SQL tests passed"
