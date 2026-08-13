-- Real multi-session proof for Issue #350 sparse-demand aggregation.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

do $cleanup_fixture_pair_evidence$
begin
  alter table catalog_private.recommendation_candidate_pair_evidence
    disable trigger recommendation_candidate_pair_evidence_immutable_trg;
  begin
    delete from catalog_private.recommendation_candidate_pair_evidence
    where source_profile_id in (
      select id from catalog_private.semantic_profile_versions
      where video_id in (
        '37000000-0000-4000-8000-000000000001',
        '37000000-0000-4000-8000-000000000002'
      )
    );
  exception when others then
    alter table catalog_private.recommendation_candidate_pair_evidence
      enable trigger recommendation_candidate_pair_evidence_immutable_trg;
    raise;
  end;
  alter table catalog_private.recommendation_candidate_pair_evidence
    enable trigger recommendation_candidate_pair_evidence_immutable_trg;
end;
$cleanup_fixture_pair_evidence$;
do $cleanup_discovery_demand$
begin
  alter table catalog_private.discovery_demand
    disable trigger discovery_demand_aggregation_history_trg;
  begin
    delete from catalog_private.discovery_demand
    where topic_key = 'concurrency-topic' and language_bucket = 'en';
  exception when others then
    alter table catalog_private.discovery_demand
      enable trigger discovery_demand_aggregation_history_trg;
    raise;
  end;
  alter table catalog_private.discovery_demand
    enable trigger discovery_demand_aggregation_history_trg;
end;
$cleanup_discovery_demand$;
delete from catalog_private.semantic_profile_versions
where video_id in (
  '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000002'
);
delete from catalog_private.semantic_profile_model_registry
where model_identifier = 'fixture-candidate-pair-race';
delete from catalog_private.semantic_profile_human_approvals
where approval_ref = 'issue-350-concurrency-approval';
delete from catalog_private.semantic_profile_evaluations
where evaluation_fingerprint = repeat('f', 64);
delete from catalog_private.catalog_admissions
where video_id in (
  '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000002'
);
delete from catalog_private.youtube_provider_evidence
where video_id in (
  '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000002'
);
delete from catalog_private.catalog_nominations
where video_id in (
  '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000002'
);
delete from public.videos
where id in (
  '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000002'
);

do $guard$
begin
  if exists (
    select 1 from catalog_private.semantic_profile_model_registry
    where status = 'active'
  ) then
    raise exception 'candidate-pair concurrency fixture requires no active model';
  end if;
end;
$guard$;

insert into public.videos (
  id, youtube_url, youtube_video_id, url_hash, title, language,
  default_language, catalog_state, privacy_status, embeddable, live_status,
  age_restricted
) values (
  '37000000-0000-4000-8000-000000000001',
  'https://www.youtube.com/watch?v=pairrace001', 'pairrace001',
  'pairrace001-hash', 'Concurrent source', 'en', 'en', 'active',
  'public', true, 'none', false
), (
  '37000000-0000-4000-8000-000000000002',
  'https://www.youtube.com/watch?v=pairrace002', 'pairrace002',
  'pairrace002-hash', 'Concurrent candidate', 'en', 'es', 'active',
  'public', true, 'none', false
);

insert into catalog_private.catalog_nominations (video_id, status, decided_at)
select id, 'admitted', statement_timestamp()
from public.videos
where id in (
  '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000002'
);

insert into catalog_private.youtube_provider_evidence (
  nomination_id, video_id, idempotency_key, provider_outcome, provider_path,
  youtube_video_id, title, channel_id, channel_name, default_language,
  duration_seconds, published_at, privacy_status, embeddable, live_status,
  age_restricted, provider_verified_at, evidence_expires_at
)
select
  nomination.id, video.id, 'issue-350-race:' || video.youtube_video_id,
  'verified', 'youtube_data_api_v3_videos_list', video.youtube_video_id,
  video.title, 'fixture-channel', 'Fixture Channel', video.default_language,
  600, statement_timestamp() - interval '30 days', 'public', true, 'none',
  false, statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '1 day'
from catalog_private.catalog_nominations as nomination
join public.videos as video on video.id = nomination.video_id
where video.id in (
  '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000002'
);

