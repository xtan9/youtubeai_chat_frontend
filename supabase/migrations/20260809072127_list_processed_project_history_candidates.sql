-- Search and page only History Videos whose durable canonical Transcript and
-- Summary make them eligible for a ready Project membership.

create function public.list_project_history_candidates(
  p_project_id uuid,
  p_search text,
  p_page integer,
  p_page_size integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_search text := nullif(btrim(p_search), '');
  safe_page integer := least(greatest(coalesce(p_page, 1), 1), 100000);
  safe_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 25);
  row_offset integer;
  candidate_count bigint;
  candidates jsonb;
begin
  if actor_id is null then
    return jsonb_build_object('outcome', 'unauthenticated');
  end if;

  if normalized_search is not null and length(normalized_search) > 100 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  if not exists (
    select 1
    from public.projects
    join public.workspaces
      on workspaces.id = projects.workspace_id
    where projects.id = p_project_id
      and workspaces.owner_id = actor_id
  ) then
    return jsonb_build_object('outcome', 'missing');
  end if;

  row_offset := (safe_page - 1) * safe_page_size;

  select count(*)
  into candidate_count
  from public.user_video_history
  join public.videos
    on videos.id = user_video_history.video_id
  where user_video_history.user_id = actor_id
    and not exists (
      select 1
      from public.project_videos
      where project_videos.project_id = p_project_id
        and project_videos.video_id = user_video_history.video_id
    )
    and project_private.video_has_durable_ready_evidence(
      user_video_history.video_id
    )
    and (
      normalized_search is null
      or coalesce(videos.title, '') ilike '%' || normalized_search || '%'
      or coalesce(videos.channel_name, '') ilike '%' || normalized_search || '%'
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'videoId', eligible.video_id,
        'youtubeUrl', eligible.youtube_url,
        'title', eligible.title,
        'channelName', eligible.channel_name,
        'viewedAt', eligible.accessed_at
      )
      order by eligible.accessed_at desc, eligible.video_id
    ),
    '[]'::jsonb
  )
  into candidates
  from (
    select
      user_video_history.video_id,
      user_video_history.accessed_at,
      videos.youtube_url,
      videos.title,
      videos.channel_name
    from public.user_video_history
    join public.videos
      on videos.id = user_video_history.video_id
    where user_video_history.user_id = actor_id
      and not exists (
        select 1
        from public.project_videos
        where project_videos.project_id = p_project_id
          and project_videos.video_id = user_video_history.video_id
      )
      and project_private.video_has_durable_ready_evidence(
        user_video_history.video_id
      )
      and (
        normalized_search is null
        or coalesce(videos.title, '') ilike '%' || normalized_search || '%'
        or coalesce(videos.channel_name, '') ilike '%' || normalized_search || '%'
      )
    order by user_video_history.accessed_at desc, user_video_history.video_id
    offset row_offset
    limit safe_page_size
  ) as eligible;

  return jsonb_build_object(
    'outcome', 'resolved',
    'page', safe_page,
    'pageSize', safe_page_size,
    'total', candidate_count,
    'totalPages', case
      when candidate_count = 0 then 0
      else ceil(candidate_count::numeric / safe_page_size)::integer
    end,
    'candidates', candidates
  );
end;
$$;

revoke all on function public.list_project_history_candidates(
  uuid, text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_project_history_candidates(
  uuid, text, integer, integer
) to authenticated;

notify pgrst, 'reload schema';
