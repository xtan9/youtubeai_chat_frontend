-- Continue Learning pilot cohort/readiness contract (Issue #357).

begin;

do $contract$
begin
  if to_regclass('catalog_private.continue_learning_pilot_cohorts') is null
    or to_regclass('catalog_private.continue_learning_pilot_members') is null
  then
    raise exception 'Continue Learning pilot cohort storage is missing';
  end if;

  if to_regprocedure(
      'public.configure_continue_learning_pilot_cohort(text,text,uuid[],uuid,text,timestamptz,timestamptz)'
    ) is null
    or to_regprocedure('public.get_continue_learning_pilot_eligibility(uuid)') is null
    or to_regprocedure('public.get_continue_learning_pilot_readiness()') is null
  then
    raise exception 'Continue Learning pilot gate RPC is missing';
  end if;

  if not (
    select relrowsecurity
    from pg_class
    where oid = 'catalog_private.continue_learning_pilot_cohorts'::regclass
  )
  or not (
    select relrowsecurity
    from pg_class
    where oid = 'catalog_private.continue_learning_pilot_members'::regclass
  )
  then
    raise exception 'Continue Learning pilot tables must enable RLS';
  end if;
end;
$contract$;

do $least_privilege$
begin
  if has_schema_privilege('anon', 'catalog_private', 'USAGE')
    or has_schema_privilege('authenticated', 'catalog_private', 'USAGE')
    or has_table_privilege(
      'service_role', 'catalog_private.continue_learning_pilot_cohorts', 'SELECT'
    )
    or has_table_privilege(
      'service_role', 'catalog_private.continue_learning_pilot_members', 'SELECT'
    )
    or has_function_privilege(
      'anon',
      'public.get_continue_learning_pilot_readiness()',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.get_continue_learning_pilot_eligibility(uuid)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.get_continue_learning_pilot_readiness()',
      'EXECUTE'
    )
  then
    raise exception 'Continue Learning pilot gate least privilege is incorrect';
  end if;
end;
$least_privilege$;

set local role anon;
do $anon_denial$
begin
  begin
    perform public.get_continue_learning_pilot_readiness();
    raise exception 'anon readiness read unexpectedly succeeded';
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
    perform public.get_continue_learning_pilot_eligibility(
      '35700000-0000-4000-8000-000000000001'::uuid
    );
    raise exception 'authenticated cohort read unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$authenticated_denial$;
reset role;

set local role service_role;
do $dormant_defaults$
declare
  actual_gate_ids text[];
  eligibility jsonb;
  expected_gate_ids constant text[] := array[
    'assessment_sets',
    'browser_verification',
    'candidate_pairs',
    'catalog_maintenance',
    'cohort',
    'concurrency',
    'delivery',
    'discovery',
    'feedback_analytics',
    'migration_security',
    'operations_cost',
    'performance',
    'quality_report',
    'semantic_evaluation',
    'semantic_human_approval'
  ];
  readiness jsonb;
begin
  select public.get_continue_learning_pilot_eligibility(
    '35700000-0000-4000-8000-000000000001'::uuid
  ) into eligibility;
  if eligibility->>'eligible' <> 'false'
    or eligibility->>'reason' <> 'cohort_unconfigured'
  then
    raise exception 'pilot eligibility did not fail closed: %', eligibility;
  end if;

  select public.get_continue_learning_pilot_readiness() into readiness;
  if readiness->>'decision' <> 'hold'
    or readiness->>'pilotFlag' <> 'off'
    or readiness->>'configuredState' <> 'off'
    or readiness->>'killSwitch' <> 'true'
  then
    raise exception 'pilot readiness did not remain off/hold: %', readiness;
  end if;

  select array_agg(gate->>'id' order by gate->>'id')
  into actual_gate_ids
  from jsonb_array_elements(readiness->'gates') as gate;

  if actual_gate_ids is distinct from expected_gate_ids then
    raise exception 'pilot readiness gate catalog drifted: expected %, got %',
      expected_gate_ids, actual_gate_ids;
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(readiness->'gates') as gate
    where gate->>'id' = 'semantic_evaluation'
      and gate->>'status' = 'hold'
  )
  or not exists (
    select 1
    from jsonb_array_elements(readiness->'gates') as gate
    where gate->>'id' = 'feedback_analytics'
      and gate->>'failureClass' = 'evidence_missing'
  )
  or not exists (
    select 1
    from jsonb_array_elements(readiness->'gates') as gate
    where gate->>'id' = 'discovery'
      and gate->>'failureClass' = 'dependency_open'
  )
  then
    raise exception 'pilot readiness did not expose required blockers: %', readiness;
  end if;
