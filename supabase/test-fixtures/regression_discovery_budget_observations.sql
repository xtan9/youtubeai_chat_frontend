-- Provider-independent contract fixture for Issue #355.
--
-- The migration deliberately seeds no Discovery Budget.  This fixture creates
-- an explicit, isolated budget and Demand under the database owner, then
-- exercises the service-only reservation/Observation seams.  No provider is
-- called and no raw Search payload is stored.

begin;

set local role postgres;

delete from catalog_private.discovery_observations
where observation_fingerprint in (repeat('b', 64), repeat('c', 64));
delete from catalog_private.discovery_budget_reservations
where reservation_fingerprint in (repeat('a', 64), repeat('c', 64));
delete from catalog_private.discovery_budgets
where budget_day = current_date;
delete from catalog_private.discovery_demand
where topic_key in ('fixture-discovery-a', 'fixture-discovery-b');

insert into catalog_private.discovery_demand (
  topic_key,
  language_bucket,
  candidate_pair_policy_version,
  observation_count,
  first_observed_at,
  last_observed_at
) values
  (
    'fixture-discovery-a',
    'en',
    'candidate-pair-policy-v1',
    1,
    statement_timestamp() - interval '2 hours',
    statement_timestamp() - interval '2 hours'
  ),
  (
    'fixture-discovery-b',
    'en',
    'candidate-pair-policy-v1',
    1,
    statement_timestamp() - interval '1 hour',
    statement_timestamp() - interval '1 hour'
  );

update catalog_private.discovery_demand
set observation_count = observation_count + 1,
    last_observed_at = statement_timestamp() - interval '90 minutes'
where topic_key = 'fixture-discovery-a'
  and language_bucket = 'en'
  and candidate_pair_policy_version = 'candidate-pair-policy-v1';

-- Explicit fixture configuration.  Production has no row until an operator
-- configures a real Discovery Budget through a separately governed path.
insert into catalog_private.discovery_budgets (
  budget_day,
  max_provider_quota_units,
  max_micro_usd
) values (current_date, 2, 1000);

do $fixture$
declare
  demand_rows record;
  reservation jsonb;
  duplicate_reservation jsonb;
  conflict_reservation jsonb;
  second_reservation jsonb;
  exhausted_reservation jsonb;
  observation jsonb;
  duplicate_observation jsonb;
  conflict_observation jsonb;
  invalid_observation jsonb;
  reserved_units integer;
  reserved_cost bigint;
  observed_at timestamptz;
  evidence_expires_at timestamptz;
