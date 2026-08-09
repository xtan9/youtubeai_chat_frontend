-- Atomically remove a membership and close its ordering gap.

create function public.remove_project_video(
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
  removed_position smallint;
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

  select revision
  into current_revision
  from public.project_source_sets
  where project_id = p_project_id
  for update;

  if current_revision is null then
    return jsonb_build_object('outcome', 'membership_missing', 'revision', 0);
  end if;

  if p_expected_revision is distinct from current_revision then
    return jsonb_build_object(
      'outcome', 'conflict',
      'revision', current_revision
    );
  end if;

  select position
  into removed_position
  from public.project_videos
  where project_id = p_project_id
    and video_id = p_video_id;

  if removed_position is null then
    return jsonb_build_object(
      'outcome', 'membership_missing',
      'revision', current_revision
    );
  end if;

  set constraints all deferred;

  delete from public.project_videos
  where project_id = p_project_id
    and video_id = p_video_id;

  update public.project_videos
  set position = position - 1
  where project_id = p_project_id
    and position > removed_position;

  update public.project_source_sets
  set revision = current_revision + 1,
      updated_at = now()
  where project_id = p_project_id
  returning revision into current_revision;

  return jsonb_build_object(
    'outcome', 'removed',
    'revision', current_revision
  );
end;
$$;

revoke all on function public.remove_project_video(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
