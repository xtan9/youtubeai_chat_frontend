-- A deployment or runtime timeout can strand durable processing state after
-- its background invocation has stopped. Classify leases older than the
-- route's five-minute maximum as an actionable failure on the next read.

create function public.expire_stale_project_video_processing(
  p_project_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision bigint;
  expired_count integer;
  expired_attempts jsonb;
begin
  perform 1
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;

  select revision
  into current_revision
  from public.project_source_sets
  where project_id = p_project_id
  for update;

  if current_revision is null then
    return jsonb_build_object(
      'outcome', 'unchanged',
      'revision', 0,
      'expiredCount', 0,
      'expiredAttempts', '[]'::jsonb
    );
  end if;

  with candidates as (
    select
      project_id,
      video_id,
      position,
      greatest(0, extract(epoch from (now() - status_updated_at)))::double precision
        as processing_seconds
    from public.project_videos
    where project_id = p_project_id
      and status = 'processing'
      and status_updated_at <= now() - interval '6 minutes'
    for update
  ), expired as (
    update public.project_videos
    set status = 'failed',
        failure_code = 'processing_interrupted',
        processing_attempt_id = null,
        status_updated_at = now()
    from candidates
    where project_videos.project_id = candidates.project_id
      and project_videos.video_id = candidates.video_id
    returning candidates.position, candidates.processing_seconds
  )
  select
    count(*)::integer,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'ordinal', position,
          'processingSeconds', processing_seconds
        )
        order by position
      ),
      '[]'::jsonb
    )
  into expired_count, expired_attempts
  from expired;

  if expired_count = 0 then
    return jsonb_build_object(
      'outcome', 'unchanged',
      'revision', current_revision,
      'expiredCount', 0,
      'expiredAttempts', '[]'::jsonb
    );
  end if;

  update public.project_source_sets
  set revision = current_revision + expired_count,
      updated_at = now()
  where project_id = p_project_id
  returning revision into current_revision;

  return jsonb_build_object(
    'outcome', 'expired',
    'revision', current_revision,
    'expiredCount', expired_count,
    'expiredAttempts', expired_attempts
  );
end;
$$;

revoke all on function public.expire_stale_project_video_processing(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.expire_stale_project_video_processing(uuid)
  to service_role;

notify pgrst, 'reload schema';
