-- Real multi-session proof for the provider-independent Discovery Budget
-- reservation seam.  No external provider is called.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

delete from catalog_private.discovery_observations
where observation_fingerprint like 'f%';
delete from catalog_private.discovery_budget_reservations
where reservation_fingerprint like 'f%'
   or reservation_fingerprint = repeat('e', 64);
delete from catalog_private.discovery_budgets
where budget_day = current_date;
delete from catalog_private.discovery_demand
where topic_key = 'fixture-discovery-race';

insert into catalog_private.discovery_demand (
  topic_key,
  language_bucket,
  candidate_pair_policy_version,
  observation_count,
  first_observed_at,
  last_observed_at
) values (
  'fixture-discovery-race',
  'en',
  'candidate-pair-policy-v1',
  1,
  statement_timestamp(),
  statement_timestamp()
);

insert into catalog_private.discovery_budgets (
  budget_day,
  max_provider_quota_units,
  max_micro_usd
) values (current_date, 2, 1000);

do $fixture$
declare
  connection_string text := format(
    'host=127.0.0.1 port=5432 dbname=%I user=%I password=postgres',
    current_database(), current_user
  );
  connection_names text[] := array[
    'discovery_budget_race_1',
    'discovery_budget_race_2',
    'discovery_budget_race_3',
    'discovery_budget_race_4'
  ];
  connection_name text;
  result jsonb;
  reserved_count integer := 0;
  exhausted_count integer := 0;
  outcome text;
  reserved_units integer;
begin
  foreach connection_name in array connection_names loop
    perform extensions.dblink_connect(connection_name, connection_string);
    perform extensions.dblink_exec(connection_name, 'set role service_role');
    perform extensions.dblink_send_query(
      connection_name,
      format(
        $$select public.reserve_discovery_budget(
          current_date,
          'youtube_data_api_v3_search',
          'fixture-discovery-race',
          'en',
          'candidate-pair-policy-v1',
          %L,
          1,
          100
        )$$,
        repeat('f', 63) || right(connection_name, 1)
      )
    );
  end loop;

  foreach connection_name in array connection_names loop
    select raced.result into result
    from extensions.dblink_get_result(connection_name) as raced(result jsonb);
    perform cleared.result
    from extensions.dblink_get_result(connection_name) as cleared(result jsonb);
    outcome := result ->> 'outcome';
    if outcome = 'reserved' then
      reserved_count := reserved_count + 1;
    elsif outcome = 'budget_exhausted' then
      exhausted_count := exhausted_count + 1;
    else
      raise exception 'unexpected concurrent reservation result: %', result;
    end if;
    perform extensions.dblink_disconnect(connection_name);
  end loop;

  select reserved_provider_quota_units into reserved_units
  from catalog_private.discovery_budgets
  where budget_day = current_date;
  if reserved_count <> 2 or exhausted_count <> 2 or reserved_units <> 2 then
    raise exception 'concurrent Discovery Budget accounting was not bounded: %, %, %',
      reserved_count, exhausted_count, reserved_units;
  end if;
end;
$fixture$;

delete from catalog_private.discovery_budget_reservations
where reservation_fingerprint like 'f%'
   or reservation_fingerprint = repeat('e', 64);
delete from catalog_private.discovery_budgets
where budget_day = current_date;
insert into catalog_private.discovery_budgets (
  budget_day,
  max_provider_quota_units,
  max_micro_usd
) values (current_date, 1, 1000);

do $idempotency$
declare
  connection_string text := format(
    'host=127.0.0.1 port=5432 dbname=%I user=%I password=postgres',
    current_database(), current_user
  );
  first_result jsonb;
  second_result jsonb;
begin
  perform extensions.dblink_connect('discovery_budget_same_1', connection_string);
  perform extensions.dblink_connect('discovery_budget_same_2', connection_string);
  perform extensions.dblink_exec('discovery_budget_same_1', 'set role service_role');
  perform extensions.dblink_exec('discovery_budget_same_2', 'set role service_role');
  perform extensions.dblink_send_query(
    'discovery_budget_same_1',
    format(
      $$select public.reserve_discovery_budget(
        current_date, 'youtube_data_api_v3_search', 'fixture-discovery-race',
        'en', 'candidate-pair-policy-v1', %L, 1, 100
      )$$,
      repeat('e', 64)
    )
  );
  perform extensions.dblink_send_query(
    'discovery_budget_same_2',
    format(
      $$select public.reserve_discovery_budget(
        current_date, 'youtube_data_api_v3_search', 'fixture-discovery-race',
        'en', 'candidate-pair-policy-v1', %L, 1, 100
      )$$,
      repeat('e', 64)
    )
  );
  select raced.result into first_result
  from extensions.dblink_get_result('discovery_budget_same_1') as raced(result jsonb);
  perform cleared.result
  from extensions.dblink_get_result('discovery_budget_same_1') as cleared(result jsonb);
  select raced.result into second_result
  from extensions.dblink_get_result('discovery_budget_same_2') as raced(result jsonb);
  perform cleared.result
  from extensions.dblink_get_result('discovery_budget_same_2') as cleared(result jsonb);
  perform extensions.dblink_disconnect('discovery_budget_same_1');
  perform extensions.dblink_disconnect('discovery_budget_same_2');

  if not (
    (first_result ->> 'outcome' = 'reserved'
      and second_result ->> 'outcome' = 'already_reserved')
    or (first_result ->> 'outcome' = 'already_reserved'
      and second_result ->> 'outcome' = 'reserved')
  ) then
    raise exception 'concurrent duplicate reservation did not converge: %, %',
      first_result, second_result;
  end if;

  if (select reserved_provider_quota_units
      from catalog_private.discovery_budgets
      where budget_day = current_date) <> 1
  then
    raise exception 'concurrent duplicate reservation consumed budget twice';
  end if;
end;
$idempotency$;

delete from catalog_private.discovery_budget_reservations
where reservation_fingerprint like 'f%'
   or reservation_fingerprint = repeat('e', 64);
delete from catalog_private.discovery_budgets
where budget_day = current_date;
delete from catalog_private.discovery_demand
where topic_key = 'fixture-discovery-race';
