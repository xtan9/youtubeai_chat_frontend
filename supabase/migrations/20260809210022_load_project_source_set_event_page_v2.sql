-- Load the newest owner-visible Source Set activity first, then page backward
-- with an exact immutable event cursor. Returned pages are chronological.

create function public.load_project_source_set_event_page_v2(
  p_project_id uuid,
  p_before_created_at timestamptz default null,
  p_before_event_id uuid default null,
  p_event_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  researcher_id uuid := auth.uid();
  request_role text := current_setting('role', true);
  events jsonb := '[]'::jsonb;
  oldest_at timestamptz;
  oldest_id uuid;
  has_earlier boolean := false;
begin
  if request_role <> 'authenticated' or researcher_id is null
    or (p_before_created_at is null) <> (p_before_event_id is null)
    or p_event_limit not between 1 and 500
  then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if not exists (
    select 1
    from public.projects
    join public.workspaces on workspaces.id = projects.workspace_id
    where projects.id = p_project_id
      and workspaces.owner_id = researcher_id
  ) then
    return jsonb_build_object('outcome', 'missing');
  end if;

  with selected as materialized (
    select source_events.*
    from public.project_source_set_events as source_events
    where source_events.project_id = p_project_id
      and (
        p_before_created_at is null
        or (source_events.created_at, source_events.id)
          < (p_before_created_at, p_before_event_id)
      )
    order by source_events.created_at desc, source_events.id desc
    limit p_event_limit
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'eventId', selected.id,
      'projectId', selected.project_id,
      'revision', selected.revision,
      'kind', selected.event_kind,
      'videoId', selected.video_id,
      'videoTitle', selected.video_title,
      'fromPosition', selected.from_position,
      'toPosition', selected.to_position,
      'fromStatus', selected.from_status,
      'toStatus', selected.to_status,
      'createdAt', selected.created_at
    ) order by selected.created_at, selected.id
  ), '[]'::jsonb)
  into events
  from selected;

  with selected as materialized (
    select source_events.id, source_events.created_at
    from public.project_source_set_events as source_events
    where source_events.project_id = p_project_id
      and (
        p_before_created_at is null
        or (source_events.created_at, source_events.id)
          < (p_before_created_at, p_before_event_id)
      )
    order by source_events.created_at desc, source_events.id desc
    limit p_event_limit
  )
  select selected.id, selected.created_at
  into oldest_id, oldest_at
  from selected
  order by selected.created_at, selected.id
  limit 1;

  if oldest_id is not null then
    select exists (
      select 1
      from public.project_source_set_events as source_events
      where source_events.project_id = p_project_id
        and (source_events.created_at, source_events.id)
          < (oldest_at, oldest_id)
    ) into has_earlier;
  end if;

  return jsonb_build_object(
    'outcome', 'ready',
    'events', events,
    'nextCursor', case when has_earlier then jsonb_build_object(
      'createdAt', oldest_at,
      'eventId', oldest_id
    ) else null end
  );
end;
$$;

revoke all on function public.load_project_source_set_event_page_v2(
  uuid, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.load_project_source_set_event_page_v2(
  uuid, timestamptz, uuid, integer
) to authenticated;

notify pgrst, 'reload schema';
