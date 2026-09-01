-- Durable, offline-only Channel Scan Runs.
--
-- Real Connected YouTube Channel ownership is intentionally supplied by the
-- #471 onboarding/identity work. This migration stores the opaque channel key
-- and enforces run safety without granting browser access to scan data. The
-- application currently permits only synthetic-* keys at its route seam.

create table public.channel_scan_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  connected_channel_id text not null,
  provider text not null,
  status text not null default 'queued',
  outcome text,
  retry_of uuid references public.channel_scan_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancel_requested_at timestamptz,
  failure_code text,
  next_page_token text,
  source_exhausted boolean not null default false,
  pages_scanned integer not null default 0,
  threads_discovered integer not null default 0,
  threads_assessed integer not null default 0,
  threads_reused integer not null default 0,
  threads_failed integer not null default 0,
  window_start timestamptz not null,
  window_end timestamptz not null,
  oldest_thread_at timestamptz,
  newest_thread_at timestamptz,
  bound_kind text,
  bound_prevented_complete_coverage boolean not null default false,
  complete_within_bounds boolean not null default false,
  worker_id uuid,
  worker_lease_expires_at timestamptz,
  constraint channel_scan_runs_provider_check
    check (provider = 'synthetic'),
  constraint channel_scan_runs_status_check
    check (status in ('queued', 'running', 'completed', 'partial', 'cancelled', 'failed')),
  constraint channel_scan_runs_outcome_check
    check (
      (status in ('queued', 'running') and outcome is null)
      or (status in ('completed', 'partial', 'cancelled', 'failed') and outcome = status)
    ),
  constraint channel_scan_runs_bound_check
    check (bound_kind is null or bound_kind in ('thread_limit', 'time_window')),
  constraint channel_scan_runs_window_check
    check (window_end >= window_start and window_end - window_start <= interval '7 days'),
  constraint channel_scan_runs_count_check
    check (
      pages_scanned >= 0
      and threads_discovered between 0 and 200
      and threads_assessed >= 0
      and threads_reused >= 0
      and threads_failed >= 0
      and threads_assessed + threads_reused + threads_failed <= threads_discovered
    ),
  constraint channel_scan_runs_failure_code_check
    check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{1,79}$')
);

create unique index channel_scan_runs_active_channel_idx
  on public.channel_scan_runs (connected_channel_id)
  where status in ('queued', 'running');

create index channel_scan_runs_account_created_idx
  on public.channel_scan_runs (account_id, created_at desc);

create table public.channel_scan_run_pages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.channel_scan_runs(id) on delete cascade,
  page_token text not null,
  page_number integer not null,
  accepted_threads integer not null default 0,
  next_page_token text,
  has_more_within_window boolean not null default false,
  has_more_outside_window boolean not null default false,
  created_at timestamptz not null default now(),
  constraint channel_scan_run_pages_page_number_check
    check (page_number >= 1),
  constraint channel_scan_run_pages_accepted_check
    check (accepted_threads between 0 and 200),
  unique (run_id, page_token)
);

create index channel_scan_run_pages_run_number_idx
  on public.channel_scan_run_pages (run_id, page_number);

create table public.channel_scan_assessments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  connected_channel_id text not null,
  thread_id text not null,
  content_hash text not null,
  taxonomy_version text not null,
  classification text not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_scan_assessments_classification_check
    check (classification in ('allowed_criticism', 'actionable_abuse', 'reviewable', 'safety_flag')),
  constraint channel_scan_assessments_reason_check
    check (char_length(reason_code) between 1 and 80),
  unique (connected_channel_id, thread_id, content_hash, taxonomy_version)
);

create table public.channel_scan_run_threads (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.channel_scan_runs(id) on delete cascade,
  thread_id text not null,
  comment_id text not null,
  video_id text not null,
  published_at timestamptz not null,
  content_hash text not null,
  position integer not null,
  status text not null default 'pending',
  result_kind text,
  assessment_id uuid references public.channel_scan_assessments(id) on delete set null,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint channel_scan_run_threads_status_check
    check (status in ('pending', 'succeeded', 'failed')),
  constraint channel_scan_run_threads_result_check
    check (
      (status = 'pending' and result_kind is null and assessment_id is null and failure_code is null)
      or (status = 'succeeded' and result_kind in ('assessed', 'reused') and assessment_id is not null and failure_code is null)
      or (status = 'failed' and result_kind is null and assessment_id is null and failure_code ~ '^[A-Z][A-Z0-9_]{1,79}$')
    ),
  constraint channel_scan_run_threads_position_check
    check (position between 1 and 200),
  unique (run_id, thread_id, content_hash)
);

