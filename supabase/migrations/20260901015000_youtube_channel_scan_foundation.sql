-- Issue #489: the first real, read-only YouTube comment scan foundation.
--
-- This migration adds only server-owned seams. It stores no OAuth or API key
-- credential, permits only published public comments through the application
-- adapter, and leaves the current checked-in compliance gate closed until the
-- required external determination and launch evidence exist.

alter table public.channel_scan_runs
  drop constraint channel_scan_runs_provider_check;

alter table public.channel_scan_runs
  add constraint channel_scan_runs_provider_check
    check (provider in ('synthetic', 'youtube'));

alter table public.channel_scan_runs
  add column video_id text;

alter table public.channel_scan_runs
  add constraint channel_scan_runs_video_id_check
    check (video_id is null or video_id ~ '^[A-Za-z0-9_-]{11}$');

alter table public.channel_scan_run_threads
  add column interaction_assessment_id uuid
    references channel_private.interaction_assessments(id);

alter table public.channel_scan_run_threads
  drop constraint channel_scan_run_threads_result_check;

alter table public.channel_scan_run_threads
  add constraint channel_scan_run_threads_result_check
    check (
      (status = 'pending'
        and result_kind is null
        and assessment_id is null
        and interaction_assessment_id is null
        and failure_code is null)
      or (status = 'succeeded'
        and result_kind in ('assessed', 'reused')
        and (assessment_id is not null) <> (interaction_assessment_id is not null)
        and failure_code is null)
      or (status = 'failed'
        and result_kind is null
        and assessment_id is null
        and interaction_assessment_id is null
        and failure_code ~ '^[A-Z][A-Z0-9_]{1,79}$')
    );

drop function public.start_channel_scan_run(
  uuid, text, text, timestamptz, timestamptz, uuid
);

