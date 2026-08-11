-- Trusted invited-beta authorization at the Supabase seam. This fixture runs
-- after every migration on both representative legacy and fresh databases.

begin;

-- SECURITY DEFINER changes current_user to the function owner while retaining
-- the caller in the active role setting. Keep this disposable two-role proof
-- beside the RLS regression so policy changes cannot assume otherwise.
create role project_beta_fixture_caller nologin;
create role project_beta_fixture_definer nologin;
grant usage on schema project_private to project_beta_fixture_caller;

create function project_private.fixture_definer_context()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'currentUser', current_user,
    'roleSetting', current_setting('role', true)
  )
$$;
alter function project_private.fixture_definer_context()
  owner to project_beta_fixture_definer;
grant execute on function project_private.fixture_definer_context()
  to project_beta_fixture_caller;

set local role project_beta_fixture_caller;
do $$
begin
  if project_private.fixture_definer_context() <> jsonb_build_object(
    'currentUser', 'project_beta_fixture_definer',
    'roleSetting', 'project_beta_fixture_caller'
  ) then
    raise exception 'REGRESSION: SECURITY DEFINER caller context drifted';
  end if;
end;
$$;
reset role;

-- The browser roles cannot inherit or SET ROLE into the NOLOGIN RPC owner.
-- Only that owner may execute the private compatibility implementations used
-- by the four public wrappers whose ownership is transferred by the rollout.
do $$
declare
  claim_helper_signature text;
  helper_signature text;