insert into catalog_private.catalog_admissions (
  nomination_id, video_id, provider_evidence_id, idempotency_key,
  policy_version, decision, decided_at
)
select
  nomination.id, video.id, evidence.id,
  'issue-350-race:' || video.youtube_video_id,
  'catalog-admission-policy-v1', 'admitted', statement_timestamp()
from catalog_private.catalog_nominations as nomination
join public.videos as video on video.id = nomination.video_id
join catalog_private.youtube_provider_evidence as evidence
  on evidence.nomination_id = nomination.id;

update public.videos as video
set provider_evidence_path = evidence.provider_path,
    provider_verified_at = evidence.provider_verified_at,
    provider_evidence_expires_at = evidence.evidence_expires_at
from catalog_private.youtube_provider_evidence as evidence
where evidence.video_id = video.id
  and video.id in (
    '37000000-0000-4000-8000-000000000001',
    '37000000-0000-4000-8000-000000000002'
  );

insert into catalog_private.semantic_profile_versions (
  video_id, profile_schema_version, content_fingerprint, generator_model,
  prompt_version, evaluation_fingerprint, source_language, topics,
  core_concepts, topic_keys, core_concept_keys, prerequisite_concept_keys,
  application_concept_keys, counterpoint_concept_keys, difficulty, profile
)
select
  video.id, 'semantic-profile-v1',
  md5(video.id::text) || md5('issue-350-race:' || video.id::text),
  'fixture-candidate-pair-race', 'semantic-profile-prompt-v1', repeat('f', 64),
  video.default_language,
  jsonb_build_array(jsonb_build_object('key', 'concurrency-topic', 'label', 'Concurrency topic')),
  jsonb_build_array(
    jsonb_build_object('key', 'concurrency-core', 'label', 'Concurrency core'),
    jsonb_build_object('key', 'shared-core', 'label', 'Shared core')
  ),
  array['concurrency-topic']::text[],
  array['concurrency-core', 'shared-core']::text[],
  array[]::text[], array[]::text[], array[]::text[], 'intermediate',
  jsonb_build_object('schemaVersion', 'semantic-profile-v1')
from public.videos as video
where video.id in (
  '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000002'
);

insert into catalog_private.semantic_profile_evaluations (
  evaluation_fingerprint, model_identifier, profile_schema_version,
  prompt_version, gateway_provider, metrics, status, evaluated_at
) values (
  repeat('f', 64), 'fixture-candidate-pair-race', 'semantic-profile-v1',
  'semantic-profile-prompt-v1', 'fixture-gateway',
  jsonb_build_object(
    'schema_validity_rate', 1,
    'multilingual_concept_normalization', 1,
    'useful_neighbor_recall', 1,
    'false_neighbor_rejection', 1,
    'latency_ms_p95', 1,
    'token_cost_totals', jsonb_build_object('microUsd', 1),
    'retry_dead_letter_behavior', 'bounded',
    'representative_source_coverage', 1
  ), 'passed', statement_timestamp()
);

insert into catalog_private.semantic_profile_human_approvals (
  approval_ref, evaluation_fingerprint, model_identifier,
  profile_schema_version, prompt_version, approved_by, decision, approved_at
) values (
  'issue-350-concurrency-approval', repeat('f', 64),
  'fixture-candidate-pair-race', 'semantic-profile-v1',
  'semantic-profile-prompt-v1', 'fixture-human-reviewer', 'approved',
  statement_timestamp()
);

set role service_role;
select public.activate_semantic_profile_model(
  'fixture-candidate-pair-race', 'semantic-profile-v1',
  'semantic-profile-prompt-v1', repeat('f', 64),
  'issue-350-concurrency-approval'
);
reset role;

do $fixture$
declare
  connection_string text := format(
    'host=127.0.0.1 port=5432 dbname=%I user=%I password=postgres',
    current_database(), current_user
  );
  connection_names text[] := array[
    'candidate_pair_race_1', 'candidate_pair_race_2',
    'candidate_pair_race_3', 'candidate_pair_race_4'
  ];
  connection_name text;
  prepared jsonb;
  evidence_ids text[] := array[]::text[];
  evidence_count integer;
  demand_count bigint;
