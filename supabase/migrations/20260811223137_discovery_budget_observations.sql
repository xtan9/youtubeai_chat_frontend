-- Provider-independent Discovery Budget and Observation contract (Issue #355).
--
-- This migration deliberately adds no budget row, worker, queue, provider
-- call, canonical Video upsert, or Discovery Demand.  An explicitly governed
-- operator configuration must create a daily budget row before a service
-- worker can reserve provider quota.  The reservation and Observation RPCs
-- are the private, idempotent boundary a future YouTube Search worker will
-- use; they never retain raw queries, payloads, or learner-linked identity.

create table catalog_private.discovery_budgets (
  budget_day date primary key,
  max_provider_quota_units integer not null check (max_provider_quota_units > 0),
  max_micro_usd bigint not null check (max_micro_usd > 0),
  reserved_provider_quota_units integer not null default 0
    check (reserved_provider_quota_units >= 0),
  reserved_micro_usd bigint not null default 0
    check (reserved_micro_usd >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (reserved_provider_quota_units <= max_provider_quota_units),
  check (reserved_micro_usd <= max_micro_usd)
);

create table catalog_private.discovery_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  budget_day date not null references catalog_private.discovery_budgets(budget_day)
    on delete restrict,
  reservation_fingerprint text not null unique check (
    reservation_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  provider text not null check (provider = 'youtube_data_api_v3_search'),
  topic_key text not null check (
    topic_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  language_bucket text not null check (
    language_bucket ~ '^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$'
  ),
  candidate_pair_policy_version text not null references
    catalog_private.recommendation_candidate_pair_policies(policy_version)
    on delete restrict,
  observation_policy_version text not null check (
    observation_policy_version = 'discovery-observation-v1'
  ),
  provider_quota_units integer not null check (provider_quota_units > 0),
  estimated_micro_usd bigint not null check (estimated_micro_usd >= 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (budget_day, reservation_fingerprint)
);

create index discovery_budget_reservations_demand_idx
  on catalog_private.discovery_budget_reservations (
    budget_day, topic_key, language_bucket, created_at
  );

create table catalog_private.discovery_observations (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references
    catalog_private.discovery_budget_reservations(id) on delete restrict,
  observation_fingerprint text not null unique check (
    observation_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  provider text not null check (provider = 'youtube_data_api_v3_search'),
  topic_key text not null check (
    topic_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  language_bucket text not null check (
    language_bucket ~ '^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$'
  ),
  youtube_video_id text not null check (
    youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'
  ),
  position integer not null check (position between 1 and 50),
  policy_version text not null check (
    policy_version = 'discovery-observation-v1'
  ),
  observed_at timestamptz not null,
  evidence_expires_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (evidence_expires_at > observed_at),
  unique (reservation_id, youtube_video_id, position)
);

create index discovery_observations_demand_recency_idx
  on catalog_private.discovery_observations (
    topic_key, language_bucket, policy_version, observed_at desc
  );
create index discovery_observations_video_idx
  on catalog_private.discovery_observations (youtube_video_id, observed_at desc);

alter table catalog_private.discovery_budgets enable row level security;
alter table catalog_private.discovery_budget_reservations enable row level security;
alter table catalog_private.discovery_observations enable row level security;

revoke all on table catalog_private.discovery_budgets
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.discovery_budget_reservations
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.discovery_observations
  from public, anon, authenticated, service_role;

create or replace function catalog_private.list_pending_discovery_demand(
  p_limit integer
)
returns table (
  topic_key text,
  language_bucket text,
  candidate_pair_policy_version text,
  observation_count bigint,
  first_observed_at timestamptz,
  last_observed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    demand.topic_key,
    demand.language_bucket,
    demand.candidate_pair_policy_version,
    demand.observation_count,
    demand.first_observed_at,
    demand.last_observed_at
  from catalog_private.discovery_demand as demand
  join catalog_private.recommendation_candidate_pair_policies as policy
    on policy.policy_version = demand.candidate_pair_policy_version
   and policy.status = 'active'
  order by
    demand.last_observed_at asc,
    demand.topic_key asc,
    demand.language_bucket asc,
    demand.candidate_pair_policy_version asc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

create or replace function public.list_pending_discovery_demand(
  p_limit integer
)
returns table (
  topic_key text,
  language_bucket text,
  candidate_pair_policy_version text,
  observation_count bigint,
  first_observed_at timestamptz,
  last_observed_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return query
  select * from catalog_private.list_pending_discovery_demand(p_limit);
end;
$$;

create or replace function catalog_private.reserve_discovery_budget(
  p_budget_day date,
  p_provider text,
  p_topic_key text,
  p_language_bucket text,
  p_candidate_pair_policy_version text,
  p_reservation_fingerprint text,
  p_provider_quota_units integer,
  p_estimated_micro_usd bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_topic_key text := lower(btrim(coalesce(p_topic_key, '')));
  normalized_language_bucket text := lower(btrim(coalesce(p_language_bucket, '')));
  normalized_policy_version text := btrim(coalesce(p_candidate_pair_policy_version, ''));
  budget_row catalog_private.discovery_budgets%rowtype;
  existing_reservation catalog_private.discovery_budget_reservations%rowtype;
  demand_exists boolean;
  remaining_units integer;
  remaining_cost bigint;
begin
  if p_budget_day is null or p_budget_day <> current_date then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'budget_day');
  end if;
  if p_provider is distinct from 'youtube_data_api_v3_search' then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'provider');
  end if;
  if normalized_topic_key !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or normalized_language_bucket !~ '^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$'
    or normalized_policy_version = ''
    or p_reservation_fingerprint is null
    or p_reservation_fingerprint !~ '^[a-f0-9]{64}$'
    or p_provider_quota_units is null
    or p_provider_quota_units <= 0
    or p_estimated_micro_usd is null
    or p_estimated_micro_usd < 0
  then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'input');
  end if;

  select * into budget_row
  from catalog_private.discovery_budgets
  where budget_day = p_budget_day
  for update;
  if budget_row.budget_day is null then
    return jsonb_build_object('outcome', 'budget_unconfigured');
  end if;

  select * into existing_reservation
  from catalog_private.discovery_budget_reservations
  where reservation_fingerprint = p_reservation_fingerprint;
  if existing_reservation.id is not null then
    if existing_reservation.budget_day = p_budget_day
      and existing_reservation.provider = p_provider
      and existing_reservation.topic_key = normalized_topic_key
      and existing_reservation.language_bucket = normalized_language_bucket
      and existing_reservation.candidate_pair_policy_version = normalized_policy_version
      and existing_reservation.provider_quota_units = p_provider_quota_units
      and existing_reservation.estimated_micro_usd = p_estimated_micro_usd
    then
      remaining_units := budget_row.max_provider_quota_units
        - budget_row.reserved_provider_quota_units;
      remaining_cost := budget_row.max_micro_usd
        - budget_row.reserved_micro_usd;
      return jsonb_build_object(
        'outcome', 'already_reserved',
        'reservationId', existing_reservation.id,
        'remainingProviderQuotaUnits', remaining_units,
        'remainingMicroUsd', remaining_cost
      );
    end if;
    return jsonb_build_object('outcome', 'reservation_conflict');
  end if;

  select exists (
    select 1
    from catalog_private.discovery_demand as demand
    join catalog_private.recommendation_candidate_pair_policies as policy
      on policy.policy_version = demand.candidate_pair_policy_version
     and policy.status = 'active'
    where demand.topic_key = normalized_topic_key
      and demand.language_bucket = normalized_language_bucket
      and demand.candidate_pair_policy_version = normalized_policy_version
  ) into demand_exists;
  if not demand_exists then
    return jsonb_build_object('outcome', 'demand_missing');
  end if;

  if p_provider_quota_units > budget_row.max_provider_quota_units
      - budget_row.reserved_provider_quota_units
    or p_estimated_micro_usd > budget_row.max_micro_usd
      - budget_row.reserved_micro_usd
  then
    return jsonb_build_object('outcome', 'budget_exhausted');
  end if;

  insert into catalog_private.discovery_budget_reservations (
    budget_day,
    reservation_fingerprint,
    provider,
    topic_key,
    language_bucket,
    candidate_pair_policy_version,
    observation_policy_version,
    provider_quota_units,
    estimated_micro_usd
  ) values (
    p_budget_day,
    p_reservation_fingerprint,
    p_provider,
    normalized_topic_key,
    normalized_language_bucket,
    normalized_policy_version,
    'discovery-observation-v1',
    p_provider_quota_units,
    p_estimated_micro_usd
  ) returning * into existing_reservation;

  update catalog_private.discovery_budgets
  set reserved_provider_quota_units = reserved_provider_quota_units
      + p_provider_quota_units,
      reserved_micro_usd = reserved_micro_usd + p_estimated_micro_usd,
      updated_at = clock_timestamp()
  where budget_day = p_budget_day;

  remaining_units := budget_row.max_provider_quota_units
    - budget_row.reserved_provider_quota_units - p_provider_quota_units;
  remaining_cost := budget_row.max_micro_usd
    - budget_row.reserved_micro_usd - p_estimated_micro_usd;
  return jsonb_build_object(
    'outcome', 'reserved',
    'reservationId', existing_reservation.id,
    'remainingProviderQuotaUnits', remaining_units,
    'remainingMicroUsd', remaining_cost
  );
end;
$$;

create or replace function public.reserve_discovery_budget(
  p_budget_day date,
  p_provider text,
  p_topic_key text,
  p_language_bucket text,
  p_candidate_pair_policy_version text,
  p_reservation_fingerprint text,
  p_provider_quota_units integer,
  p_estimated_micro_usd bigint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.reserve_discovery_budget(
    p_budget_day,
    p_provider,
    p_topic_key,
    p_language_bucket,
    p_candidate_pair_policy_version,
    p_reservation_fingerprint,
    p_provider_quota_units,
    p_estimated_micro_usd
  );
end;
$$;

create or replace function catalog_private.record_discovery_observation(
  p_reservation_fingerprint text,
  p_observation_fingerprint text,
  p_provider text,
  p_youtube_video_id text,
  p_position integer,
  p_policy_version text,
  p_observed_at timestamptz,
  p_evidence_expires_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  reservation_row catalog_private.discovery_budget_reservations%rowtype;
  existing_observation catalog_private.discovery_observations%rowtype;
begin
  if p_reservation_fingerprint is null
    or p_reservation_fingerprint !~ '^[a-f0-9]{64}$'
    or p_observation_fingerprint is null
    or p_observation_fingerprint !~ '^[a-f0-9]{64}$'
    or p_provider is distinct from 'youtube_data_api_v3_search'
  then
    return jsonb_build_object(
      'outcome', 'skipped',
      'reason', case when p_provider is distinct from 'youtube_data_api_v3_search'
        then 'provider' else 'input' end
    );
  end if;
  if p_youtube_video_id is null
    or p_youtube_video_id !~ '^[A-Za-z0-9_-]{11}$'
    or p_position is null
    or p_position not between 1 and 50
    or p_policy_version is distinct from 'discovery-observation-v1'
    or p_observed_at is null
    or p_evidence_expires_at is null
    or p_observed_at > clock_timestamp() + interval '5 minutes'
    or p_evidence_expires_at <= p_observed_at
    or p_evidence_expires_at <= clock_timestamp()
  then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'input');
  end if;

  select * into reservation_row
  from catalog_private.discovery_budget_reservations
  where reservation_fingerprint = p_reservation_fingerprint;
  if reservation_row.id is null then
    return jsonb_build_object('outcome', 'reservation_missing');
  end if;
  if reservation_row.budget_day <> current_date then
    return jsonb_build_object('outcome', 'reservation_expired');
  end if;
  if reservation_row.provider <> p_provider
    or reservation_row.observation_policy_version <> p_policy_version
  then
    return jsonb_build_object('outcome', 'reservation_conflict');
  end if;

  select * into existing_observation
  from catalog_private.discovery_observations
  where observation_fingerprint = p_observation_fingerprint;
  if existing_observation.id is not null then
    if existing_observation.reservation_id = reservation_row.id
      and existing_observation.provider = p_provider
      and existing_observation.topic_key = reservation_row.topic_key
      and existing_observation.language_bucket = reservation_row.language_bucket
      and existing_observation.youtube_video_id = p_youtube_video_id
      and existing_observation.position = p_position
      and existing_observation.policy_version = p_policy_version
      and existing_observation.observed_at = p_observed_at
      and existing_observation.evidence_expires_at = p_evidence_expires_at
    then
      return jsonb_build_object(
        'outcome', 'already_recorded',
        'observationId', existing_observation.id,
        'youtubeVideoId', existing_observation.youtube_video_id
      );
    end if;
    return jsonb_build_object('outcome', 'observation_conflict');
  end if;

  begin
    insert into catalog_private.discovery_observations (
      reservation_id,
      observation_fingerprint,
      provider,
      topic_key,
      language_bucket,
      youtube_video_id,
      position,
      policy_version,
      observed_at,
      evidence_expires_at
    ) values (
      reservation_row.id,
      p_observation_fingerprint,
      p_provider,
      reservation_row.topic_key,
      reservation_row.language_bucket,
      p_youtube_video_id,
      p_position,
      p_policy_version,
      p_observed_at,
      p_evidence_expires_at
    ) returning * into existing_observation;
  exception when unique_violation then
    select * into existing_observation
    from catalog_private.discovery_observations
    where observation_fingerprint = p_observation_fingerprint
       or (
         reservation_id = reservation_row.id
         and youtube_video_id = p_youtube_video_id
         and position = p_position
       );
    if existing_observation.id is not null
      and existing_observation.reservation_id = reservation_row.id
      and existing_observation.provider = p_provider
      and existing_observation.topic_key = reservation_row.topic_key
      and existing_observation.language_bucket = reservation_row.language_bucket
      and existing_observation.youtube_video_id = p_youtube_video_id
      and existing_observation.position = p_position
      and existing_observation.policy_version = p_policy_version
    then
      return jsonb_build_object(
        'outcome', 'already_recorded',
        'observationId', existing_observation.id,
        'youtubeVideoId', existing_observation.youtube_video_id
      );
    end if;
    return jsonb_build_object('outcome', 'observation_conflict');
  end;

  return jsonb_build_object(
    'outcome', 'recorded',
    'observationId', existing_observation.id,
    'youtubeVideoId', existing_observation.youtube_video_id,
    'topicKey', existing_observation.topic_key,
    'languageBucket', existing_observation.language_bucket,
    'position', existing_observation.position,
    'policyVersion', existing_observation.policy_version
  );
end;
$$;

create or replace function public.record_discovery_observation(
  p_reservation_fingerprint text,
  p_observation_fingerprint text,
  p_provider text,
  p_youtube_video_id text,
  p_position integer,
  p_policy_version text,
  p_observed_at timestamptz,
  p_evidence_expires_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.record_discovery_observation(
    p_reservation_fingerprint,
    p_observation_fingerprint,
    p_provider,
    p_youtube_video_id,
    p_position,
    p_policy_version,
    p_observed_at,
    p_evidence_expires_at
  );
end;
$$;

revoke all on function catalog_private.list_pending_discovery_demand(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.list_pending_discovery_demand(integer)
  from public, anon, authenticated;
revoke all on function catalog_private.reserve_discovery_budget(
  date, text, text, text, text, text, integer, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.reserve_discovery_budget(
  date, text, text, text, text, text, integer, bigint
) from public, anon, authenticated;
revoke all on function catalog_private.record_discovery_observation(
  text, text, text, text, integer, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.record_discovery_observation(
  text, text, text, text, integer, text, timestamptz, timestamptz
) from public, anon, authenticated;

grant execute on function catalog_private.list_pending_discovery_demand(integer)
  to service_role;
grant execute on function public.list_pending_discovery_demand(integer)
  to service_role;
grant execute on function catalog_private.reserve_discovery_budget(
  date, text, text, text, text, text, integer, bigint
) to service_role;
grant execute on function public.reserve_discovery_budget(
  date, text, text, text, text, text, integer, bigint
) to service_role;
grant execute on function catalog_private.record_discovery_observation(
  text, text, text, text, integer, text, timestamptz, timestamptz
) to service_role;
grant execute on function public.record_discovery_observation(
  text, text, text, text, integer, text, timestamptz, timestamptz
) to service_role;

notify pgrst, 'reload schema';
