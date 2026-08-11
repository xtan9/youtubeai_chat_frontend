-- Dormant Continue Learning reader contract (Issue #353).

begin;

do $contract$
begin
  if to_regprocedure(
    'public.read_continue_learning_recommendations(uuid,text,integer)'
  ) is null then
    raise exception 'Continue Learning reader RPC is missing';
  end if;

  if to_regprocedure(
    'catalog_private.read_continue_learning_recommendations(uuid,text,integer)'
  ) is null then
    raise exception 'private Continue Learning reader RPC is missing';
  end if;

  if exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'catalog_private'
      and relation.relname in (
        'recommendation_sets', 'recommendations',
        'recommendation_rollout_controls'
      )
      and relation.relrowsecurity is not true
  ) then
    raise exception 'private reader inputs must remain RLS protected';
  end if;

  if has_schema_privilege('anon', 'catalog_private', 'USAGE')
    or has_schema_privilege('authenticated', 'catalog_private', 'USAGE')
    or has_table_privilege(
      'service_role', 'catalog_private.recommendation_sets', 'SELECT'
    )
    or has_table_privilege(
      'service_role', 'catalog_private.recommendations', 'SELECT'
    )
    or has_table_privilege(
      'service_role', 'catalog_private.recommendation_rollout_controls', 'SELECT'
    )
    or has_function_privilege(
      'anon',
      'public.read_continue_learning_recommendations(uuid,text,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.read_continue_learning_recommendations(uuid,text,integer)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.read_continue_learning_recommendations(uuid,text,integer)',
      'EXECUTE'
    )
  then
    raise exception 'Continue Learning reader least privilege is incorrect';
  end if;
end;
$contract$;

set local role anon;
do $anon_denial$
begin
  begin
    perform public.read_continue_learning_recommendations(
      null::uuid, 'dQw4w9WgXcQ', 6
    );
    raise exception 'anon reader access unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$anon_denial$;
reset role;

set local role authenticated;
do $authenticated_denial$
begin
  begin
    perform public.read_continue_learning_recommendations(
      null::uuid, 'dQw4w9WgXcQ', 6
    );
    raise exception 'authenticated reader access unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$authenticated_denial$;
reset role;

set local role service_role;
do $service_fail_closed$
declare
  result jsonb;
begin
  result := public.read_continue_learning_recommendations(
    null::uuid, 'dQw4w9WgXcQ', 6
  );
  if result->>'outcome' <> 'unavailable'
    or result->>'reason' <> 'source_not_ready'
  then
    raise exception 'service reader did not fail closed: %', result;
  end if;
end;
$service_fail_closed$;
reset role;

rollback;
