-- Contract test for the personal Workspace + Project ownership boundary.
-- Run against both a fresh migration replay and the representative legacy
-- replay so schema drift, grants, indexes, constraints, and RLS fail CI.

begin;

-- The representative legacy path seeds this registered Researcher before
-- migrations. Fresh replay intentionally skips this conditional backfill proof.
do $$
declare
  backfilled_workspace_id uuid;
begin
  if exists (
    select 1
    from auth.users
    where id = '40000000-0000-4000-8000-000000000004'
  ) then
    select id
    into backfilled_workspace_id
    from public.workspaces
    where owner_id = '40000000-0000-4000-8000-000000000004';

    if backfilled_workspace_id is null then
      raise exception 'REGRESSION: pre-migration Researcher was not backfilled';
    end if;

    -- Repeat the real anonymous-to-registered provisioning transition twice.
    update auth.users
    set is_anonymous = true
    where id = '40000000-0000-4000-8000-000000000004';
    update auth.users
    set is_anonymous = false
    where id = '40000000-0000-4000-8000-000000000004';
    update auth.users
    set is_anonymous = true
    where id = '40000000-0000-4000-8000-000000000004';
    update auth.users
    set is_anonymous = false
    where id = '40000000-0000-4000-8000-000000000004';

    if (
      select count(*)
      from public.workspaces
      where owner_id = '40000000-0000-4000-8000-000000000004'
    ) <> 1 or (
      select id
      from public.workspaces
      where owner_id = '40000000-0000-4000-8000-000000000004'
    ) <> backfilled_workspace_id then
      raise exception 'REGRESSION: repeated backfill provisioning changed the Workspace identity';
    end if;
  end if;
end;
$$;

insert into auth.users (id, is_anonymous)
values
  ('10000000-0000-4000-8000-000000000001', false),
  ('20000000-0000-4000-8000-000000000002', false),
  ('30000000-0000-4000-8000-000000000003', true)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

select set_config(
  'fixture.owner_workspace_id',
  id::text,
  true
)
from public.workspaces
where owner_id = '10000000-0000-4000-8000-000000000001';

-- Repeating the real registration transition keeps the original Workspace.
update auth.users
set is_anonymous = true
where id = '10000000-0000-4000-8000-000000000001';
update auth.users
set is_anonymous = false
where id = '10000000-0000-4000-8000-000000000001';
update auth.users
set is_anonymous = true
where id = '10000000-0000-4000-8000-000000000001';
update auth.users
set is_anonymous = false
where id = '10000000-0000-4000-8000-000000000001';

do $$
begin
  if (
    select count(*)
    from public.workspaces
    where owner_id = '10000000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'REGRESSION: registered owner does not have exactly one Workspace';
  end if;

  if (
    select id::text
    from public.workspaces
    where owner_id = '10000000-0000-4000-8000-000000000001'
  ) <> current_setting('fixture.owner_workspace_id') then
    raise exception 'REGRESSION: repeated registration changed the Workspace identity';
  end if;

  if exists (
    select 1
    from public.workspaces
    where owner_id = '30000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'REGRESSION: anonymous user received a persistent Workspace';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.workspaces'::regclass
      and conname = 'workspaces_one_personal_per_owner'
      and contype = 'u'
  ) then
    raise exception 'REGRESSION: Workspace ownership constraint missing';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname = 'projects_name_valid'
      and contype = 'c'
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname = 'projects_goal_valid'
      and contype = 'c'
  ) then
    raise exception 'REGRESSION: Project metadata constraints missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'projects'
      and indexname = 'projects_workspace_recent_idx'
      and indexdef like '%(workspace_id, last_active_at DESC, id DESC)%'
  ) then
    raise exception 'REGRESSION: recent Project ordering index missing';
  end if;

  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.workspaces'::regclass
  ) or not (
    select relrowsecurity
    from pg_class
    where oid = 'public.projects'::regclass
  ) then
    raise exception 'REGRESSION: Workspace or Project RLS is disabled';
  end if;

  if not has_table_privilege('authenticated', 'public.workspaces', 'SELECT')
    or has_table_privilege('authenticated', 'public.workspaces', 'INSERT')
    or not has_table_privilege('authenticated', 'public.projects', 'SELECT')
    or not has_table_privilege('authenticated', 'public.projects', 'INSERT')
    or not has_table_privilege('authenticated', 'public.projects', 'UPDATE')
    or not has_table_privilege('authenticated', 'public.projects', 'DELETE')
    or has_table_privilege('anon', 'public.workspaces', 'SELECT')
    or has_table_privilege('anon', 'public.projects', 'SELECT')
  then
    raise exception 'REGRESSION: Workspace/Project grants are not least privilege';
  end if;
end;
$$;

-- Anonymous-to-registered conversion is the second provisioning path.
update auth.users
set is_anonymous = false
where id = '30000000-0000-4000-8000-000000000003';

select set_config(
  'fixture.converted_workspace_id',
  id::text,
  true
)
from public.workspaces
where owner_id = '30000000-0000-4000-8000-000000000003';

update auth.users
set is_anonymous = true
where id = '30000000-0000-4000-8000-000000000003';
update auth.users
set is_anonymous = false
where id = '30000000-0000-4000-8000-000000000003';

do $$
begin
  if (
    select count(*)
    from public.workspaces
    where owner_id = '30000000-0000-4000-8000-000000000003'
  ) <> 1 then
    raise exception 'REGRESSION: converted registered user lacks exactly one Workspace';
  end if;

  if (
    select id::text
    from public.workspaces
    where owner_id = '30000000-0000-4000-8000-000000000003'
  ) <> current_setting('fixture.converted_workspace_id') then
    raise exception 'REGRESSION: repeated conversion changed the Workspace identity';
  end if;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

insert into public.projects (id, workspace_id, name, goal)
select
  'a0000000-0000-4000-8000-000000000001',
  id,
  'Evidence review',
  'Compare the two explanations.'
from public.workspaces;

do $$
begin
  if (select count(*) from public.projects) <> 1 then
    raise exception 'REGRESSION: owner cannot create/read a Project';
  end if;

  begin
    insert into public.projects (workspace_id, name)
    select id, '   ' from public.workspaces;
    raise exception 'REGRESSION: whitespace-only Project name was accepted';
  exception
    when check_violation then null;
  end;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-4000-8000-000000000002',
  true
);

do $$
declare
  affected integer;
begin
  if (
    select count(*)
    from public.workspaces
    where owner_id = '20000000-0000-4000-8000-000000000002'
  ) <> 1 then
    raise exception 'REGRESSION: owner cannot read exactly their own Workspace';
  end if;

  if (select count(*) from public.projects) <> 0 then
    raise exception 'REGRESSION: cross-owner Project read escaped RLS';
  end if;

  update public.projects
  set name = 'Stolen'
  where id = 'a0000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'REGRESSION: cross-owner Project update escaped RLS';
  end if;

  delete from public.projects
  where id = 'a0000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'REGRESSION: cross-owner Project delete escaped RLS';
  end if;

  begin
    insert into public.projects (workspace_id, name)
    values (
      (current_setting('fixture.owner_workspace_id'))::uuid,
      'Cross-owner insert'
    );
    raise exception 'REGRESSION: cross-owner Project insert escaped RLS';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;
