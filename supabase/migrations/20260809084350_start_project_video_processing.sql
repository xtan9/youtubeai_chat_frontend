-- Atomically reserve one Project slot and one processing lease for a
-- canonical YouTube Video. Ownership, revision, and the universal cap are
-- decided before inserting a canonical Video, so rejected requests cannot
-- create cache rows or consume Summary quota.

create function public.start_project_video_processing(
  p_project_id uuid,
  p_youtube_video_id text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  canonical_video_id uuid;
  current_revision bigint;
  current_status text;
  current_status_updated_at timestamptz;
  next_position smallint;
  attempt_id uuid;
  canonical_url text;
begin
  if actor_id is null then
    return jsonb_build_object('outcome', 'unauthenticated');
  end if;

  if p_youtube_video_id is null
    or p_youtube_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    return jsonb_build_object('outcome', 'invalid_video');
  end if;

  perform 1
  from public.projects
  join public.workspaces
    on workspaces.id = projects.workspace_id
  where projects.id = p_project_id
    and workspaces.owner_id = actor_id
  for update of projects;

  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;

  insert into public.project_source_sets (project_id)
  values (p_project_id)
  on conflict (project_id) do nothing;

  select revision
  into current_revision
  from public.project_source_sets
  where project_id = p_project_id
  for update;

  select id
  into canonical_video_id
  from public.videos
  where url_hash = p_youtube_video_id;

  if canonical_video_id is not null then
    select status, status_updated_at, position
    into current_status, current_status_updated_at, next_position
    from public.project_videos
    where project_id = p_project_id
      and video_id = canonical_video_id;

    if current_status = 'ready' then
      return jsonb_build_object(
        'outcome', 'already_ready',
        'revision', current_revision,
        'videoId', canonical_video_id,
        'ordinal', next_position,
        'ownsProcessing', false
      );
    end if;

    if current_status = 'processing'
      and current_status_updated_at > now() - interval '6 minutes' then
      return jsonb_build_object(
        'outcome', 'already_processing',
        'revision', current_revision,
        'videoId', canonical_video_id,
        'ordinal', next_position,
        'ownsProcessing', false
      );
    end if;

    if current_status is not null then
      if p_expected_revision is distinct from current_revision then
        return jsonb_build_object(
          'outcome', 'conflict',
          'revision', current_revision,
          'ownsProcessing', false
        );
      end if;

      attempt_id := gen_random_uuid();
      update public.project_videos
      set status = 'processing',
          failure_code = null,
          processing_attempt_id = attempt_id,
          status_updated_at = now()
      where project_id = p_project_id
        and video_id = canonical_video_id;

      update public.project_source_sets
      set revision = current_revision + 1,
          updated_at = now()
      where project_id = p_project_id
      returning revision into current_revision;

      return jsonb_build_object(
        'outcome', 'retry_started',
        'revision', current_revision,
        'videoId', canonical_video_id,
        'ordinal', next_position,
        'attemptId', attempt_id,
        'ownsProcessing', true
      );
    end if;
  end if;

  if p_expected_revision is distinct from current_revision then
    return jsonb_build_object(
      'outcome', 'conflict',
      'revision', current_revision,
      'ownsProcessing', false
    );
  end if;

  select (count(*) + 1)::smallint
  into next_position
  from public.project_videos
  where project_id = p_project_id;

  if next_position > 5 then
    return jsonb_build_object(
      'outcome', 'limit_reached',
      'revision', current_revision,
      'ownsProcessing', false
    );
  end if;

  if canonical_video_id is null then
    canonical_url := 'https://www.youtube.com/watch?v=' || p_youtube_video_id;
    insert into public.videos (youtube_url, url_hash)
    values (canonical_url, p_youtube_video_id)
    on conflict (url_hash) do nothing
    returning id into canonical_video_id;

    if canonical_video_id is null then
      select id
      into canonical_video_id
      from public.videos
      where url_hash = p_youtube_video_id;
    end if;
  end if;

  attempt_id := gen_random_uuid();
  insert into public.project_videos (
    project_id,
    video_id,
    position,
    status,
    processing_attempt_id
  ) values (
    p_project_id,
    canonical_video_id,
    next_position,
    'processing',
    attempt_id
  );

  update public.project_source_sets
  set revision = current_revision + 1,
      updated_at = now()
  where project_id = p_project_id
  returning revision into current_revision;

  return jsonb_build_object(
    'outcome', 'started',
    'revision', current_revision,
    'videoId', canonical_video_id,
    'ordinal', next_position,
    'attemptId', attempt_id,
    'ownsProcessing', true
  );
end;
$$;

revoke all on function public.start_project_video_processing(uuid, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.start_project_video_processing(uuid, text, bigint)
  to authenticated;

notify pgrst, 'reload schema';