-- The application performs the compliance and API-key checks before calling
-- this function. The database repeats the account-owned identity, grant,
-- adult-attestation, and Pro checks so a stale worker cannot create a real
-- run after the connected identity is revoked or the entitlement changes.
create function public.start_channel_scan_run(
  p_account_id uuid,
  p_connected_channel_id text,
  p_provider text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_retry_of uuid default null,
  p_video_id text default null
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
    or p_provider is null
    or p_provider not in ('synthetic', 'youtube')
    or (p_provider = 'synthetic' and p_video_id is not null)
    or (p_video_id is not null and p_video_id !~ '^[A-Za-z0-9_-]{11}$')
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

  if p_provider = 'youtube'
    and (
      not exists (
        select 1
        from public.active_connected_channel_selections as active
        join public.connected_youtube_channels as connected
          on connected.id = active.connected_channel_id
         and connected.owner_id = active.owner_id
         and connected.channel_id = active.channel_id
        join public.channel_oauth_grants as grant_record
          on grant_record.id = connected.oauth_grant_id
         and grant_record.owner_id = connected.owner_id
        where active.owner_id = p_account_id
          and active.connected_channel_id::text = btrim(p_connected_channel_id)
          and connected.provider = 'youtube'
          and connected.status = 'active'
          and connected.supported_creator is true
          and grant_record.provider = 'youtube'
          and grant_record.provider_subject <> ''
          and grant_record.status = 'active'
          and grant_record.read_scope_granted is true
      )
      or not exists (
        select 1
        from public.channel_adult_attestations
        where owner_id = p_account_id
      )
      or not exists (
        select 1
        from public.user_subscriptions
        where user_id = p_account_id
          and tier = 'pro'
      )
    ) then
    return jsonb_build_object(
      'outcome', 'blocked',
      'code', 'YOUTUBE_SCAN_TARGET_UNAVAILABLE',
      'reason', 'An active, account-owned Supported Creator Channel is required.'
    );
  end if;

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
    video_id,
    provider,
    status,
    outcome,
    retry_of,
    window_start,
    window_end
  ) values (
    p_account_id,
    btrim(p_connected_channel_id),
    p_video_id,
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

-- Resolve only the verified identity used by the real provider. Tokens are
-- intentionally absent; the read adapter uses the separately configured
-- server API key for published public comments.
create function public.resolve_channel_scan_target(
  p_account_id uuid,
  p_connected_channel_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'accountId', connected.owner_id,
    'channelId', connected.channel_id,
    'connectedChannelId', connected.id,
    'grantId', grant_record.id,
    'providerSubject', grant_record.provider_subject,
    'providerChannelId', connected.provider_channel_id,
    'displayName', connected.display_name,
    'identityVerified', true,
    'supportedCreator', connected.supported_creator,
    'readScopeGranted', grant_record.read_scope_granted,
    'status', connected.status
  )
  from public.active_connected_channel_selections as active
  join public.connected_youtube_channels as connected
    on connected.id = active.connected_channel_id
   and connected.owner_id = active.owner_id
   and connected.channel_id = active.channel_id
  join public.channel_oauth_grants as grant_record
    on grant_record.id = connected.oauth_grant_id
   and grant_record.owner_id = connected.owner_id
  where active.owner_id = p_account_id
    and active.connected_channel_id::text = btrim(p_connected_channel_id)
    and connected.provider = 'youtube'
    and connected.status = 'active'
    and connected.supported_creator is true
    and grant_record.provider = 'youtube'
    and grant_record.provider_subject <> ''
    and grant_record.status = 'active'
    and grant_record.read_scope_granted is true
    and exists (
      select 1
      from public.channel_adult_attestations
      where owner_id = p_account_id
    )
    and exists (
      select 1
      from public.user_subscriptions
      where user_id = p_account_id
        and tier = 'pro'
    )
  limit 1;
$$;

-- Reuse is keyed by the current immutable comment hash. A changed comment
-- therefore misses this lookup and is recorded as a new assessment revision.
create function public.find_reusable_interaction_assessment(
  p_account_id uuid,
  p_connected_channel_id text,
  p_comment_id text,
  p_comment_text_hash text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'assessmentId', assessment.id,
    'accountId', assessment.account_id,
    'channelId', assessment.connected_channel_id,
    'commentId', assessment.comment_id,
    'commentTextHash', assessment.comment_text_hash,
    'videoId', assessment.video_id,
    'videoTitle', assessment.video_title,
    'category', assessment.category,
    'language', assessment.language,
    'target', assessment.target,
    'targetEvidence', assessment.target_evidence,
    'candidateText', assessment.candidate_text,
    'topLevelCommentText', assessment.top_level_comment_text,
    'neighboringReplies', assessment.neighboring_replies,
    'draftEligible', assessment.draft_eligible,
    'status', assessment.status,
    'assessedAt', assessment.assessed_at,
    'scanRunId', assessment.scan_run_id,
    'supersededAt', assessment.superseded_at,
    'deletedAt', assessment.deleted_at
  )
  from channel_private.interaction_assessments as assessment
  where assessment.account_id = p_account_id
    and assessment.connected_channel_id = btrim(p_connected_channel_id)
    and assessment.comment_id = p_comment_id
    and assessment.comment_text_hash = p_comment_text_hash
    and assessment.superseded_at is null
    and assessment.deleted_at is null
  order by assessment.assessed_at desc, assessment.id
  limit 1;
$$;

drop function public.complete_channel_scan_thread(uuid, uuid, uuid, text, uuid);

create function public.complete_channel_scan_thread(
  p_run_id uuid,
  p_worker_id uuid,
  p_work_item_id uuid,
  p_result_kind text,
  p_assessment_id uuid,
  p_interaction_assessment_id uuid,
  p_current_content_hash text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_worker_id uuid;
  current_status text;
  current_provider text;
  current_account_id uuid;
  current_channel_id text;
  item_status text;
  item_comment_id text;
  item_video_id text;
  item_content_hash text;
  current_content_hash text;
begin
  select worker_id, status, provider, account_id, connected_channel_id
  into current_worker_id, current_status, current_provider,
       current_account_id, current_channel_id
  from public.channel_scan_runs
  where id = p_run_id
  for update;
  if not found or current_status <> 'running' or current_worker_id <> p_worker_id then
    raise exception using errcode = 'P0001', message = 'scan worker lease is no longer owned';
  end if;
  if p_result_kind not in ('assessed', 'reused')
    or (p_assessment_id is null and p_interaction_assessment_id is null)
    or (p_assessment_id is not null and p_interaction_assessment_id is not null)
    or (current_provider = 'youtube' and p_interaction_assessment_id is null)
    or (current_provider = 'synthetic' and p_assessment_id is null)
    or (p_current_content_hash is not null
      and (char_length(p_current_content_hash) < 1
        or char_length(p_current_content_hash) > 256))
    or (current_provider = 'youtube'
      and (p_current_content_hash is null
        or p_current_content_hash !~ '^[a-f0-9]{64}$')) then
    raise exception using errcode = '22023', message = 'invalid scan completion';
  end if;

  select status, comment_id, video_id, content_hash
  into item_status, item_comment_id, item_video_id, item_content_hash
  from public.channel_scan_run_threads
  where id = p_work_item_id
    and run_id = p_run_id
  for update;
  if not found or item_status <> 'pending' then
    return;
  end if;

  current_content_hash := coalesce(p_current_content_hash, item_content_hash);

  if p_interaction_assessment_id is not null
    and not exists (
      select 1
      from channel_private.interaction_assessments as assessment
      where assessment.id = p_interaction_assessment_id
        and assessment.account_id = current_account_id
        and assessment.connected_channel_id = current_channel_id
        and assessment.comment_id = item_comment_id
        and assessment.video_id = item_video_id
        and assessment.comment_text_hash = current_content_hash
        and assessment.superseded_at is null
        and assessment.deleted_at is null
    ) then
    raise exception using errcode = '22023', message = 'interaction assessment is not bound to the scan item';
  end if;

  update public.channel_scan_run_threads
  set status = 'succeeded',
      result_kind = p_result_kind,
      assessment_id = p_assessment_id,
      interaction_assessment_id = p_interaction_assessment_id,
      content_hash = current_content_hash,
      updated_at = now()
  where id = p_work_item_id
    and run_id = p_run_id;

  update public.channel_scan_runs
  set threads_assessed = threads_assessed + case when p_result_kind = 'assessed' then 1 else 0 end,
      threads_reused = threads_reused + case when p_result_kind = 'reused' then 1 else 0 end
  where id = p_run_id;
end;
$$;

-- Delete all retained API comment text and bounded assessment provenance after
-- the policy window. The caller supplies only a small maintenance batch.
create function channel_private.cleanup_expired_interaction_assessments(
  p_limit integer default 500
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;

  with expired as (
    select assessment.id
    from channel_private.interaction_assessments as assessment
    where assessment.assessed_at < clock_timestamp() - interval '30 days'
      and not exists (
        select 1
        from public.channel_scan_run_threads as scan_thread
        where scan_thread.interaction_assessment_id = assessment.id
      )
    order by assessment.assessed_at, assessment.id
    limit least(greatest(coalesce(p_limit, 500), 1), 500)
  )
  delete from channel_private.interaction_assessments as assessment
  using expired
  where assessment.id = expired.id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create function public.cleanup_expired_interaction_assessments(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return jsonb_build_object(
    'outcome', 'cleaned',
    'deletedCount', channel_private.cleanup_expired_interaction_assessments(p_limit)
  );
end;
$$;

-- Scan pages and thread metadata are provider API Data too. Keep terminal Scan
-- Run history useful for the bounded UI window, then cascade its pages and
-- comment identifiers after the same 30-day retention deadline.
create function public.cleanup_expired_channel_scan_runs(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;

  with expired as (
    select id
    from public.channel_scan_runs
    where status in ('completed', 'partial', 'cancelled', 'failed')
      and completed_at < clock_timestamp() - interval '30 days'
    order by completed_at, id
    limit least(greatest(coalesce(p_limit, 500), 1), 500)
  )
  delete from public.channel_scan_runs as run
  using expired
  where run.id = expired.id;

  get diagnostics deleted_count = row_count;

  -- Run-thread links are released by the cascading run delete above. Remove
  -- the now-unreferenced old assessments in the same maintenance transaction.
  delete from channel_private.interaction_assessments as assessment
  where assessment.assessed_at < clock_timestamp() - interval '30 days'
    and not exists (
      select 1
      from public.channel_scan_run_threads as scan_thread
      where scan_thread.interaction_assessment_id = assessment.id
    );

  return jsonb_build_object(
    'outcome', 'cleaned',
    'deletedCount', deleted_count
  );
end;
$$;

revoke all on function public.start_channel_scan_run(
  uuid, text, text, timestamptz, timestamptz, uuid, text
)
  from public, anon, authenticated, service_role;
grant execute on function public.start_channel_scan_run(
  uuid, text, text, timestamptz, timestamptz, uuid, text
)
  to service_role;

revoke all on function public.resolve_channel_scan_target(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_channel_scan_target(uuid, text)
  to service_role;

revoke all on function public.find_reusable_interaction_assessment(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.find_reusable_interaction_assessment(uuid, text, text, text)
  to service_role;

revoke all on function public.complete_channel_scan_thread(uuid, uuid, uuid, text, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_channel_scan_thread(uuid, uuid, uuid, text, uuid, uuid, text)
  to service_role;

revoke all on function channel_private.cleanup_expired_interaction_assessments(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.cleanup_expired_interaction_assessments(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_expired_interaction_assessments(integer)
  to service_role;
revoke all on function public.cleanup_expired_channel_scan_runs(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_expired_channel_scan_runs(integer)
  to service_role;

notify pgrst, 'reload schema';
