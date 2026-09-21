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
  -f "$repo/supabase/tests/domani_users_fixture.sql" \
  -f "$repo/supabase/migrations/20260920181147_domani_user_insights.sql" \
  -f "$repo/supabase/migrations/20260921160406_harden_domani_user_activity_projection.sql" \
  -f "$repo/supabase/tests/domani_users_assertions.sql"
echo "User insights SQL tests passed"
