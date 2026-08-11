-- General-availability authorization at the Supabase seam. Every permanent
-- authenticated user may use Projects; anonymous Auth users and the anon role
-- remain outside the durable Workspace model.

begin;

insert into auth.users (id, is_anonymous, raw_app_meta_data)
values
  (
    'ba000000-0000-4000-8000-000000000001',
    false,
    '{}'::jsonb
  ),
  (
    'ba000000-0000-4000-8000-000000000002',
    false,
    '{"project_beta_access":"unavailable"}'::jsonb
  ),
  (
    'ba000000-0000-4000-8000-000000000003',
    true,
    '{"project_beta_access":"internal"}'::jsonb
  )
on conflict (id) do update set
  is_anonymous = excluded.is_anonymous,
  raw_app_meta_data = excluded.raw_app_meta_data;

do $$
begin
  if (
    select count(*)
    from public.workspaces
    where owner_id in (
      'ba000000-0000-4000-8000-000000000001',
      'ba000000-0000-4000-8000-000000000002'
    )
  ) <> 2 then
    raise exception
      'REGRESSION: every permanent user must receive a Workspace';
  end if;

  if exists (
    select 1
    from public.workspaces
    where owner_id = 'ba000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'REGRESSION: anonymous user received a Workspace';
  end if;

  if not exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    join pg_roles as owner_role on owner_role.oid = procedure.proowner
    where namespace.nspname = 'project_private'
      and procedure.proname = 'has_registered_project_access'
      and procedure.pronargs = 0
      and procedure.prosecdef
      and owner_role.rolname <> 'project_beta_rpc_owner'
  ) then
    raise exception
      'REGRESSION: registered-access predicate lost its managed-auth boundary';
  end if;

  if to_regprocedure(
    'project_private.has_trusted_project_beta_access()'
  ) is not null
    or to_regprocedure(
      'project_private.project_beta_metadata_is_trusted(jsonb)'
    ) is not null
  then
    raise exception 'REGRESSION: retired invite predicates remain callable';
  end if;

  if (select rolcanlogin from pg_roles where rolname = 'project_beta_rpc_owner')
    or pg_has_role('authenticated', 'project_beta_rpc_owner', 'MEMBER')
    or pg_has_role('anon', 'project_beta_rpc_owner', 'MEMBER')
    or exists (
      select 1
      from pg_auth_members as membership
      join pg_roles as member_role on member_role.oid = membership.member
      join pg_roles as granted_role on granted_role.oid = membership.roleid
      where member_role.rolname = current_user
        and granted_role.rolname = 'project_beta_rpc_owner'
    )
  then
    raise exception 'REGRESSION: Project RPC owner gained a role path';
  end if;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'ba000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"ba000000-0000-4000-8000-000000000001","is_anonymous":false,"app_metadata":{},"user_metadata":{"project_beta_access":"internal"}}',
  true
);

do $$
begin
  if not project_private.has_registered_project_access() then
    raise exception 'REGRESSION: ordinary registered user lacks GA access';
  end if;
end;
$$;

insert into public.projects (id, workspace_id, name)
select
  'ba100000-0000-4000-8000-000000000001',
  workspaces.id,
  'GA Project'
from public.workspaces
where owner_id = 'ba000000-0000-4000-8000-000000000001';

do $$
declare
  result jsonb;
begin
  if (
    select count(*)
    from public.projects
    where id = 'ba100000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'REGRESSION: registered owner cannot use Project Data API';
  end if;

  result := public.list_project_conversations(
    'ba100000-0000-4000-8000-000000000001'
  );
  if result ->> 'outcome' <> 'ready' then
    raise exception 'REGRESSION: registered owner Project RPC returned %', result;
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'ba000000-0000-4000-8000-000000000002',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"ba000000-0000-4000-8000-000000000002","is_anonymous":false,"app_metadata":{"project_beta_access":"unavailable"}}',
  true
);

do $$
begin
  if not project_private.has_registered_project_access() then
    raise exception 'REGRESSION: legacy rollout metadata still gates GA';
  end if;
  if exists (
    select 1
    from public.projects
    where id = 'ba100000-0000-4000-8000-000000000001'
  ) then
    raise exception 'REGRESSION: GA weakened Project owner isolation';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'ba000000-0000-4000-8000-000000000003',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"ba000000-0000-4000-8000-000000000003","is_anonymous":true,"app_metadata":{"project_beta_access":"internal"}}',
  true
);

do $$
declare
  result jsonb;
begin
  if project_private.has_registered_project_access() then
    raise exception 'REGRESSION: anonymous Auth user gained Project access';
  end if;
  if exists (select 1 from public.workspaces) then
    raise exception 'REGRESSION: anonymous Auth user can read Workspaces';
  end if;
  result := public.list_project_conversations(
    'ba100000-0000-4000-8000-000000000001'
  );
  if result ->> 'outcome' <> 'missing' then
    raise exception 'REGRESSION: anonymous Project RPC returned %', result;
  end if;
end;
$$;

reset role;
set local role anon;
do $$
begin
  if has_table_privilege('anon', 'public.workspaces', 'SELECT')
    or has_table_privilege('anon', 'public.projects', 'SELECT')
  then
    raise exception 'REGRESSION: anon role gained durable Project access';
  end if;
end;
$$;
reset role;

rollback;

select 'Project GA access regression checks passed.' as result;
