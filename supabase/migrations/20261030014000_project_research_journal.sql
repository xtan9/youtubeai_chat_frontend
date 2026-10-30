-- Research versions are server-published snapshots. Clients may read only their
-- own completed versions; neither browser writes nor updates to past conclusions
-- are permitted. A bounded lease serializes paid work within each Project.
create table public.project_research_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  base_version_id uuid,
  state text not null default 'reserved' check (state in ('reserved','completed','failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  document jsonb,
  check ((state = 'completed' and completed_at is not null and document is not null and jsonb_typeof(document) = 'object')
    or (state <> 'completed' and completed_at is null and document is null))
);
create index project_research_versions on public.project_research_runs(project_id, completed_at desc) where state = 'completed';
create unique index project_research_active on public.project_research_runs(project_id) where state = 'reserved';
alter table public.project_research_runs enable row level security;
revoke all on public.project_research_runs from public, anon, authenticated;
grant select on public.project_research_runs to authenticated;
grant select, insert, update, delete on public.project_research_runs to service_role;
create policy research_pipeline_write on public.project_research_runs for all to service_role using (true) with check (true);
create policy research_owner_read on public.project_research_runs for select to authenticated
using (state = 'completed' and exists (
  select 1 from public.projects p join public.workspaces w on w.id = p.workspace_id
  where p.id = project_id and w.owner_id = (select auth.uid())
));
create policy research_registered_gate on public.project_research_runs as restrictive for select to authenticated
using ((select project_private.has_registered_project_access()));

-- These service-only capabilities perform explicit Project ownership checks.
-- The browser has neither function execution nor table write privileges.
create function public.reserve_project_research(p_project_id uuid, p_owner_id uuid, p_base_version_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_id uuid; run_id uuid; pro boolean;
begin
  perform 1 from public.projects p join public.workspaces w on w.id=p.workspace_id
    where p.id=p_project_id and w.owner_id=p_owner_id for update of p;
  if not found then return jsonb_build_object('outcome','missing'); end if;
  update public.project_research_runs set state='failed'
    where project_id=p_project_id and state='reserved' and created_at < now()-interval '10 minutes';
  if exists(select 1 from public.project_research_runs where project_id=p_project_id and state='reserved') then
    return jsonb_build_object('outcome','busy'); end if;
  select id into current_id from public.project_research_runs where project_id=p_project_id and state='completed'
    order by completed_at desc, id desc limit 1;
  if current_id is distinct from p_base_version_id then return jsonb_build_object('outcome','conflict'); end if;
  select coalesce((select tier='pro' from public.user_subscriptions where user_id=p_owner_id),false)
    or coalesce((select raw_app_meta_data @> '{"is_smoke_account":true,"smoke_entitlement":"pro"}'::jsonb from auth.users where id=p_owner_id),false) into pro;
  if not pro and current_id is not null then return jsonb_build_object('outcome','limit_reached'); end if;
  insert into public.project_research_runs(project_id,base_version_id) values(p_project_id,current_id) returning id into run_id;
  return jsonb_build_object('outcome','started','id',run_id);
end $$;
revoke all on function public.reserve_project_research(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.reserve_project_research(uuid,uuid,uuid) to service_role;

create function public.complete_project_research(p_run_id uuid,p_owner_id uuid,p_document jsonb,p_source_set_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare run public.project_research_runs; current_revision bigint; current_id uuid;
begin
  select r.* into run from public.project_research_runs r
    join public.projects p on p.id=r.project_id join public.workspaces w on w.id=p.workspace_id
    where r.id=p_run_id and w.owner_id=p_owner_id for update of p, r;
  if not found or run.state <> 'reserved' or run.created_at < now()-interval '10 minutes' then
    return jsonb_build_object('outcome','conflict'); end if;
  select id into current_id from public.project_research_runs where project_id=run.project_id and state='completed'
    order by completed_at desc,id desc limit 1;
  select revision into current_revision from public.project_source_sets where project_id=run.project_id for share;
  if current_id is distinct from run.base_version_id or coalesce(current_revision,0) <> p_source_set_revision then
    return jsonb_build_object('outcome','conflict'); end if;
  if p_document is null or jsonb_typeof(p_document) <> 'object' or octet_length(p_document::text)>250000
    or p_document->>'promptVersion' is distinct from 'project-research-v1'
    or p_document->'sourceSetRevision' is distinct from to_jsonb(p_source_set_revision) then
    return jsonb_build_object('outcome','invalid'); end if;
  update public.project_research_runs set state='completed',completed_at=clock_timestamp(),document=p_document where id=p_run_id and state='reserved';
  if not found then return jsonb_build_object('outcome','conflict'); end if;
  update public.projects set last_active_at=clock_timestamp() where id=run.project_id;
  return jsonb_build_object('outcome','completed','version',jsonb_build_object('id',run.id,'created_at',run.created_at,'document',p_document));
end $$;
revoke all on function public.complete_project_research(uuid,uuid,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.complete_project_research(uuid,uuid,jsonb,bigint) to service_role;

-- Once published, even pipeline code must create a new version.
create function project_private.guard_completed_research_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.state = 'completed' then
    raise exception 'RESEARCH_VERSION_IMMUTABLE' using errcode='55000';
  end if;
  return new;
end $$;
revoke all on function project_private.guard_completed_research_version() from public, anon, authenticated, service_role;
create trigger research_versions_immutable before update on public.project_research_runs
for each row execute function project_private.guard_completed_research_version();
