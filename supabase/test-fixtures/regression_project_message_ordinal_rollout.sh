#!/usr/bin/env bash

# Run the exact ordinal migration while a user-message insert is open. The
# migration must wait for that writer before its snapshot and retain the fence
# through trigger installation, so both the pre-lock and post-trigger rows get
# stable Project-wide identities.

set -euo pipefail

if [[ -z "${PGDATABASE:-}" ]]; then
  echo "PGDATABASE is required" >&2
  exit 2
fi

migration_path="${1:-supabase/migrations/20260809232600_project_message_analytics_ordinals.sql}"
if [[ ! -f "$migration_path" ]]; then
  echo "Migration file not found: $migration_path" >&2
  exit 2
fi

writer_app='project-ordinal-rollout-writer'
migration_app='project-ordinal-rollout-migration'
log_dir="$(mktemp -d)"
writer_log="$log_dir/writer.log"
migration_log="$log_dir/migration.log"
writer_pid=''
migration_pid=''

query_scalar() {
  psql -X -A -t -q -v ON_ERROR_STOP=1 -c "$1"
}

cleanup() {
  set +e
  for process_id in "$migration_pid" "$writer_pid"; do
    if [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null; then
      kill "$process_id" 2>/dev/null
      wait "$process_id" 2>/dev/null
    fi
  done
  psql -X -q -v ON_ERROR_STOP=1 -c \
    "delete from auth.users where id = 'f6000000-0000-4000-8000-000000000001'" \
    >/dev/null 2>&1 || true
  rm -f -- "$writer_log" "$migration_log"
  rmdir "$log_dir" 2>/dev/null || true
}
trap cleanup EXIT

psql -X -v ON_ERROR_STOP=1 <<'SQL'
insert into auth.users (id, is_anonymous)
values ('f6000000-0000-4000-8000-000000000001', false);

insert into public.projects (id, workspace_id, name)
select
  'f6100000-0000-4000-8000-000000000001',
  id,
  'Ordinal rollout fixture'
from public.workspaces
where owner_id = 'f6000000-0000-4000-8000-000000000001';

insert into public.project_conversations (id, project_id, kind, name)
values (
  'f6200000-0000-4000-8000-000000000001',
  'f6100000-0000-4000-8000-000000000001',
  'named',
  'Ordinal rollout thread'
);
SQL

PGAPPNAME="$writer_app" psql -X -v ON_ERROR_STOP=1 \
  >"$writer_log" 2>&1 <<'SQL' &
begin;
insert into public.project_conversation_messages (
  id, conversation_id, role, content, completion_attempt_token,
  completion_state, created_at
) values (
  'f6300000-0000-4000-8000-000000000001',
  'f6200000-0000-4000-8000-000000000001',
  'user',
  'Pre-lock rollout identity',
  'f6400000-0000-4000-8000-000000000001',
  'cancelled',
  clock_timestamp()
);
select pg_sleep(2);
commit;
SQL
writer_pid=$!

deadline=$((SECONDS + 5))
until [[ "$(query_scalar "select exists (select 1 from pg_stat_activity where datname = current_database() and application_name = '$writer_app' and wait_event_type = 'Timeout' and wait_event = 'PgSleep')")" == 't' ]]; do
  if (( SECONDS >= deadline )); then
    echo 'Timed out waiting for the pre-lock message writer' >&2
    cat "$writer_log" >&2
    exit 1
  fi
  sleep 0.02
done

PGAPPNAME="$migration_app" psql -X -v ON_ERROR_STOP=1 \
  -f "$migration_path" >"$migration_log" 2>&1 &
migration_pid=$!

if ! wait "$writer_pid"; then
  echo 'Pre-lock message writer failed' >&2
  cat "$writer_log" >&2
  exit 1
fi
writer_pid=''
if ! wait "$migration_pid"; then
  echo 'Exact ordinal migration failed' >&2
  cat "$migration_log" >&2
  exit 1
fi
migration_pid=''

psql -X -v ON_ERROR_STOP=1 <<'SQL'
insert into public.project_conversation_messages (
  id, conversation_id, role, content, completion_attempt_token,
  completion_state, created_at
) values (
  'f6300000-0000-4000-8000-000000000002',
  'f6200000-0000-4000-8000-000000000001',
  'user',
  'Post-trigger rollout identity',
  'f6400000-0000-4000-8000-000000000002',
  'cancelled',
  clock_timestamp()
);

do $$
declare
  identities uuid[];
  ordinals bigint[];
begin
  select
    array_agg(user_message_id order by message_ordinal),
    array_agg(message_ordinal order by message_ordinal)
  into identities, ordinals
  from public.project_message_analytics_ordinals
  where project_id = 'f6100000-0000-4000-8000-000000000001';

  if identities <> array[
      'f6300000-0000-4000-8000-000000000001'::uuid,
      'f6300000-0000-4000-8000-000000000002'::uuid
    ]
    or ordinals <> array[1, 2]::bigint[] then
    raise exception
      'REGRESSION: rollout lost or reassigned message identity (ids %, ordinals %)',
      identities,
      ordinals;
  end if;
end;
$$;

delete from auth.users
where id = 'f6000000-0000-4000-8000-000000000001';
SQL

echo 'Project message ordinal rollout race: passed'
