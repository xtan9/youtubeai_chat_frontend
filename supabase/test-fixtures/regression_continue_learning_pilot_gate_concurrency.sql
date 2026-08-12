-- Continue Learning pilot cohort configuration race (Issue #357).

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

insert into auth.users (
  id,
  email,
  raw_app_meta_data,
  is_anonymous
) values (
  '35700000-0000-0000-0000-0000000000f1'::uuid,
  'pilot-race-owner@example.com',
  jsonb_build_object('is_admin', true),
  false
) on conflict (id) do update
set email = excluded.email,
    raw_app_meta_data = excluded.raw_app_meta_data;

do $race$
declare
  connection_string text := format(
    'host=127.0.0.1 port=5432 dbname=%I user=%I password=postgres',
    current_database(), current_user
  );
  first_result jsonb;
  second_result jsonb;
begin
  perform extensions.dblink_connect('continue_learning_pilot_gate_race_1', connection_string);
  perform extensions.dblink_connect('continue_learning_pilot_gate_race_2', connection_string);
  perform extensions.dblink_exec(
    'continue_learning_pilot_gate_race_1', 'set role service_role'
  );
  perform extensions.dblink_exec(
    'continue_learning_pilot_gate_race_2', 'set role service_role'
  );
  perform extensions.dblink_send_query(
    'continue_learning_pilot_gate_race_1',
    $$select public.configure_continue_learning_pilot_cohort(
      'continue-learning-pilot-race', 'draft',
      array['35700000-0000-0000-0000-000000000001'::uuid],
      '35700000-0000-0000-0000-0000000000f1'::uuid,
      'pilot-race-owner@example.com', clock_timestamp(), null
    )$$
  );
  perform extensions.dblink_send_query(
    'continue_learning_pilot_gate_race_2',
    $$select public.configure_continue_learning_pilot_cohort(
      'continue-learning-pilot-race', 'draft',
      array['35700000-0000-0000-0000-000000000001'::uuid],
      '35700000-0000-0000-0000-0000000000f1'::uuid,
      'pilot-race-owner@example.com', clock_timestamp(), null
    )$$
  );
  select raced.result into first_result
  from extensions.dblink_get_result('continue_learning_pilot_gate_race_1')
    as raced(result jsonb);
  perform cleared.result
  from extensions.dblink_get_result('continue_learning_pilot_gate_race_1')
    as cleared(result jsonb);
  select raced.result into second_result
  from extensions.dblink_get_result('continue_learning_pilot_gate_race_2')
    as raced(result jsonb);
  perform cleared.result
  from extensions.dblink_get_result('continue_learning_pilot_gate_race_2')
    as cleared(result jsonb);
  perform extensions.dblink_disconnect('continue_learning_pilot_gate_race_1');
  perform extensions.dblink_disconnect('continue_learning_pilot_gate_race_2');

  if first_result->>'outcome' <> 'configured'
    or second_result->>'outcome' <> 'configured'
  then
    raise exception 'cohort configuration race did not converge: %, %',
      first_result, second_result;
  end if;

  if (
    select count(*)
    from catalog_private.continue_learning_pilot_members
    where cohort_key = 'continue-learning-pilot-race'
  ) <> 1
  then
    raise exception 'cohort configuration race duplicated membership';
  end if;
end;
$race$;

delete from catalog_private.continue_learning_pilot_members
where cohort_key = 'continue-learning-pilot-race';
delete from catalog_private.continue_learning_pilot_cohorts
where cohort_key = 'continue-learning-pilot-race';
delete from auth.users
where id = '35700000-0000-0000-0000-0000000000f1'::uuid;
