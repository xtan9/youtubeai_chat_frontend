-- Atomically add one previously processed History Video to an owned Project.

create function public.add_project_history_video(
  p_project_id uuid,
  p_video_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_revision bigint;
  next_position smallint;
begin
  if actor_id is null then
    return jsonb_build_object('outcome', 'unauthenticated');
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

  if p_expected_revision is distinct from current_revision then
    return jsonb_build_object(
      'outcome', 'conflict',
      'revision', current_revision
    );
  end if;

  if exists (
    select 1
    from public.project_videos
    where project_id = p_project_id
      and video_id = p_video_id
  ) then
    return jsonb_build_object(
      'outcome', 'duplicate',
      'revision', current_revision
    );
  end if;

  if not exists (
    select 1
    from public.user_video_history
    where user_id = actor_id
      and video_id = p_video_id
  ) then
    return jsonb_build_object(
      'outcome', 'not_in_history',
      'revision', current_revision
    );
  end if;

  if not project_private.video_has_durable_ready_evidence(p_video_id) then
    return jsonb_build_object(
      'outcome', 'not_ready',
      'revision', current_revision
    );
  end if;

  select (count(*) + 1)::smallint
  into next_position
  from public.project_videos
  where project_id = p_project_id;

  if next_position > 5 then
    return jsonb_build_object(
      'outcome', 'limit_reached',
      'revision', current_revision
    );
  end if;

  insert into public.project_videos (
    project_id,
    video_id,
    position,
    status
  ) values (
    p_project_id,
    p_video_id,
    next_position,
    'ready'
  );

  update public.project_source_sets
  set revision = current_revision + 1,
      updated_at = now()
  where project_id = p_project_id
  returning revision into current_revision;

  return jsonb_build_object(
    'outcome', 'added',
    'revision', current_revision
  );
end;
$$;

revoke all on function public.add_project_history_video(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