end;
$dormant_defaults$;
reset role;

do $admin_setup$
begin
  insert into auth.users (
    id,
    email,
    raw_app_meta_data,
    is_anonymous
  ) values (
    '35700000-0000-4000-8000-0000000000f1'::uuid,
    'pilot-owner@example.com',
    jsonb_build_object('is_admin', true),
    false
  ) on conflict (id) do update
  set email = excluded.email,
      raw_app_meta_data = excluded.raw_app_meta_data,
      is_anonymous = excluded.is_anonymous;
end;
$admin_setup$;

set local role service_role;
do $draft_cohort$
declare
  result jsonb;
  eligibility jsonb;
  readiness jsonb;
begin
  select public.configure_continue_learning_pilot_cohort(
    'continue-learning-pilot-fixture',
    'draft',
    array['35700000-0000-4000-8000-000000000001'::uuid],
    '35700000-0000-4000-8000-0000000000f1'::uuid,
    'pilot-owner@example.com',
    clock_timestamp(),
    null
  ) into result;
  if result->>'outcome' <> 'configured'
    or result->>'status' <> 'draft'
  then
    raise exception 'draft cohort was not configured: %', result;
  end if;

  select public.get_continue_learning_pilot_eligibility(
    '35700000-0000-4000-8000-000000000001'::uuid
  ) into eligibility;
  if eligibility->>'eligible' <> 'false'
    or eligibility->>'reason' <> 'cohort_unconfigured'
  then
    raise exception 'draft cohort became eligible: %', eligibility;
  end if;

  select public.configure_continue_learning_pilot_cohort(
    'continue-learning-pilot-fixture-two',
    'draft',
    array['35700000-0000-4000-8000-000000000002'::uuid],
    '35700000-0000-4000-8000-0000000000f1'::uuid,
    'pilot-owner@example.com',
    clock_timestamp(),
    null
  ) into result;
  if result->>'outcome' <> 'configured'
    or result->>'status' <> 'draft'
  then
    raise exception 'second draft cohort was not configured: %', result;
  end if;

  select public.get_continue_learning_pilot_readiness() into readiness;
  if readiness->>'decision' <> 'hold' then
    raise exception 'multiple draft cohorts changed readiness decision: %', readiness;
  end if;
end;
$draft_cohort$;

do $active_gate$
declare
  result jsonb;
begin
  select public.configure_continue_learning_pilot_cohort(
    'continue-learning-pilot-fixture',
    'active',
    array['35700000-0000-4000-8000-000000000001'::uuid],
    '35700000-0000-4000-8000-0000000000f1'::uuid,
    'pilot-owner@example.com',
    clock_timestamp(),
    null
  ) into result;
  if result->>'outcome' <> 'rejected'
    or result->>'reason' <> 'readiness_hold'
  then
    raise exception 'cohort activated without all launch gates: %', result;
  end if;
end;
$active_gate$;
reset role;

set local role service_role;
do $unauthorized_admin$
begin
  begin
    perform public.configure_continue_learning_pilot_cohort(
      'continue-learning-pilot-unauthorized',
      'draft',
      array['35700000-0000-4000-8000-000000000001'::uuid],
      '35700000-0000-4000-8000-0000000000ff'::uuid,
      'not-admin@example.com',
      clock_timestamp(),
      null
    );
    raise exception 'unauthorized cohort configuration unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$unauthorized_admin$;
reset role;

rollback;