begin
  if project_private.project_beta_metadata_is_trusted(
    '{"is_smoke_account":"true"}'::jsonb
  ) then
    raise exception 'REGRESSION: string smoke marker gained beta access';
  end if;

  if (
    select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    join pg_roles as owner_role on owner_role.oid = procedure.proowner
    where namespace.nspname = 'project_private'
      and procedure.proname in (
        'has_trusted_project_beta_access',
        'project_beta_request_uid',
        'project_beta_request_jwt'
      )
      and procedure.pronargs = 0
      and procedure.prosecdef
      and owner_role.rolname <> 'project_beta_rpc_owner'
  ) <> 3 then
    raise exception
      'REGRESSION: trusted beta predicate lost its managed-auth execution boundary';
  end if;

  foreach claim_helper_signature in array array[
    'project_private.project_beta_request_uid()',
    'project_private.project_beta_request_jwt()'
  ]
  loop
    if not has_function_privilege(
      'project_beta_rpc_owner',
      claim_helper_signature,
      'EXECUTE'
    )
      or has_function_privilege(
        'authenticated',
        claim_helper_signature,
        'EXECUTE'
      )
      or has_function_privilege(
        'anon',
        claim_helper_signature,
        'EXECUTE'
      )
      or has_function_privilege(
        'service_role',
        claim_helper_signature,
        'EXECUTE'
      )
    then
      raise exception
        'REGRESSION: unsafe Project request-claim helper grant for %',
        claim_helper_signature;
    end if;
  end loop;

  if exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    join pg_roles as owner_role on owner_role.oid = procedure.proowner
    where namespace.nspname = 'public'
      and owner_role.rolname = 'project_beta_rpc_owner'
      and (
        procedure.prosrc like '%auth.uid()%'
        or procedure.prosrc like '%auth.jwt()%'
      )
  ) then
    raise exception
      'REGRESSION: Project RPC owner still calls a managed auth helper directly';
  end if;

  if exists (
    select 1
    from pg_namespace as namespace
    cross join lateral aclexplode(
      coalesce(
        namespace.nspacl,
        acldefault('n', namespace.nspowner)
      )
    ) as privilege
    join pg_roles as grantee on grantee.oid = privilege.grantee
    where namespace.nspname = 'auth'
      and grantee.rolname = 'project_beta_rpc_owner'
  )
    or exists (
      select 1
      from pg_proc as procedure
      join pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      cross join lateral aclexplode(
        coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )
      ) as privilege
      join pg_roles as grantee on grantee.oid = privilege.grantee
      where namespace.nspname = 'auth'
        and procedure.proname in ('uid', 'jwt')
        and procedure.pronargs = 0
        and grantee.rolname = 'project_beta_rpc_owner'
    )
  then
    raise exception
      'REGRESSION: RPC owner received a managed-auth privilege grant';
  end if;

  if (select rolcanlogin from pg_roles where rolname = 'project_beta_rpc_owner')
    or pg_has_role('authenticated', 'project_beta_rpc_owner', 'MEMBER')
    or pg_has_role('anon', 'project_beta_rpc_owner', 'MEMBER')
    or exists (
      select 1
      from pg_auth_members as membership
      join pg_roles as member_role
        on member_role.oid = membership.member
      join pg_roles as granted_role
        on granted_role.oid = membership.roleid
      where member_role.rolname = current_user
        and granted_role.rolname = 'project_beta_rpc_owner'
    )
    or pg_has_role(
      'project_beta_rpc_owner',
      'authenticated',
      'MEMBER'
    )
    or exists (
      select 1
      from pg_namespace as namespace
      cross join lateral aclexplode(
        coalesce(
          namespace.nspacl,
          acldefault('n', namespace.nspowner)
        )
      ) as privilege
      join pg_roles as grantee on grantee.oid = privilege.grantee
      where namespace.nspname = 'public'
        and grantee.rolname = 'project_beta_rpc_owner'
        and privilege.privilege_type = 'CREATE'
    )
  then
    raise exception
      'REGRESSION: Project RPC owner retained a role or schema escalation path';
  end if;

  foreach helper_signature in array array[
    'public.load_project_conversation_legacy(uuid,uuid)',
    'public.start_project_grounded_question_v2_before_analytics(uuid,uuid,text,uuid,text)',
    'public.load_project_conversation_page_v2_before_analytics(uuid,uuid,timestamp with time zone,uuid,integer)',
    'public.load_project_grounded_attempt_v2_before_analytics(uuid,uuid,uuid)'
  ]
  loop
    if to_regprocedure(helper_signature) is null
      or not has_function_privilege(
        'project_beta_rpc_owner',
        helper_signature,
        'EXECUTE'
      )
      or has_function_privilege('authenticated', helper_signature, 'EXECUTE')
      or has_function_privilege('anon', helper_signature, 'EXECUTE')
      or has_function_privilege('service_role', helper_signature, 'EXECUTE')
    then
      raise exception
        'REGRESSION: unsafe Project RPC compatibility grant for %',
        helper_signature;
    end if;
  end loop;
end;
$$;

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
    '{"project_beta_access":"invited"}'::jsonb
  ),
  (
    'ba000000-0000-4000-8000-000000000003',
    false,
    '{"project_beta_access":"internal"}'::jsonb
  ),
  (
    'ba000000-0000-4000-8000-000000000004',
    false,
    '{"is_smoke_account":true}'::jsonb
  ),
  (
    'ba000000-0000-4000-8000-000000000005',
    false,
    '{"is_smoke_account":"true"}'::jsonb
  )
on conflict (id) do update set
  is_anonymous = excluded.is_anonymous,
  raw_app_meta_data = excluded.raw_app_meta_data;

do $$
begin
  if exists (
    select 1 from public.workspaces
    where owner_id in (
      'ba000000-0000-4000-8000-000000000001',
      'ba000000-0000-4000-8000-000000000005'
    )
  ) then
    raise exception 'REGRESSION: untrusted signup provisioned a Workspace';
  end if;

  if (
    select count(*) from public.workspaces
    where owner_id in (
      'ba000000-0000-4000-8000-000000000002',
      'ba000000-0000-4000-8000-000000000003',
      'ba000000-0000-4000-8000-000000000004'
    )
  ) <> 3 then
    raise exception 'REGRESSION: trusted beta signup did not provision every Workspace';
  end if;
