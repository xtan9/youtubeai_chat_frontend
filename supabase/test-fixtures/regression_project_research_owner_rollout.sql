-- Run against a disposable PostgreSQL 17 database after the Project GA
-- migrations and before the research migration. The hosted migration role is
-- not a superuser: ADMIN membership does not imply INHERIT or SET permission.
-- psql -v migration_path=/absolute/path/to/research-migration.sql -f this-file
\set ON_ERROR_STOP on
begin;

do $$
begin
  if current_setting('server_version_num')::integer < 160000 then
    raise exception 'This regression requires per-grant INHERIT/SET options (PostgreSQL 16+)';
  end if;
end;
$$;

create role research_deployment_runner nologin nosuperuser inherit createrole;
create role research_hosted_admin nologin superuser;
grant usage, create on schema public, project_private to research_deployment_runner;

-- Give the caller direct ownership of its existing objects, without granting
-- it membership in any superuser or other object-owning role.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'project_private')
      and p.proowner = current_user::regrole and p.prokind = 'f'
  loop
    execute format('alter function %s owner to research_deployment_runner', f.signature);
  end loop;
end;
$$;
alter table public.project_conversation_messages owner to research_deployment_runner;
set local role research_hosted_admin;
grant project_beta_rpc_owner to research_deployment_runner
  with admin true, inherit false, set false;
reset role;

create temp table research_function_privileges_before as
select p.oid, p.proowner, p.proacl, p.prosecdef, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'project_private');
create temp table research_schema_privileges_before as
select oid, nspowner, nspacl from pg_namespace
where nspname in ('public', 'project_private');
create temp table research_memberships_before as
select roleid, member, grantor, admin_option, inherit_option, set_option
from pg_auth_members where roleid = 'project_beta_rpc_owner'::regrole;

create function pg_temp.assert_research_privileges_preserved() returns void
language plpgsql as $$
begin
  if exists (
    select 1 from research_function_privileges_before b
    left join pg_proc p on p.oid = b.oid
    where p.oid is null or row(p.proowner, p.proacl, p.prosecdef, p.proconfig)
      is distinct from row(b.proowner, b.proacl, b.prosecdef, b.proconfig)
  ) then
    raise exception 'Research migration changed an existing function owner, ACL, security mode, or search path';
  end if;
  if exists (
    select 1 from research_schema_privileges_before b
    left join pg_namespace n on n.oid = b.oid
    where n.oid is null or row(n.nspowner, n.nspacl) is distinct from row(b.nspowner, b.nspacl)
  ) then
    raise exception 'Research migration changed schema ownership or privileges';
  end if;
  if exists (
    (select * from research_memberships_before except
      select roleid, member, grantor, admin_option, inherit_option, set_option
      from pg_auth_members where roleid = 'project_beta_rpc_owner'::regrole)
    union all
    (select roleid, member, grantor, admin_option, inherit_option, set_option
      from pg_auth_members where roleid = 'project_beta_rpc_owner'::regrole
      except select * from research_memberships_before)
  ) then
    raise exception 'Research migration left or changed an owner-role membership grant';
  end if;
  if pg_has_role('research_deployment_runner', 'project_beta_rpc_owner', 'USAGE')
     or pg_has_role('research_deployment_runner', 'project_beta_rpc_owner', 'SET')
     or has_schema_privilege('project_beta_rpc_owner', 'public', 'CREATE') then
    raise exception 'Research migration left elevated owner-role privileges';
  end if;
end;
$$;

savepoint external_grant_only;
set local role research_deployment_runner;
do $$
begin
  if (select rolsuper from pg_roles where rolname = current_user)
     or not pg_has_role(current_user, 'project_beta_rpc_owner', 'MEMBER')
     or pg_has_role(current_user, 'project_beta_rpc_owner', 'USAGE')
     or pg_has_role(current_user, 'project_beta_rpc_owner', 'SET')
     or (select count(*) from pg_auth_members where member = current_user::regrole) <> 1
     or (select relowner <> current_user::regrole from pg_class
         where oid = 'public.project_conversation_messages'::regclass) then
    raise exception 'Fixture does not reproduce the hosted non-superuser migration role';
  end if;
end;
$$;
\i :migration_path
reset role;
select pg_temp.assert_research_privileges_preserved();
rollback to savepoint external_grant_only;

-- Also preserve an existing self-granted row and its ADMIN/SET options.
set local role research_deployment_runner;
grant project_beta_rpc_owner to research_deployment_runner
  with admin false, inherit false, set false granted by research_deployment_runner;
reset role;
truncate research_memberships_before;
insert into research_memberships_before
select roleid, member, grantor, admin_option, inherit_option, set_option
from pg_auth_members where roleid = 'project_beta_rpc_owner'::regrole;
set local role research_deployment_runner;
\i :migration_path
reset role;
select pg_temp.assert_research_privileges_preserved();

rollback;
\echo 'Research migration preserves hosted PG17 ownership, ACLs, and both membership shapes'