create index channel_scan_run_threads_pending_idx
  on public.channel_scan_run_threads (run_id, status, position);

create index channel_scan_assessments_reuse_idx
  on public.channel_scan_assessments (
    connected_channel_id,
    thread_id,
    content_hash,
    taxonomy_version
  );

alter table public.channel_scan_runs enable row level security;
alter table public.channel_scan_run_pages enable row level security;
alter table public.channel_scan_assessments enable row level security;
alter table public.channel_scan_run_threads enable row level security;

-- Scan data and run claims are server-only. Browser sessions never receive
-- comment hashes, provider data, or worker lease fields directly.
revoke all on table public.channel_scan_runs from anon, authenticated;
revoke all on table public.channel_scan_run_pages from anon, authenticated;
revoke all on table public.channel_scan_assessments from anon, authenticated;
revoke all on table public.channel_scan_run_threads from anon, authenticated;

create function public.start_channel_scan_run(
  p_account_id uuid,
  p_connected_channel_id text,
  p_provider text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_retry_of uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_run_id uuid;
  previous_account_id uuid;
  previous_channel_id text;
  previous_status text;
  recent_count integer;
  oldest_recent timestamptz;
  run_id uuid;
begin
  if p_account_id is null
    or p_connected_channel_id is null
    or char_length(btrim(p_connected_channel_id)) not between 1 and 200
    or p_provider <> 'synthetic'
    or p_window_start is null
    or p_window_end is null
    or p_window_end < p_window_start
    or p_window_end - p_window_start > interval '7 days' then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  -- Account serialization makes the four-per-hour decision atomic. The
  -- channel lock keeps the one-active-run invariant clear even before the
  -- partial unique index reports a conflict.
  perform pg_advisory_xact_lock(hashtextextended(p_account_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(btrim(p_connected_channel_id), 1));

  select id
  into active_run_id
  from public.channel_scan_runs
  where connected_channel_id = btrim(p_connected_channel_id)
    and status in ('queued', 'running')
  order by created_at
  limit 1
  for update;

  if active_run_id is not null then
    return jsonb_build_object(
      'outcome', 'concurrent',
      'runId', active_run_id
    );
  end if;

  if p_retry_of is not null then
    select account_id, connected_channel_id, status
    into previous_account_id, previous_channel_id, previous_status
    from public.channel_scan_runs
    where id = p_retry_of;

    if previous_account_id is distinct from p_account_id
      or previous_channel_id is distinct from btrim(p_connected_channel_id)
      or previous_status not in ('completed', 'partial', 'cancelled', 'failed') then
      return jsonb_build_object('outcome', 'retry_unavailable');
    end if;
  end if;

  select count(*)::integer, min(created_at)
  into recent_count, oldest_recent
  from public.channel_scan_runs
  where account_id = p_account_id
    and created_at >= now() - interval '1 hour';

  if recent_count >= 4 then
    return jsonb_build_object(
      'outcome', 'rate_limited',
      'retryAt', (oldest_recent + interval '1 hour')::text
    );
  end if;

  insert into public.channel_scan_runs (
    account_id,
    connected_channel_id,
    provider,
    status,
    outcome,
    retry_of,
    window_start,
    window_end
  ) values (
    p_account_id,
    btrim(p_connected_channel_id),
    p_provider,
    'queued',
    null,
    p_retry_of,
    p_window_start,
    p_window_end
  )
  returning id into run_id;

  return jsonb_build_object('outcome', 'started', 'runId', run_id);
exception
  when unique_violation then
    select id
    into active_run_id
    from public.channel_scan_runs
    where connected_channel_id = btrim(p_connected_channel_id)
      and status in ('queued', 'running')
    order by created_at
    limit 1;
    if active_run_id is not null then
      return jsonb_build_object('outcome', 'concurrent', 'runId', active_run_id);
    end if;
    raise;
end;
$$;

create function public.claim_channel_scan_run(
  p_run_id uuid,
  p_worker_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  current_worker_id uuid;
  current_lease timestamptz;
  cancel_at timestamptz;
begin
  select status, worker_id, worker_lease_expires_at, cancel_requested_at
  into current_status, current_worker_id, current_lease, cancel_at
  from public.channel_scan_runs
  where id = p_run_id
  for update;

  if not found or current_status in ('completed', 'partial', 'cancelled', 'failed') then
    return jsonb_build_object('outcome', 'missing');
  end if;

  if cancel_at is not null then
    -- A cancelled worker may have disappeared after the request. Treat the
    -- next claim as the durable reaper so a running row cannot remain active
    -- forever waiting for the original invocation to return.
    update public.channel_scan_runs
    set status = 'cancelled',
        outcome = 'cancelled',
        completed_at = coalesce(completed_at, p_now),
        worker_id = null,
        worker_lease_expires_at = null
    where id = p_run_id;
    return jsonb_build_object('outcome', 'cancelled');
  end if;

  if current_status = 'running'
    and current_worker_id is not null
    and current_worker_id <> p_worker_id
    and current_lease is not null
    and current_lease > p_now then
    return jsonb_build_object('outcome', 'busy');
  end if;

  update public.channel_scan_runs
  set status = 'running',
      started_at = coalesce(started_at, p_now),
      worker_id = p_worker_id,
      worker_lease_expires_at = p_now + interval '2 minutes'
  where id = p_run_id;

  return jsonb_build_object('outcome', 'acquired', 'runId', p_run_id);
end;
$$;

create function public.heartbeat_channel_scan_run(
  p_run_id uuid,
  p_worker_id uuid,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.channel_scan_runs
  set worker_lease_expires_at = p_now + interval '2 minutes'
  where id = p_run_id
    and status = 'running'
    and worker_id = p_worker_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'scan worker lease is no longer owned';
  end if;
  return true;
end;
$$;

create function public.persist_channel_scan_page(
  p_run_id uuid,
  p_worker_id uuid,
  p_page_token text,
  p_threads jsonb,
  p_next_page_token text,
  p_source_exhausted boolean,
  p_bound text,
  p_bound_prevented_complete_coverage boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  current_worker_id uuid;
  current_window_start timestamptz;
  current_window_end timestamptz;
  current_discovered integer;
  next_page_number integer;
  inserted_count integer := 0;
  inserted_position integer;
  item jsonb;
  inserted_rows integer;
  observed_at timestamptz;
begin
  select status, worker_id, window_start, window_end, threads_discovered
  into current_status, current_worker_id, current_window_start, current_window_end, current_discovered
  from public.channel_scan_runs
  where id = p_run_id
  for update;

  if not found or current_status <> 'running' or current_worker_id <> p_worker_id then
    raise exception using errcode = 'P0001', message = 'scan worker lease is no longer owned';
  end if;
  if p_page_token is null or char_length(p_page_token) > 200 then
    raise exception using errcode = '22023', message = 'invalid scan page token';
  end if;
  if p_bound is not null and p_bound not in ('thread_limit', 'time_window') then
    raise exception using errcode = '22023', message = 'invalid scan bound';
  end if;

  select page_number
  into next_page_number
  from public.channel_scan_run_pages
  where run_id = p_run_id
    and page_token = p_page_token;
  if next_page_number is not null then
    return;
  end if;

  select coalesce(max(page_number), 0) + 1
  into next_page_number
  from public.channel_scan_run_pages
  where run_id = p_run_id;

  for item in
    select value
    from jsonb_array_elements(coalesce(p_threads, '[]'::jsonb))
  loop
    if current_discovered + inserted_count >= 200 then
      exit;
    end if;
    if item->>'threadId' is null
      or char_length(item->>'threadId') not between 1 and 200
      or item->>'commentId' is null
      or char_length(item->>'commentId') not between 1 and 200
      or item->>'videoId' is null
      or char_length(item->>'videoId') not between 1 and 200
      or item->>'contentHash' is null
      or char_length(item->>'contentHash') not between 1 and 256
      or coalesce((item->>'isTopLevel')::boolean, false) is not true then
      continue;
    end if;

    observed_at := (item->>'publishedAt')::timestamptz;
    if observed_at < current_window_start or observed_at > current_window_end then
      continue;
    end if;

    inserted_position := current_discovered + inserted_count + 1;
    insert into public.channel_scan_run_threads (
      run_id,
      thread_id,
      comment_id,
      video_id,
      published_at,
      content_hash,
      position
    ) values (
      p_run_id,
      item->>'threadId',
      item->>'commentId',
      item->>'videoId',
      observed_at,
      item->>'contentHash',
      inserted_position
    )
    on conflict (run_id, thread_id, content_hash) do nothing;
    get diagnostics inserted_rows = row_count;
    inserted_count := inserted_count + inserted_rows;
  end loop;

  insert into public.channel_scan_run_pages (
    run_id,
    page_token,
    page_number,
    accepted_threads,
    next_page_token,
    has_more_within_window,
    has_more_outside_window
  ) values (
    p_run_id,
    p_page_token,
    next_page_number,
    inserted_count,
    p_next_page_token,
    not p_source_exhausted,
    coalesce(p_bound = 'time_window', false)
  );

  update public.channel_scan_runs
  set pages_scanned = pages_scanned + 1,
      threads_discovered = threads_discovered + inserted_count,
      next_page_token = p_next_page_token,
      source_exhausted = p_source_exhausted,
      bound_kind = coalesce(p_bound, bound_kind),
      bound_prevented_complete_coverage =
        bound_prevented_complete_coverage or p_bound_prevented_complete_coverage,
      complete_within_bounds =
        p_source_exhausted
        and not p_bound_prevented_complete_coverage
        and p_bound is null,
      oldest_thread_at = (
        select min(published_at)
        from public.channel_scan_run_threads
        where run_id = p_run_id
      ),
      newest_thread_at = (
        select max(published_at)
        from public.channel_scan_run_threads
        where run_id = p_run_id
      )
  where id = p_run_id;
end;
$$;

create function public.remember_channel_scan_assessment(
  p_account_id uuid,
  p_connected_channel_id text,
  p_thread_id text,
  p_content_hash text,
  p_assessment jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  assessment_id uuid;
begin
  if p_account_id is null
    or p_connected_channel_id is null
    or p_thread_id is null
    or p_content_hash is null
    or p_assessment->>'taxonomyVersion' <> 'synthetic-interaction-v1'
    or p_assessment->>'classification' not in ('allowed_criticism', 'actionable_abuse', 'reviewable', 'safety_flag')
    or char_length(coalesce(p_assessment->>'reasonCode', '')) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'invalid scan assessment';
  end if;

  insert into public.channel_scan_assessments (
    account_id,
    connected_channel_id,
    thread_id,
    content_hash,
    taxonomy_version,
    classification,
    reason_code
  ) values (
    p_account_id,
    btrim(p_connected_channel_id),
    p_thread_id,
    p_content_hash,
    p_assessment->>'taxonomyVersion',
    p_assessment->>'classification',
    p_assessment->>'reasonCode'
  )
  on conflict (connected_channel_id, thread_id, content_hash, taxonomy_version)
  do update set updated_at = now()
  returning id into assessment_id;

  return assessment_id;
end;
$$;

create function public.complete_channel_scan_thread(
  p_run_id uuid,
  p_worker_id uuid,
  p_work_item_id uuid,
  p_result_kind text,
  p_assessment_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_worker_id uuid;
  current_status text;
  item_status text;
begin
  select worker_id, status
  into current_worker_id, current_status
  from public.channel_scan_runs
  where id = p_run_id
  for update;
  if not found or current_status <> 'running' or current_worker_id <> p_worker_id then
    raise exception using errcode = 'P0001', message = 'scan worker lease is no longer owned';
  end if;
  if p_result_kind not in ('assessed', 'reused') or p_assessment_id is null then
    raise exception using errcode = '22023', message = 'invalid scan completion';
  end if;

  select status
  into item_status
  from public.channel_scan_run_threads
  where id = p_work_item_id
    and run_id = p_run_id
  for update;
  if not found or item_status <> 'pending' then
    return;
  end if;

  update public.channel_scan_run_threads
  set status = 'succeeded',
      result_kind = p_result_kind,
      assessment_id = p_assessment_id,
      updated_at = now()
  where id = p_work_item_id
    and run_id = p_run_id;

  update public.channel_scan_runs
  set threads_assessed = threads_assessed + case when p_result_kind = 'assessed' then 1 else 0 end,
      threads_reused = threads_reused + case when p_result_kind = 'reused' then 1 else 0 end
  where id = p_run_id;
end;
$$;

create function public.fail_channel_scan_thread(
  p_run_id uuid,
  p_worker_id uuid,
  p_work_item_id uuid,
  p_failure_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_worker_id uuid;
  current_status text;
  item_status text;
begin
  select worker_id, status
  into current_worker_id, current_status
  from public.channel_scan_runs
  where id = p_run_id
  for update;
  if not found or current_status <> 'running' or current_worker_id <> p_worker_id then
    raise exception using errcode = 'P0001', message = 'scan worker lease is no longer owned';
  end if;
  if p_failure_code is null or p_failure_code !~ '^[A-Z][A-Z0-9_]{1,79}$' then
    raise exception using errcode = '22023', message = 'invalid scan failure code';
  end if;

  select status
  into item_status
  from public.channel_scan_run_threads
  where id = p_work_item_id
    and run_id = p_run_id
  for update;
  if not found or item_status <> 'pending' then
    return;
  end if;

  update public.channel_scan_run_threads
  set status = 'failed',
      failure_code = p_failure_code,
      updated_at = now()
  where id = p_work_item_id
    and run_id = p_run_id;

  update public.channel_scan_runs
  set threads_failed = threads_failed + 1
  where id = p_run_id;
end;
$$;

create function public.request_channel_scan_cancellation(
  p_account_id uuid,
  p_run_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  select status
  into current_status
  from public.channel_scan_runs
  where id = p_run_id
    and account_id = p_account_id
  for update;
  if not found or current_status not in ('queued', 'running') then
    return false;
  end if;

  if current_status = 'queued' then
    update public.channel_scan_runs
    set cancel_requested_at = coalesce(cancel_requested_at, now()),
        status = 'cancelled',
        outcome = 'cancelled',
        completed_at = coalesce(completed_at, now()),
        worker_id = null,
        worker_lease_expires_at = null
    where id = p_run_id;
  else
    -- Let the current worker finish the item it already owns. Its next loop
    -- observes this marker and finalizes Cancelled without losing that item.
    update public.channel_scan_runs
    set cancel_requested_at = coalesce(cancel_requested_at, now())
    where id = p_run_id;
  end if;
  return true;
end;
$$;

create function public.finish_channel_scan_run(
  p_run_id uuid,
  p_worker_id uuid,
  p_outcome text,
  p_failure_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
  current_worker_id uuid;
  cancel_at timestamptz;
  final_outcome text;
begin
  select status, worker_id, cancel_requested_at
  into current_status, current_worker_id, cancel_at
  from public.channel_scan_runs
  where id = p_run_id
  for update;
  if not found or current_status <> 'running' or current_worker_id <> p_worker_id then
    return;
  end if;
  if p_outcome not in ('completed', 'partial', 'cancelled', 'failed') then
    raise exception using errcode = '22023', message = 'invalid scan outcome';
  end if;
  if p_failure_code is not null and p_failure_code !~ '^[A-Z][A-Z0-9_]{1,79}$' then
    raise exception using errcode = '22023', message = 'invalid scan failure code';
  end if;

  final_outcome := case when cancel_at is not null then 'cancelled' else p_outcome end;
  update public.channel_scan_runs
  set status = final_outcome,
      outcome = final_outcome,
      failure_code = p_failure_code,
      completed_at = coalesce(completed_at, now()),
      worker_id = null,
      worker_lease_expires_at = null
  where id = p_run_id;
end;
$$;

create function public.fail_channel_scan_scheduling(
  p_account_id uuid,
  p_run_id uuid,
  p_failure_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.channel_scan_runs
  set status = 'failed',
      outcome = 'failed',
      failure_code = p_failure_code,
      completed_at = coalesce(completed_at, now())
  where id = p_run_id
    and account_id = p_account_id
    and status in ('queued', 'running');
end;
$$;

revoke all on function public.start_channel_scan_run(uuid, text, text, timestamptz, timestamptz, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_channel_scan_run(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.heartbeat_channel_scan_run(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.persist_channel_scan_page(uuid, uuid, text, jsonb, text, boolean, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.remember_channel_scan_assessment(uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_channel_scan_thread(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.fail_channel_scan_thread(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.request_channel_scan_cancellation(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.finish_channel_scan_run(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.fail_channel_scan_scheduling(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.start_channel_scan_run(uuid, text, text, timestamptz, timestamptz, uuid)
  to service_role;
grant execute on function public.claim_channel_scan_run(uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.heartbeat_channel_scan_run(uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.persist_channel_scan_page(uuid, uuid, text, jsonb, text, boolean, text, boolean)
  to service_role;
grant execute on function public.remember_channel_scan_assessment(uuid, text, text, text, jsonb)
  to service_role;
grant execute on function public.complete_channel_scan_thread(uuid, uuid, uuid, text, uuid)
  to service_role;
grant execute on function public.fail_channel_scan_thread(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.request_channel_scan_cancellation(uuid, uuid)
  to service_role;
grant execute on function public.finish_channel_scan_run(uuid, uuid, text, text)
  to service_role;
grant execute on function public.fail_channel_scan_scheduling(uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
