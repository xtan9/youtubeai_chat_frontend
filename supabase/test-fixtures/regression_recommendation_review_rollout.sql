-- Private Recommendation Review, quality, and rollout contract (Issue #352).

begin;

do $contract$
begin
  if to_regclass('catalog_private.recommendation_review_policies') is null
    or to_regclass('catalog_private.recommendation_reviews') is null
    or to_regclass('catalog_private.recommendation_ready_read_events') is null
    or to_regclass('catalog_private.recommendation_quality_reports') is null
    or to_regclass('catalog_private.recommendation_rollout_controls') is null
  then
    raise exception 'Recommendation Review/quality/rollout storage is missing';
  end if;

  if to_regprocedure(
      'public.submit_recommendation_review(uuid,integer,uuid,text,boolean,boolean,boolean,boolean,boolean,text)'
    ) is null
    or to_regprocedure(
      'public.record_recommendation_ready_read(uuid,integer)'
    ) is null
    or to_regprocedure(
      'public.compute_recommendation_quality_report(text)'
    ) is null
    or to_regprocedure(
      'public.list_recommendation_reviews(uuid,text,text,text,text,text)'
    ) is null
    or to_regprocedure(
      'public.list_recommendation_reviews(uuid,text,text,text,text,text,text,text,text,text)'
    ) is null
    or to_regprocedure(
      'public.list_recommendation_reviews(uuid,text,text,text,text,text,text,text,text,text,text,text,text)'
    ) is null
    or to_regprocedure(
      'public.set_recommendation_rollout(text,boolean,uuid,uuid,text)'
    ) is null
    or to_regprocedure('public.get_recommendation_rollout()') is null
  then
    raise exception 'Recommendation Review/quality/rollout RPC is missing';
  end if;
end;
$contract$;

do $least_privilege$
begin
  if has_schema_privilege('anon', 'catalog_private', 'USAGE')
    or has_schema_privilege('authenticated', 'catalog_private', 'USAGE')
    or has_table_privilege(
      'service_role', 'catalog_private.recommendation_reviews', 'SELECT'
    )
    or has_table_privilege(
      'service_role', 'catalog_private.recommendation_reviews', 'INSERT'
    )
    or has_table_privilege(
      'service_role', 'catalog_private.recommendation_quality_reports', 'SELECT'
    )
    or has_table_privilege(
      'service_role', 'catalog_private.recommendation_rollout_controls', 'UPDATE'
    )
    or has_function_privilege(
      'anon',
      'public.compute_recommendation_quality_report(text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.set_recommendation_rollout(text,boolean,uuid,uuid,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.submit_recommendation_review(uuid,integer,uuid,text,boolean,boolean,boolean,boolean,boolean,text)',
      'EXECUTE'
    )
  then
    raise exception 'Recommendation Review/quality/rollout least privilege is incorrect';
  end if;
end;
$least_privilege$;

set local role anon;
do $anon_denial$
begin
  begin
    perform 1 from catalog_private.recommendation_reviews limit 1;
    raise exception 'anon read unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.get_recommendation_rollout();
    raise exception 'anon rollout read unexpectedly succeeded';
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
    perform 1 from catalog_private.recommendation_quality_reports limit 1;
    raise exception 'authenticated read unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.set_recommendation_rollout(
      'off', true, null::uuid, null::uuid, 'not-admin@example.com'
    );
    raise exception 'authenticated rollout mutation unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$authenticated_denial$;
reset role;

set local role service_role;
do $service_admin_gate$
begin
  begin
    perform public.set_recommendation_rollout(
      'off', true, null,
      '35200000-0000-4000-8000-000000000001'::uuid,
      'not-an-admin@example.com'
    );
    raise exception 'service-only rollout accepted an unverified admin';
  exception when insufficient_privilege then
    null;
  end;
end;
$service_admin_gate$;
reset role;

rollback;