end;
$$;

-- Model a pre-existing Workspace retained through the controlled rollout.
insert into public.workspaces (id, owner_id)
values (
  'bb000000-0000-4000-8000-000000000001',
  'ba000000-0000-4000-8000-000000000001'
)
on conflict (owner_id) do nothing;

insert into public.projects (id, workspace_id, name)
select
  fixture.project_id,
  workspaces.id,
  'Beta access fixture'
from public.workspaces
join (
  values
    (
      'ba000000-0000-4000-8000-000000000001'::uuid,
      'bc000000-0000-4000-8000-000000000001'::uuid
    ),
    (
      'ba000000-0000-4000-8000-000000000002'::uuid,
      'bc000000-0000-4000-8000-000000000002'::uuid
    ),
    (
      'ba000000-0000-4000-8000-000000000003'::uuid,
      'bc000000-0000-4000-8000-000000000003'::uuid
    ),
    (
      'ba000000-0000-4000-8000-000000000004'::uuid,
      'bc000000-0000-4000-8000-000000000004'::uuid
    )
) as fixture(owner_id, project_id)
  on fixture.owner_id = workspaces.owner_id
on conflict (id) do nothing;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'ba000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"ba000000-0000-4000-8000-000000000001","app_metadata":{},"user_metadata":{"project_beta_access":"internal","is_smoke_account":true}}',
  true
);

do $$
declare
  affected integer;
begin
  if exists (
    select 1 from public.workspaces
    where owner_id = 'ba000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'REGRESSION: uninvited JWT selected its Workspace';
  end if;

  if exists (
    select 1 from public.projects
    where workspace_id = 'bb000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'REGRESSION: uninvited JWT selected its Project';
  end if;

  begin
    insert into public.projects (workspace_id, name)
    values ('bb000000-0000-4000-8000-000000000001', 'Blocked insert');
    raise exception 'REGRESSION: uninvited JWT inserted a Project';
  exception when insufficient_privilege then null;
  end;

  update public.projects
  set name = 'Blocked update'
  where workspace_id = 'bb000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'REGRESSION: uninvited JWT updated a Project';
  end if;

  delete from public.projects
  where workspace_id = 'bb000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'REGRESSION: uninvited JWT deleted a Project';
  end if;

  if (public.list_project_conversations(
    'bc000000-0000-4000-8000-000000000001'
  ) ->> 'outcome') <> 'missing' then
    raise exception 'REGRESSION: uninvited JWT crossed a direct Project RPC';
  end if;
end;
$$;

-- Each trusted marker retains owner-only least privilege.
select set_config(
  'request.jwt.claim.sub',
  'ba000000-0000-4000-8000-000000000002',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"ba000000-0000-4000-8000-000000000002","app_metadata":{"project_beta_access":"invited"}}',
  true
);
do $$
begin
  if (select count(*) from public.workspaces) <> 1
    or (select count(*) from public.projects) <> 1 then
    raise exception 'REGRESSION: invited JWT lost owner access';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  'ba000000-0000-4000-8000-000000000003',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"ba000000-0000-4000-8000-000000000003","app_metadata":{"project_beta_access":"internal"}}',
  true
);
do $$
begin
  if (select count(*) from public.workspaces) <> 1
    or (select count(*) from public.projects) <> 1 then
    raise exception 'REGRESSION: internal JWT lost owner access';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  'ba000000-0000-4000-8000-000000000004',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"ba000000-0000-4000-8000-000000000004","app_metadata":{"is_smoke_account":true}}',
  true
);
do $$
begin
  if (select count(*) from public.workspaces) <> 1
    or (select count(*) from public.projects) <> 1 then
    raise exception 'REGRESSION: Smoke Account JWT lost owner access';
  end if;
end;
$$;

reset role;
rollback;
