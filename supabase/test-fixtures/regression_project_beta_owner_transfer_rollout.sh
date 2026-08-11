#!/usr/bin/env bash

# Execute the exact Project beta migration as a managed-Supabase-shaped
# migration role: it owns the existing objects through role membership and has
# CREATEROLE, but it is not itself a superuser. PostgreSQL still requires that
# caller to be able to SET ROLE to a function's new owner during ALTER OWNER.

set -euo pipefail

if [[ -z "${PGDATABASE:-}" ]]; then
  echo 'PGDATABASE is required' >&2
  exit 2
fi

migration_path="${1:-supabase/migrations/20260811055120_enforce_project_beta_access_at_database_boundary.sql}"
if [[ ! -f "$migration_path" ]]; then
  echo "Migration file not found: $migration_path" >&2
  exit 2
fi

runner_role='project_beta_deployment_runner'
migration_role="$(psql -X -A -t -q -v ON_ERROR_STOP=1 -c 'select current_user')"
if [[ ! "$migration_role" =~ ^[A-Za-z_][A-Za-z0-9_$]*$ ]]; then
  echo "Unsafe migration role name: $migration_role" >&2
  exit 2
fi

public_function_contract_before="$(psql -X -A -t -q -v ON_ERROR_STOP=1 -c "
  select md5(string_agg(
    concat_ws(
      '|',
      procedure.oid::text,
      procedure.proname,
      pg_get_function_identity_arguments(procedure.oid),
      pg_get_function_result(procedure.oid),
      procedure.prokind::text,
      procedure.provolatile::text,
      procedure.proparallel::text,
      procedure.proisstrict::text,
      procedure.prosecdef::text,
      procedure.proleakproof::text,
      procedure.proretset::text,
      procedure.procost::text,
      procedure.prorows::text,
      coalesce(procedure.proconfig::text, ''),
      coalesce((
        select string_agg(
          concat_ws(
            ':',
            coalesce(grantee.rolname, 'PUBLIC'),
            privilege.privilege_type,
            privilege.is_grantable::text
          ),
          ',' order by
            coalesce(grantee.rolname, 'PUBLIC'),
            privilege.privilege_type,
            privilege.is_grantable
        )
        from aclexplode(
          coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )
        ) as privilege
        left join pg_roles as grantee on grantee.oid = privilege.grantee
        where privilege.grantee <> procedure.proowner
      ), '')
    ),
    E'\\n' order by procedure.oid
  ))
  from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.oid not in (
      to_regprocedure('public.load_project_conversation_legacy(uuid,uuid)'),
      to_regprocedure('public.start_project_grounded_question_v2_before_analytics(uuid,uuid,text,uuid,text)'),
      to_regprocedure('public.load_project_conversation_page_v2_before_analytics(uuid,uuid,timestamp with time zone,uuid,integer)'),
      to_regprocedure('public.load_project_grounded_attempt_v2_before_analytics(uuid,uuid,uuid)')
    )
")"

cleanup() {
  set +e
  if [[ "$(psql -X -A -t -q -c "select exists (select 1 from pg_roles where rolname = '$runner_role')")" == 't' ]]; then
    psql -X -q -v ON_ERROR_STOP=1 -c \
      "reassign owned by \"$runner_role\" to \"$migration_role\"" \
      >/dev/null 2>&1 || true
    psql -X -q -v ON_ERROR_STOP=1 -c \
      "revoke \"$migration_role\" from \"$runner_role\"" \
      >/dev/null 2>&1 || true
    psql -X -q -v ON_ERROR_STOP=1 -c "drop role \"$runner_role\"" \
      >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ "$(psql -X -A -t -q -c "select exists (select 1 from pg_roles where rolname = '$runner_role')")" == 't' ]]; then
  echo "Deployment runner role already exists: $runner_role" >&2
  exit 1
fi

psql -X -q -v ON_ERROR_STOP=1 <<SQL
create role "$runner_role" nologin nosuperuser inherit createrole;
grant "$migration_role" to "$runner_role";
SQL

runner_context="$({
  PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c role=$runner_role" \
    psql -X -A -t -q -v ON_ERROR_STOP=1 -c \
      "select current_user, rolsuper, rolcreaterole from pg_roles where rolname = current_user"
} | tr -d '[:space:]')"
if [[ "$runner_context" != "$runner_role|f|t" ]]; then
  echo "Migration did not start as the non-superuser CREATEROLE runner: $runner_context" >&2
  exit 1
fi

PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c role=$runner_role" \
  psql -X --single-transaction -v ON_ERROR_STOP=1 -f "$migration_path"

membership="$({
  psql -X -A -t -q -v ON_ERROR_STOP=1 -c \
    "select exists (
      select 1
      from pg_auth_members as membership
      join pg_roles as member_role on member_role.oid = membership.member
      join pg_roles as granted_role on granted_role.oid = membership.roleid
      where member_role.rolname = '$runner_role'
        and granted_role.rolname = 'project_beta_rpc_owner'
    )"
} | tr -d '[:space:]')"
owner_count="$({
  psql -X -A -t -q -v ON_ERROR_STOP=1 -c \
    "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner where n.nspname = 'public' and r.rolname = 'project_beta_rpc_owner'"
} | tr -d '[:space:]')"
owner_has_direct_create="$({
  psql -X -A -t -q -v ON_ERROR_STOP=1 -c \
    "select exists (
      select 1
      from pg_namespace as namespace
      cross join lateral aclexplode(
        coalesce(namespace.nspacl, acldefault('n', namespace.nspowner))
      ) as privilege
      join pg_roles as grantee on grantee.oid = privilege.grantee
      where namespace.nspname = 'public'
        and grantee.rolname = 'project_beta_rpc_owner'
        and privilege.privilege_type = 'CREATE'
    )"
} | tr -d '[:space:]')"
direct_auth_call_count="$({
  psql -X -A -t -q -v ON_ERROR_STOP=1 -c \
    "select count(*)
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
      join pg_roles as owner_role on owner_role.oid = procedure.proowner
      where namespace.nspname = 'public'
        and owner_role.rolname = 'project_beta_rpc_owner'
        and (
          procedure.prosrc like '%auth.uid()%'
          or procedure.prosrc like '%auth.jwt()%'
        )"
} | tr -d '[:space:]')"
public_function_contract_after="$(psql -X -A -t -q -v ON_ERROR_STOP=1 -c "
  select md5(string_agg(
    concat_ws(
      '|',
      procedure.oid::text,
      procedure.proname,
      pg_get_function_identity_arguments(procedure.oid),
      pg_get_function_result(procedure.oid),
      procedure.prokind::text,
      procedure.provolatile::text,
      procedure.proparallel::text,
      procedure.proisstrict::text,
      procedure.prosecdef::text,
      procedure.proleakproof::text,
      procedure.proretset::text,
      procedure.procost::text,
      procedure.prorows::text,
      coalesce(procedure.proconfig::text, ''),
      coalesce((
        select string_agg(
          concat_ws(
            ':',
            coalesce(grantee.rolname, 'PUBLIC'),
            privilege.privilege_type,
            privilege.is_grantable::text
          ),
          ',' order by
            coalesce(grantee.rolname, 'PUBLIC'),
            privilege.privilege_type,
            privilege.is_grantable
        )
        from aclexplode(
          coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )
        ) as privilege
        left join pg_roles as grantee on grantee.oid = privilege.grantee
        where privilege.grantee <> procedure.proowner
      ), '')
    ),
    E'\\n' order by procedure.oid
  ))
  from pg_proc as procedure
  join pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.oid not in (
      to_regprocedure('public.load_project_conversation_legacy(uuid,uuid)'),
      to_regprocedure('public.start_project_grounded_question_v2_before_analytics(uuid,uuid,text,uuid,text)'),
      to_regprocedure('public.load_project_conversation_page_v2_before_analytics(uuid,uuid,timestamp with time zone,uuid,integer)'),
      to_regprocedure('public.load_project_grounded_attempt_v2_before_analytics(uuid,uuid,uuid)')
    )
")"
if [[ "$membership" != 'f' \
  || "$owner_count" != '25' \
  || "$owner_has_direct_create" != 'f' \
  || "$direct_auth_call_count" != '0' \
  || "$public_function_contract_before" != "$public_function_contract_after" \
]]; then
  echo "Unsafe Project RPC transfer result: membership=$membership owners=$owner_count create=$owner_has_direct_create auth_calls=$direct_auth_call_count contract_before=$public_function_contract_before contract_after=$public_function_contract_after" >&2
  exit 1
fi

cleanup
trap - EXIT

if [[ "$(psql -X -A -t -q -c "select exists (select 1 from pg_roles where rolname = '$runner_role')")" != 'f' ]]; then
  echo 'Deployment runner cleanup failed' >&2
  exit 1
fi

echo 'Project beta non-superuser owner transfer rollout: passed'
