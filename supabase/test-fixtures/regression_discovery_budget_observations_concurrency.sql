-- Real multi-session proof for the provider-independent Discovery Budget
-- reservation seam.  No external provider is called.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

drop trigger if exists fixture_discovery_observation_insert_barrier
  on catalog_private.discovery_observations;
drop function if exists catalog_private.fixture_discovery_observation_insert_barrier();

do $cleanup_discovery_demand$
begin
  alter table catalog_private.discovery_demand
    disable trigger discovery_demand_aggregation_history_trg;
  begin
    delete from catalog_private.discovery_demand
    where topic_key = 'fixture-discovery-race';
  exception when others then
    alter table catalog_private.discovery_demand
      enable trigger discovery_demand_aggregation_history_trg;
    raise;
  end;
  alter table catalog_private.discovery_demand
    enable trigger discovery_demand_aggregation_history_trg;
end;
$cleanup_discovery_demand$;

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

update catalog_private.discovery_budgets
set max_provider_quota_units = 3
where budget_day = current_date;

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
      where budget_day = current_date) <> 3
  then
    raise exception 'concurrent duplicate reservation consumed budget twice';
  end if;
end;
$idempotency$;

update catalog_private.discovery_budgets
set max_provider_quota_units = 4
where budget_day = current_date;

do $observation_reservation$
declare
  reservation jsonb;
begin
  set local role service_role;
  reservation := public.reserve_discovery_budget(
    current_date,
    'youtube_data_api_v3_search',
    'fixture-discovery-race',
    'en',
    'candidate-pair-policy-v1',
    repeat('d', 64),
    1,
    100
  );
  if reservation ->> 'outcome' <> 'reserved' then
    raise exception 'Observation race reservation failed: %', reservation;
  end if;
end;
$observation_reservation$;

create function catalog_private.fixture_discovery_observation_insert_barrier()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(355, 355);
  return new;
end;
$$;

revoke all on function catalog_private.fixture_discovery_observation_insert_barrier()
  from public, anon, authenticated, service_role;

create trigger fixture_discovery_observation_insert_barrier
before insert on catalog_private.discovery_observations
for each row
execute function catalog_private.fixture_discovery_observation_insert_barrier();

do $observation_conflict$
declare
  connection_string text := format(
    'host=127.0.0.1 port=5432 dbname=%I user=%I password=postgres',
    current_database(), current_user
  );
  first_backend_pid integer;
  second_backend_pid integer;
  waiting_backends integer;
  wait_attempts integer := 0;
  first_result jsonb;
  second_result jsonb;
  observed_at timestamptz := statement_timestamp();
  first_evidence_expires_at timestamptz := statement_timestamp() + interval '1 day';
  second_evidence_expires_at timestamptz := statement_timestamp() + interval '2 days';
  stored_evidence_expires_at timestamptz;
  expected_evidence_expires_at timestamptz;
  observation_count integer;
begin
  perform extensions.dblink_connect('discovery_observation_conflict_1', connection_string);
  perform extensions.dblink_connect('discovery_observation_conflict_2', connection_string);
  perform extensions.dblink_exec(
    'discovery_observation_conflict_1',
    'set role service_role'
  );
  perform extensions.dblink_exec(
    'discovery_observation_conflict_2',
    'set role service_role'
  );
  select remote.pid into first_backend_pid
  from extensions.dblink(
    'discovery_observation_conflict_1',
    'select pg_backend_pid()'
  ) as remote(pid integer);
  select remote.pid into second_backend_pid
  from extensions.dblink(
    'discovery_observation_conflict_2',
    'select pg_backend_pid()'
  ) as remote(pid integer);

  perform pg_catalog.pg_advisory_lock(355, 355);
  perform extensions.dblink_send_query(
    'discovery_observation_conflict_1',
    format(
      $$select public.record_discovery_observation(
        %L, %L, 'youtube_data_api_v3_search', 'obsrace0001', 1,
        'discovery-observation-v1', %L::timestamptz, %L::timestamptz
      )$$,
      repeat('d', 64),
      repeat('d', 64),
      observed_at,
      first_evidence_expires_at
    )
  );
  perform extensions.dblink_send_query(
    'discovery_observation_conflict_2',
    format(
      $$select public.record_discovery_observation(
        %L, %L, 'youtube_data_api_v3_search', 'obsrace0001', 1,
        'discovery-observation-v1', %L::timestamptz, %L::timestamptz
      )$$,
      repeat('d', 64),
      repeat('d', 64),
      observed_at,
      second_evidence_expires_at
    )
  );

  loop
    select count(*) into waiting_backends
    from pg_catalog.pg_stat_activity
    where pid in (first_backend_pid, second_backend_pid)
      and wait_event_type = 'Lock'
      and wait_event = 'advisory';
    exit when waiting_backends = 2;
    wait_attempts := wait_attempts + 1;
    if wait_attempts > 200 then
      perform pg_catalog.pg_advisory_unlock(355, 355);
      raise exception 'Observation race did not reach both insert barriers';
    end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;

  if not pg_catalog.pg_advisory_unlock(355, 355) then
    raise exception 'Observation race advisory lock was not held';
  end if;

  select raced.result into first_result
  from extensions.dblink_get_result('discovery_observation_conflict_1')
    as raced(result jsonb);
  perform cleared.result
  from extensions.dblink_get_result('discovery_observation_conflict_1')
    as cleared(result jsonb);
  select raced.result into second_result
  from extensions.dblink_get_result('discovery_observation_conflict_2')
    as raced(result jsonb);
  perform cleared.result
  from extensions.dblink_get_result('discovery_observation_conflict_2')
    as cleared(result jsonb);
  perform extensions.dblink_disconnect('discovery_observation_conflict_1');
  perform extensions.dblink_disconnect('discovery_observation_conflict_2');

  if not (
    (first_result ->> 'outcome' = 'recorded'
      and second_result ->> 'outcome' = 'observation_conflict')
    or (first_result ->> 'outcome' = 'observation_conflict'
      and second_result ->> 'outcome' = 'recorded')
  ) then
    raise exception 'concurrent conflicting Observation replay did not conflict: %, %',
      first_result, second_result;
  end if;

  expected_evidence_expires_at := case
    when first_result ->> 'outcome' = 'recorded'
      then first_evidence_expires_at
    else second_evidence_expires_at
  end;
  select count(*), max(evidence_expires_at)
  into observation_count, stored_evidence_expires_at
  from catalog_private.discovery_observations
  where observation_fingerprint = repeat('d', 64);
  if observation_count <> 1
    or stored_evidence_expires_at is distinct from expected_evidence_expires_at
  then
    raise exception 'concurrent conflicting Observation replay changed the winner: %, %',
      observation_count, stored_evidence_expires_at;
  end if;
end;
$observation_conflict$;

drop trigger fixture_discovery_observation_insert_barrier
  on catalog_private.discovery_observations;
drop function catalog_private.fixture_discovery_observation_insert_barrier();

do $cleanup_discovery_demand_final$
begin
  alter table catalog_private.discovery_demand
    disable trigger discovery_demand_aggregation_history_trg;
  begin
    delete from catalog_private.discovery_demand
    where topic_key = 'fixture-discovery-race';
  exception when others then
    alter table catalog_private.discovery_demand
      enable trigger discovery_demand_aggregation_history_trg;
    raise;
  end;
  alter table catalog_private.discovery_demand
    enable trigger discovery_demand_aggregation_history_trg;
end;
$cleanup_discovery_demand_final$;
