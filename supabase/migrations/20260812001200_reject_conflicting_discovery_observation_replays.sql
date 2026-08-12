-- Keep concurrent Discovery Observation replay semantics identical to the
-- ordinary replay path: a fingerprint is idempotent only for the exact same
-- immutable Observation, including its observation and evidence-expiry times.

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
  inserted_observation boolean := false;
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
  if existing_observation.id is null then
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
      inserted_observation := true;
    exception when unique_violation then
      select * into existing_observation
      from catalog_private.discovery_observations
      where observation_fingerprint = p_observation_fingerprint
         or (
           reservation_id = reservation_row.id
           and youtube_video_id = p_youtube_video_id
           and position = p_position
         );
    end;
  end if;

  if inserted_observation then
    return jsonb_build_object(
      'outcome', 'recorded',
      'observationId', existing_observation.id,
      'youtubeVideoId', existing_observation.youtube_video_id,
      'topicKey', existing_observation.topic_key,
      'languageBucket', existing_observation.language_bucket,
      'position', existing_observation.position,
      'policyVersion', existing_observation.policy_version
    );
  end if;

  if existing_observation.id is not null
    and existing_observation.reservation_id = reservation_row.id
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
end;
$$;
