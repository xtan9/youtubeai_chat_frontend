#!/usr/bin/env bash

# Run the exact incident-repair migration while a later Transcript row lock
# pauses it. The observed wait proves the migration has already acquired its
# three Video parent locks; concurrent FK and unrelated writes then exercise
# those production locks rather than a copy of their SQL.

set -euo pipefail

if [[ -z "${PGDATABASE:-}" ]]; then
  echo "PGDATABASE is required" >&2
  exit 2
fi

migration_path="${1:-supabase/migrations/20260809209999_repair_legacy_video_identity_incident.sql}"
if [[ ! -f "$migration_path" ]]; then
  echo "Migration file not found: $migration_path" >&2
  exit 2
fi

blocker_app='identity-repair-transcript-blocker'
migration_app='identity-repair-exact-migration'
target_app='identity-repair-target-child'
unrelated_app='identity-repair-unrelated-child'
redirect_id='8a37686a-e461-4388-a087-ac030d0bf7f0'
target_id='f83123c7-4e6a-4a95-9554-1978dac3e535'
unrelated_id='b9980000-0000-4000-8000-000000000001'
target_summary_id='b9980000-0000-4000-8000-000000000002'
unrelated_summary_id='b9980000-0000-4000-8000-000000000003'
log_dir="$(mktemp -d)"
blocker_log="$log_dir/blocker.log"
migration_log="$log_dir/migration.log"
target_log="$log_dir/target.log"
blocker_pid=''
blocker_watchdog_pid=''
migration_pid=''
target_pid=''

query_scalar() {
  psql -X -A -t -q -v ON_ERROR_STOP=1 -c "$1"
}

wait_for_condition() {
  local label="$1"
  local query="$2"
  local timeout_seconds="${3:-4}"
  local deadline_ms

  deadline_ms=$(($(date +%s%3N) + timeout_seconds * 1000))
  while (( $(date +%s%3N) < deadline_ms )); do
    if [[ "$(query_scalar "$query")" == 't' ]]; then
      return 0
    fi
    sleep 0.02
  done

  echo "Timed out waiting for $label" >&2
  psql -X -P pager=off -c \
    "select pid, application_name, state, wait_event_type, wait_event, pg_blocking_pids(pid) as blocking_pids from pg_stat_activity where datname = current_database() order by application_name, pid" \
    >&2 || true
  return 1
}

terminate_named_session() {
  local application_name="$1"
  psql -X -q -v ON_ERROR_STOP=1 -c \
    "select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and application_name = '$application_name' and pid <> pg_backend_pid()" \
    >/dev/null 2>&1 || true
}

cleanup() {
  set +e
  if [[ -n "$blocker_watchdog_pid" ]] \
    && kill -0 "$blocker_watchdog_pid" 2>/dev/null; then
    kill "$blocker_watchdog_pid" 2>/dev/null
    wait "$blocker_watchdog_pid" 2>/dev/null
  fi
  terminate_named_session "$target_app"
  terminate_named_session "$migration_app"
  terminate_named_session "$blocker_app"
  for process_id in "$target_pid" "$migration_pid" "$blocker_pid"; do
    if [[ -n "$process_id" ]] && kill -0 "$process_id" 2>/dev/null; then
      wait "$process_id" 2>/dev/null
    fi
  done
  rm -f -- "$blocker_log" "$migration_log" "$target_log"
  rmdir "$log_dir" 2>/dev/null || true
}
trap cleanup EXIT

psql -X -v ON_ERROR_STOP=1 <<SQL
insert into public.videos (
  id,
  youtube_url,
  url_hash,
  title,
  channel_name,
  language
)
values (
  '$unrelated_id',
  'https://www.youtube.com/watch?v=BaW_jenozKc',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'Unrelated lock fixture Video',
  'Lock Fixture',
  'en'
);
SQL

PGAPPNAME="$blocker_app" psql -X -v ON_ERROR_STOP=1 \
  >"$blocker_log" 2>&1 <<SQL &
begin;
select video_id
from public.video_transcripts
where video_id = '$redirect_id'
for update;
select pg_sleep(30);
rollback;
SQL
blocker_pid=$!

wait_for_condition \
  'Transcript blocker to hold its row lock' \
  "select exists (select 1 from pg_stat_activity where datname = current_database() and application_name = '$blocker_app' and state = 'active' and wait_event_type = 'Timeout' and wait_event = 'PgSleep')"

PGAPPNAME="$migration_app" psql -X -v ON_ERROR_STOP=1 \
  -f "$migration_path" >"$migration_log" 2>&1 &
migration_pid=$!
(
  sleep 4
  terminate_named_session "$blocker_app"
) &
blocker_watchdog_pid=$!