begin
  foreach connection_name in array connection_names loop
    perform extensions.dblink_connect(connection_name, connection_string);
    perform extensions.dblink_exec(connection_name, 'set role service_role');
    perform extensions.dblink_send_query(
      connection_name,
      $$select public.prepare_recommendation_candidate_pairs(
        '37000000-0000-4000-8000-000000000001'
      )$$
    );
  end loop;

  foreach connection_name in array connection_names loop
    select result into prepared
    from extensions.dblink_get_result(connection_name) as result(result jsonb);
    perform result
    from extensions.dblink_get_result(connection_name) as cleared(result jsonb);
    if prepared ->> 'outcome' <> 'prepared'
      or (prepared ->> 'pairCount')::integer <> 1
    then
      raise exception 'concurrent preparation failed: %', prepared;
    end if;
    evidence_ids := array_append(
      evidence_ids,
      prepared #>> '{candidates,0,candidatePairEvidenceId}'
    );
    perform extensions.dblink_disconnect(connection_name);
  end loop;

  select count(distinct evidence_id) into evidence_count
  from unnest(evidence_ids) as ids(evidence_id);
  if evidence_count <> 1 then
    raise exception 'concurrent preparation returned duplicate evidence ids: %',
      evidence_ids;
  end if;

  select count(*) into evidence_count
  from catalog_private.recommendation_candidate_pair_evidence
  where source_profile_id in (
    select id from catalog_private.semantic_profile_versions
    where video_id = '37000000-0000-4000-8000-000000000001'
  );
  select observation_count into demand_count
  from catalog_private.discovery_demand
  where topic_key = 'concurrency-topic'
    and language_bucket = 'en'
    and candidate_pair_policy_version = 'candidate-pair-policy-v1';
  if evidence_count <> 1 or demand_count <> 4 then
    raise exception 'concurrent aggregation lost or duplicated state: %, %',
      evidence_count, demand_count;
  end if;
end;
$fixture$;

do $cleanup_fixture_pair_evidence_final$
begin
  alter table catalog_private.recommendation_candidate_pair_evidence
    disable trigger recommendation_candidate_pair_evidence_immutable_trg;
  begin
    delete from catalog_private.recommendation_candidate_pair_evidence
    where source_profile_id in (
      select id from catalog_private.semantic_profile_versions
      where video_id in (
        '37000000-0000-4000-8000-000000000001',
        '37000000-0000-4000-8000-000000000002'
      )
    );
  exception when others then
    alter table catalog_private.recommendation_candidate_pair_evidence
      enable trigger recommendation_candidate_pair_evidence_immutable_trg;
    raise;
  end;
  alter table catalog_private.recommendation_candidate_pair_evidence
    enable trigger recommendation_candidate_pair_evidence_immutable_trg;
end;
$cleanup_fixture_pair_evidence_final$;
do $cleanup_discovery_demand_final$
begin
  alter table catalog_private.discovery_demand
    disable trigger discovery_demand_aggregation_history_trg;
  begin
    delete from catalog_private.discovery_demand
    where topic_key = 'concurrency-topic' and language_bucket = 'en';
  exception when others then
    alter table catalog_private.discovery_demand
      enable trigger discovery_demand_aggregation_history_trg;
    raise;
  end;
  alter table catalog_private.discovery_demand
    enable trigger discovery_demand_aggregation_history_trg;
end;
$cleanup_discovery_demand_final$;
delete from catalog_private.semantic_profile_versions
where video_id in (
  '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000002'
);
delete from catalog_private.semantic_profile_model_registry
where model_identifier = 'fixture-candidate-pair-race';
delete from catalog_private.semantic_profile_human_approvals
where approval_ref = 'issue-350-concurrency-approval';
delete from catalog_private.semantic_profile_evaluations
where evaluation_fingerprint = repeat('f', 64);
delete from catalog_private.catalog_admissions
where video_id in (
  '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000002'
);
delete from catalog_private.youtube_provider_evidence
where video_id in (
  '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000002'
);
delete from catalog_private.catalog_nominations
where video_id in (
  '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000002'
);
delete from public.videos
where id in (
  '37000000-0000-4000-8000-000000000001',
  '37000000-0000-4000-8000-000000000002'
);

reset search_path;
