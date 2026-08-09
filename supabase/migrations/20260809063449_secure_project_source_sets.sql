-- Owner-only reads and RPC-only authenticated writes for Project Source Sets.

alter table public.project_source_sets enable row level security;
alter table public.project_videos enable row level security;

create policy project_source_sets_owner_select
  on public.project_source_sets
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects
      join public.workspaces
        on workspaces.id = projects.workspace_id
      where projects.id = project_source_sets.project_id
        and workspaces.owner_id = (select auth.uid())
    )
  );

create policy project_videos_owner_select
  on public.project_videos
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects
      join public.workspaces
        on workspaces.id = projects.workspace_id
      where projects.id = project_videos.project_id
        and workspaces.owner_id = (select auth.uid())
    )
  );

-- service_role can inspect Source Set state for background processing, but
-- every membership/status write must use a revision-aware RPC.
create policy project_source_sets_service_select
  on public.project_source_sets
  for select
  to service_role
  using (true);

create policy project_videos_service_select
  on public.project_videos
  for select
  to service_role
  using (true);

revoke all on table public.project_source_sets
  from public, anon, authenticated, service_role;
revoke all on table public.project_videos
  from public, anon, authenticated, service_role;

grant select on table public.project_source_sets, public.project_videos
  to authenticated;
grant select on table public.project_source_sets, public.project_videos
  to service_role;

revoke all on function public.add_project_history_video(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.remove_project_video(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.reorder_project_videos(uuid, uuid[], bigint)
  from public, anon, authenticated, service_role;

grant execute on function public.add_project_history_video(uuid, uuid, bigint)
  to authenticated;
grant execute on function public.remove_project_video(uuid, uuid, bigint)
  to authenticated;
grant execute on function public.reorder_project_videos(uuid, uuid[], bigint)
  to authenticated;

notify pgrst, 'reload schema';