wait_for_condition \
  'the exact migration to wait on the redirect Transcript' \
  "select exists (
     select 1
     from pg_stat_activity as migration
     where migration.datname = current_database()
       and migration.application_name = '$migration_app'
       and migration.state = 'active'
       and migration.wait_event_type = 'Lock'
       and exists (
         select 1
         from unnest(pg_blocking_pids(migration.pid)) as blocking(pid)
         join pg_stat_activity as blocker on blocker.pid = blocking.pid
         where blocker.application_name = '$blocker_app'
       )
   )"

PGAPPNAME="$target_app" PGOPTIONS='-c statement_timeout=10s' \
  psql -X -v ON_ERROR_STOP=1 >"$target_log" 2>&1 <<SQL &
\set VERBOSITY verbose
insert into public.summaries (
  id,
  video_id,
  summary,
  transcript_source,
  output_language
)
values (
  '$target_summary_id',
  '$target_id',
  'This dependency must lose the race with the exact repair.',
  'manual_captions',
  null
);
SQL
target_pid=$!

wait_for_condition \
  'the target FK writer to wait on the exact migration' \
  "select exists (
     select 1
     from pg_stat_activity as target
     where target.datname = current_database()
       and target.application_name = '$target_app'
       and target.state = 'active'
       and target.wait_event_type = 'Lock'
       and exists (
         select 1
         from unnest(pg_blocking_pids(target.pid)) as blocking(pid)
         join pg_stat_activity as migration on migration.pid = blocking.pid
         where migration.application_name = '$migration_app'
       )
   )"

PGAPPNAME="$unrelated_app" PGOPTIONS='-c statement_timeout=2s' \
  psql -X -v ON_ERROR_STOP=1 <<SQL
insert into public.summaries (
  id,
  video_id,
  summary,
  transcript_source,
  output_language
)
values (
  '$unrelated_summary_id',
  '$unrelated_id',
  'Unrelated dependency stays writable.',
  'manual_captions',
  null
);
SQL

if kill -0 "$blocker_watchdog_pid" 2>/dev/null; then
  kill "$blocker_watchdog_pid" 2>/dev/null || true
  wait "$blocker_watchdog_pid" 2>/dev/null || true
fi
blocker_watchdog_pid=''
terminate_named_session "$blocker_app"
if wait "$blocker_pid"; then
  echo 'Transcript blocker ended without the coordinated termination' >&2
  exit 1
fi
blocker_pid=''

if ! wait "$migration_pid"; then
  echo 'Exact identity repair migration failed' >&2
  cat "$migration_log" >&2
  exit 1
fi
migration_pid=''

set +e
wait "$target_pid"
target_status=$?
set -e
target_pid=''
if [[ $target_status -eq 0 ]]; then
  echo 'Target FK writer unexpectedly survived the exact repair' >&2
  exit 1
fi
if ! grep -Eq 'ERROR:[[:space:]]+23503:' "$target_log" \
  || ! grep -Fq "$target_id" "$target_log"; then
  echo 'Target writer failed for an unexpected reason' >&2
  cat "$target_log" >&2
  exit 1
fi

psql -X -v ON_ERROR_STOP=1 <<SQL
do \$\$
begin
  if exists (
      select 1 from public.videos where id = '$target_id'
    )
    or not exists (
      select 1
      from public.videos
      join public.video_transcripts
        on video_transcripts.video_id = videos.id
      where videos.id = '$redirect_id'
        and videos.youtube_url = 'https://www.youtube.com/watch?v=_b1b-uMuzKQ'
    )
    or (
      select count(*)
      from project_private.legacy_video_identity_quarantine
    ) <> 2
    or exists (
      select 1 from public.summaries where id = '$target_summary_id'
    )
    or not exists (
      select 1 from public.summaries where id = '$unrelated_summary_id'
    )
  then
    raise exception
      'REGRESSION: exact migration parent-lock race reached an incoherent terminal state';
  end if;
end;
\$\$;

delete from public.summaries where id = '$unrelated_summary_id';
delete from public.videos where id = '$unrelated_id';
SQL

if [[ "$(query_scalar "select not exists (select 1 from pg_stat_activity where datname = current_database() and application_name in ('$blocker_app', '$migration_app', '$target_app'))")" != 't' ]]; then
  echo 'Named race sessions remained after terminal settlement' >&2
  exit 1
fi

trap - EXIT
rm -f -- "$blocker_log" "$migration_log" "$target_log"
rmdir "$log_dir"
echo 'EXACT_IDENTITY_REPAIR_PARENT_LOCK_RACE_OK'
