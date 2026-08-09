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
  ('30000000-0000-4000-8000-000000000003', true),
  ('50000000-0000-4000-8000-000000000005', false),
  ('70000000-0000-4000-8000-000000000007', false),
  ('80000000-0000-4000-8000-000000000008', false)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

insert into public.user_subscriptions (
  user_id,
  stripe_customer_id,
  tier,
  status
)
values (
  '50000000-0000-4000-8000-000000000005',
  'cus_project_contract_pro',
  'pro',
  'active'
)
on conflict (user_id) do update set
  tier = excluded.tier,
  status = excluded.status;

insert into public.monthly_summary_usage (user_id, year_month, count)
values ('10000000-0000-4000-8000-000000000001', '2026-08', 7)
on conflict (user_id, year_month) do update set count = excluded.count;

select set_config(
  'fixture.owner_workspace_id',
  id::text,
  true
)
from public.workspaces
where owner_id = '10000000-0000-4000-8000-000000000001';

select set_config(
  'fixture.foreign_workspace_id',
  id::text,
  true
)
from public.workspaces
where owner_id = '20000000-0000-4000-8000-000000000002';

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

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.projects'::regclass
      and tgname = 'projects_enforce_plan_limit'
      and not tgisinternal
  ) or not exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'project_private'
      and pg_proc.proname = 'enforce_project_plan_limit'
      and pg_proc.prosecdef
  ) then
    raise exception 'REGRESSION: atomic Project plan-limit trigger is missing';
  end if;

  if has_function_privilege(
    'authenticated',
    'project_private.enforce_project_plan_limit()',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'project_private.enforce_project_plan_limit()',
    'EXECUTE'
  ) then
    raise exception 'REGRESSION: Project plan-limit trigger function is directly callable';
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

do $$
declare
  missing_state text;
  missing_message text;
  foreign_state text;
  foreign_message text;
begin
  begin
    insert into public.projects (workspace_id, name)
    values ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Missing Workspace probe');
  exception
    when others then
      get stacked diagnostics
        missing_state = returned_sqlstate,
        missing_message = message_text;
  end;

  begin
    insert into public.projects (workspace_id, name)
    values (
      current_setting('fixture.foreign_workspace_id')::uuid,
      'Foreign Workspace probe'
    );
  exception
    when others then
      get stacked diagnostics
        foreign_state = returned_sqlstate,
        foreign_message = message_text;
  end;

  if missing_state <> '42501'
    or foreign_state <> missing_state
    or foreign_message <> missing_message
  then
    raise exception
      'REGRESSION: missing and foreign Workspace failures diverged (% %, % %)',
      missing_state,
      missing_message,
      foreign_state,
      foreign_message;
  end if;
end;
$$;

do $$
begin
  begin
    insert into public.projects (workspace_id, name)
    select id, '   ' from public.workspaces;
    raise exception 'REGRESSION: whitespace-only Project name was accepted';
  exception
    when check_violation then null;
  end;
end;
$$;

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
    select id, 'Second Free Project' from public.workspaces;
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'FREE_PROJECT_LIMIT_REACHED' then
        raise;
      end if;
  end;

  if exists (
    select 1 from public.projects where name = 'Second Free Project'
  ) then
    raise exception 'REGRESSION: Free owner created more than one durable Project';
  end if;

  delete from public.projects
  where id = 'a0000000-0000-4000-8000-000000000001';

  if (
    select count
    from public.monthly_summary_usage
    where user_id = '10000000-0000-4000-8000-000000000001'
      and year_month = '2026-08'
  ) <> 7 then
    raise exception 'REGRESSION: deleting a Project reset unrelated Summary usage';
  end if;

  insert into public.projects (id, workspace_id, name, goal)
  select
    'a0000000-0000-4000-8000-000000000001',
    id,
    'Evidence review',
    'Compare the two explanations.'
  from public.workspaces;

end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '50000000-0000-4000-8000-000000000005',
  true
);

insert into public.projects (workspace_id, name)
select id, name
from public.workspaces
cross join (values ('Pro Project A'), ('Pro Project B')) as names(name);

do $$
begin
  if (select count(*) from public.projects) <> 2 then
    raise exception 'REGRESSION: Pro owner is subject to the Free Project cap';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '70000000-0000-4000-8000-000000000007',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"70000000-0000-4000-8000-000000000007","app_metadata":{"is_smoke_account":true,"smoke_entitlement":"pro"}}',
  true
);

insert into public.projects (workspace_id, name)
select id, name
from public.workspaces
cross join (values ('Smoke Pro Project A'), ('Smoke Pro Project B')) as names(name);

do $$
begin
  if (select count(*) from public.projects) <> 2 then
    raise exception 'REGRESSION: trusted JWT app_metadata Smoke Pro is capped';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '80000000-0000-4000-8000-000000000008',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"80000000-0000-4000-8000-000000000008","user_metadata":{"is_smoke_account":true,"smoke_entitlement":"pro"}}',
  true
);

insert into public.projects (workspace_id, name)
select id, 'User metadata cannot grant Pro'
from public.workspaces;

do $$
begin
  begin
    insert into public.projects (workspace_id, name)
    select id, 'Blocked user metadata bypass'
    from public.workspaces;
    raise exception 'REGRESSION: user_metadata bypassed the Free Project cap';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'FREE_PROJECT_LIMIT_REACHED' then
        raise;
      end if;
  end;
end;
$$;

select set_config('request.jwt.claims', '', true);

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