begin
  set local role service_role;

  select * into demand_rows
  from public.list_pending_discovery_demand(10)
  where topic_key = 'fixture-discovery-a';
  if demand_rows.topic_key is distinct from 'fixture-discovery-a'
    or demand_rows.language_bucket is distinct from 'en'
  then
    raise exception 'pending Demand list did not expose the governed bucket';
  end if;

  reservation := public.reserve_discovery_budget(
    current_date,
    'youtube_data_api_v3_search',
    'fixture-discovery-a',
    'en',
    'candidate-pair-policy-v1',
    repeat('a', 64),
    1,
    100
  );
  if reservation ->> 'outcome' <> 'reserved'
    or (reservation ->> 'remainingProviderQuotaUnits')::integer <> 1
    or (reservation ->> 'remainingMicroUsd')::bigint <> 900
  then
    raise exception 'initial Discovery Budget reservation was incorrect: %', reservation;
  end if;

  duplicate_reservation := public.reserve_discovery_budget(
    current_date,
    'youtube_data_api_v3_search',
    'fixture-discovery-a',
    'en',
    'candidate-pair-policy-v1',
    repeat('a', 64),
    1,
    100
  );
  if duplicate_reservation ->> 'outcome' <> 'already_reserved'
    or duplicate_reservation ->> 'reservationId' <> reservation ->> 'reservationId'
  then
    raise exception 'duplicate reservation did not converge: %', duplicate_reservation;
  end if;

  conflict_reservation := public.reserve_discovery_budget(
    current_date,
    'youtube_data_api_v3_search',
    'fixture-discovery-b',
    'en',
    'candidate-pair-policy-v1',
    repeat('a', 64),
    2,
    200
  );
  if conflict_reservation ->> 'outcome' <> 'reservation_conflict' then
    raise exception 'reservation fingerprint was reused with different inputs: %',
      conflict_reservation;
  end if;

  second_reservation := public.reserve_discovery_budget(
    current_date,
    'youtube_data_api_v3_search',
    'fixture-discovery-b',
    'en',
    'candidate-pair-policy-v1',
    repeat('c', 64),
    1,
    100
  );
  if second_reservation ->> 'outcome' <> 'reserved'
    or (second_reservation ->> 'remainingProviderQuotaUnits')::integer <> 0
    or (second_reservation ->> 'remainingMicroUsd')::bigint <> 800
  then
    raise exception 'second Discovery Budget reservation was incorrect: %', second_reservation;
  end if;

  exhausted_reservation := public.reserve_discovery_budget(
    current_date,
    'youtube_data_api_v3_search',
    'fixture-discovery-a',
    'en',
    'candidate-pair-policy-v1',
    repeat('d', 64),
    1,
    100
  );
  if exhausted_reservation ->> 'outcome' <> 'budget_exhausted' then
    raise exception 'exhausted Discovery Budget admitted a request: %', exhausted_reservation;
  end if;

  -- Service-role callers may use the RPCs but cannot read private ledger rows.
  -- The owner-only assertion below verifies the counters without weakening that
  -- boundary for the RPC caller under test.
  set local role postgres;
  select reserved_provider_quota_units, reserved_micro_usd
  into reserved_units, reserved_cost
  from catalog_private.discovery_budgets
  where budget_day = current_date;
  if reserved_units <> 2 or reserved_cost <> 200 then
    raise exception 'Discovery Budget counters were not atomic: %, %',
      reserved_units, reserved_cost;
  end if;
  set local role service_role;

  observed_at := statement_timestamp();
  evidence_expires_at := observed_at + interval '1 day';

  observation := public.record_discovery_observation(
    repeat('a', 64),
    repeat('b', 64),
    'youtube_data_api_v3_search',
    'obsfix00001',
    1,
    'discovery-observation-v1',
    observed_at,
    evidence_expires_at
  );
  if observation ->> 'outcome' <> 'recorded'
    or observation ->> 'youtubeVideoId' <> 'obsfix00001'
  then
    raise exception 'normalized Discovery Observation was not recorded: %', observation;
  end if;

  duplicate_observation := public.record_discovery_observation(
    repeat('a', 64),
    repeat('b', 64),
    'youtube_data_api_v3_search',
    'obsfix00001',
    1,
    'discovery-observation-v1',
    observed_at,
    evidence_expires_at
  );
  if duplicate_observation ->> 'outcome' <> 'already_recorded'
    or duplicate_observation ->> 'observationId' <> observation ->> 'observationId'
  then
    raise exception 'duplicate Observation did not converge: %', duplicate_observation;
  end if;

  -- Reservations are immutable cost-accounting records, and Observations are
  -- immutable provider-evidence records. The database owner must not be able
  -- to rewrite or erase either ledger after the RPC has recorded it.
  set local role postgres;
  begin
    update catalog_private.discovery_budget_reservations
    set provider_quota_units = provider_quota_units + 1
    where reservation_fingerprint = repeat('a', 64);
    raise exception 'Discovery Budget reservation was mutable';
  exception when raise_exception then
    if sqlerrm <> 'Discovery Budget reservations are immutable' then
      raise;
    end if;
  end;
  begin
    delete from catalog_private.discovery_budget_reservations
    where reservation_fingerprint = repeat('a', 64);
    raise exception 'Discovery Budget reservation was deletable';
  exception when raise_exception then
    if sqlerrm <> 'Discovery Budget reservations are immutable' then
      raise;
    end if;
  end;
  begin
    update catalog_private.discovery_observations as stored_observation
    set evidence_expires_at = stored_observation.evidence_expires_at
      + interval '1 day'
    where stored_observation.observation_fingerprint = repeat('b', 64);
    raise exception 'Discovery Observation was mutable';
  exception when raise_exception then
    if sqlerrm <> 'Discovery Observations are immutable' then
      raise;
    end if;
  end;
  begin
    delete from catalog_private.discovery_observations
    where observation_fingerprint = repeat('b', 64);
    raise exception 'Discovery Observation was deletable';
  exception when raise_exception then
    if sqlerrm <> 'Discovery Observations are immutable' then
      raise;
    end if;
  end;
  set local role service_role;

  conflict_observation := public.record_discovery_observation(
    repeat('a', 64),
    repeat('b', 64),
    'youtube_data_api_v3_search',
    'obsfix00002',
    2,
    'discovery-observation-v1',
    statement_timestamp(),
    statement_timestamp() + interval '1 day'
  );
  if conflict_observation ->> 'outcome' <> 'observation_conflict' then
    raise exception 'Observation fingerprint was reused with different inputs: %',
      conflict_observation;
  end if;

  invalid_observation := public.record_discovery_observation(
    repeat('a', 64),
    repeat('c', 64),
    'unsupported_provider',
    'obsfix00002',
    2,
    'discovery-observation-v1',
    statement_timestamp(),
    statement_timestamp() + interval '1 day'
  );
  if invalid_observation ->> 'outcome' <> 'skipped'
    or invalid_observation ->> 'reason' <> 'provider' then
    raise exception 'unsupported Discovery provider was accepted: %', invalid_observation;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'catalog_private'
      and table_name = 'discovery_observations'
      and column_name in (
        'learner_id', 'source_video_id', 'source_request_id', 'query',
        'history_id', 'summary_id', 'transcript_id', 'raw_payload'
      )
  ) then
    raise exception 'Discovery Observation schema contains forbidden learner/content columns';
  end if;

  begin
    perform 1 from catalog_private.discovery_budgets;
    raise exception 'service_role could read private Discovery Budget rows';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from catalog_private.discovery_observations;
    raise exception 'service_role could read private Discovery Observation rows';
  exception when insufficient_privilege then
    null;
  end;

  set local role anon;
  begin
    perform public.reserve_discovery_budget(
      current_date, 'youtube_data_api_v3_search', 'fixture-discovery-a', 'en',
      'candidate-pair-policy-v1', repeat('e', 64), 1, 100
    );
    raise exception 'anon role could reserve Discovery Budget';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from catalog_private.discovery_demand;
    raise exception 'anon role could read Discovery Demand';
  exception when insufficient_privilege then
    null;
  end;

  set local role authenticated;
  begin
    perform public.record_discovery_observation(
      repeat('a', 64), repeat('e', 64), 'youtube_data_api_v3_search',
      'obsfix00003', 3, 'discovery-observation-v1', statement_timestamp(),
      statement_timestamp() + interval '1 day'
    );
    raise exception 'authenticated role could record Discovery Observation';
  exception when insufficient_privilege then
    null;
  end;
end;
$fixture$;

rollback;
