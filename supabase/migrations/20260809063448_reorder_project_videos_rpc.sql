-- Replace the complete membership order with optimistic revision checking.

create function public.reorder_project_videos(
  p_project_id uuid,
  p_video_ids uuid[],
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
  membership_count integer;
  current_order uuid[];
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
    current_revision := 0;
  end if;

  if p_expected_revision is distinct from current_revision then
    return jsonb_build_object(
      'outcome', 'conflict',
      'revision', current_revision
    );
  end if;

  select count(*),
         coalesce(array_agg(video_id order by position), '{}'::uuid[])
  into membership_count, current_order
  from public.project_videos
  where project_id = p_project_id;

  if p_video_ids is null
    or cardinality(p_video_ids) <> membership_count
    or cardinality(p_video_ids) > 5
    or (
      select count(distinct video_id)
      from unnest(p_video_ids) as requested(video_id)
    ) <> membership_count
    or exists (
      select 1
      from unnest(p_video_ids) as requested(video_id)
      where not exists (
        select 1
        from public.project_videos
        where project_id = p_project_id
          and project_videos.video_id = requested.video_id
      )
    ) then
    return jsonb_build_object(
      'outcome', 'invalid_order',
      'revision', current_revision
    );
  end if;

  if current_order = p_video_ids then
    return jsonb_build_object(
      'outcome', 'unchanged',
      'revision', current_revision
    );
  end if;

  set constraints all deferred;

  update public.project_videos
  set position = requested.position::smallint
  from unnest(p_video_ids) with ordinality as requested(video_id, position)
  where project_videos.project_id = p_project_id
    and project_videos.video_id = requested.video_id;

  update public.project_source_sets
  set revision = current_revision + 1,
      updated_at = now()
  where project_id = p_project_id
  returning revision into current_revision;

  return jsonb_build_object(
    'outcome', 'reordered',
    'revision', current_revision
  );
end;
$$;

revoke all on function public.reorder_project_videos(uuid, uuid[], bigint)
  from public, anon, authenticated, service_role;
