-- Authenticated Researchers can access only Projects in their own Workspace.

alter table public.workspaces enable row level security;
alter table public.projects enable row level security;

create policy workspaces_owner_select
  on public.workspaces
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy projects_owner_select
  on public.projects
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = projects.workspace_id
        and workspaces.owner_id = (select auth.uid())
    )
  );

create policy projects_owner_insert
  on public.projects
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = projects.workspace_id
        and workspaces.owner_id = (select auth.uid())
    )
  );

create policy projects_owner_update
  on public.projects
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = projects.workspace_id
        and workspaces.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = projects.workspace_id
        and workspaces.owner_id = (select auth.uid())
    )
  );

create policy projects_owner_delete
  on public.projects
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = projects.workspace_id
        and workspaces.owner_id = (select auth.uid())
    )
  );

-- Public-schema tables are not assumed to be automatically exposed by the
-- Data API. Grants remain deliberately narrower than the RLS policies.
revoke all on table public.workspaces from public, anon, authenticated;
revoke all on table public.projects from public, anon, authenticated;
grant select on table public.workspaces to authenticated;
grant select, insert, update, delete on table public.projects to authenticated;
