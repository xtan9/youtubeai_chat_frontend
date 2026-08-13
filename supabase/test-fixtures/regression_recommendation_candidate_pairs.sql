-- Regression fixture for Issue #350 candidate-pair preparation.
-- The fixture uses the public service-role RPC and rolls back all test data.

begin;

insert into public.videos (
  id, youtube_url, youtube_video_id, url_hash, title, language,
  default_language, catalog_state, catalog_inactive_reason, privacy_status,
  embeddable, live_status, age_restricted
)
select
  fixture.id,
  'https://www.youtube.com/watch?v=' || fixture.youtube_video_id,
  fixture.youtube_video_id,
  fixture.youtube_video_id || '-hash',
  fixture.title,
  'en',
  fixture.language,
  'active',
  null,
  'public',
  true,
  'none',
  fixture.age_restricted
from (values
  ('36000000-0000-4000-8000-000000000001'::uuid, 'pairfix0001', 'Gradient descent', 'en', false),
  ('36000000-0000-4000-8000-000000000002'::uuid, 'pairfix0002', 'Descenso de gradiente', 'es', false),
  ('36000000-0000-4000-8000-000000000003'::uuid, 'pairfix0003', '勾配降下法', 'ja', false),
  ('36000000-0000-4000-8000-000000000004'::uuid, 'pairfix0004', 'Broad topic only', 'fr', false),
  ('36000000-0000-4000-8000-000000000005'::uuid, 'pairfix0005', 'Expired evidence', 'de', false),
  ('36000000-0000-4000-8000-000000000006'::uuid, 'pairfix0006', 'Failed admission', 'pt', false),
  ('36000000-0000-4000-8000-000000000007'::uuid, 'pairfix0007', 'Unsafe now', 'it', true),
  ('36000000-0000-4000-8000-000000000008'::uuid, 'pairfix0008', 'Metadata only', 'nl', false),
  ('36000000-0000-4000-8000-000000000009'::uuid, 'pairfix0009', 'Retired model profile', 'ko', false)
) as fixture(id, youtube_video_id, title, language, age_restricted);

insert into catalog_private.catalog_nominations (video_id, status, decided_at)
select
  video.id,
  case
    when video.id = '36000000-0000-4000-8000-000000000006' then 'inactive'
    else 'admitted'
  end,
  statement_timestamp()
from public.videos as video
where video.id between
  '36000000-0000-4000-8000-000000000001'
  and '36000000-0000-4000-8000-000000000009';

insert into catalog_private.youtube_provider_evidence (
  nomination_id,
  video_id,
  idempotency_key,
  provider_outcome,
  provider_path,
  youtube_video_id,
  title,
  channel_id,
  channel_name,
  thumbnail_url,
  default_language,
  duration_seconds,
  published_at,
  privacy_status,
  embeddable,
  live_status,
  age_restricted,
  provider_verified_at,
  evidence_expires_at
)
select
  nomination.id,
  video.id,
  'issue-350:' || video.youtube_video_id,
  'verified',
  'youtube_data_api_v3_videos_list',
  video.youtube_video_id,
  video.title,
  'fixture-channel',
  'Fixture Channel',
  null,
  video.default_language,
  600,
  statement_timestamp() - interval '30 days',
  'public',
  true,
  'none',
  video.age_restricted,
  statement_timestamp() - interval '1 hour',
  case
    when video.id = '36000000-0000-4000-8000-000000000005'
      then statement_timestamp() - interval '1 minute'
    else statement_timestamp() + interval '1 day'
  end
from catalog_private.catalog_nominations as nomination
join public.videos as video on video.id = nomination.video_id
where video.id between
  '36000000-0000-4000-8000-000000000001'
  and '36000000-0000-4000-8000-000000000009';

insert into catalog_private.catalog_admissions (
  nomination_id,
  video_id,
  provider_evidence_id,
  idempotency_key,
  policy_version,
  decision,
  reason_code,
  decided_at
)
select
  nomination.id,
  video.id,
  evidence.id,
  'issue-350:' || video.youtube_video_id,
  'catalog-admission-policy-v1',
  case
    when video.id = '36000000-0000-4000-8000-000000000006' then 'inactive'
    else 'admitted'
  end,
  case
    when video.id = '36000000-0000-4000-8000-000000000006' then 'not_public'
    else null
  end,
  statement_timestamp()
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
  and video.id between
    '36000000-0000-4000-8000-000000000001'
    and '36000000-0000-4000-8000-000000000009';

insert into catalog_private.semantic_profile_versions (
  video_id,
  profile_schema_version,
  content_fingerprint,
  generator_model,
  prompt_version,
  evaluation_fingerprint,
  source_language,
  topics,
  core_concepts,
  topic_keys,
  core_concept_keys,
  prerequisite_concept_keys,
  application_concept_keys,
  counterpoint_concept_keys,
  difficulty,
  profile
)
select
  video.id,
  'semantic-profile-v1',
  md5(video.id::text) || md5('issue-350:' || video.id::text),
  case
    when video.id = '36000000-0000-4000-8000-000000000009'
      then 'fixture-semantic-retired'
    else 'fixture-semantic-v1'
  end,
  'semantic-profile-prompt-v1',
  case
    when video.id = '36000000-0000-4000-8000-000000000009'
      then repeat('d', 64)
    else repeat('e', 64)
  end,
  video.default_language,
  jsonb_build_array(jsonb_build_object('key', 'machine-learning', 'label', 'Machine learning')),
  case
    when video.id = '36000000-0000-4000-8000-000000000004'
      then jsonb_build_array(
        jsonb_build_object('key', 'data-collection', 'label', 'Data collection'),
        jsonb_build_object('key', 'statistics', 'label', 'Statistics')
      )
    else jsonb_build_array(
      jsonb_build_object('key', 'loss-function', 'label', 'Loss function'),
      jsonb_build_object('key', 'optimization', 'label', 'Optimization')
    )
  end,
  array['machine-learning']::text[],
  case
    when video.id = '36000000-0000-4000-8000-000000000004'
      then array['data-collection', 'statistics']::text[]
    else array['loss-function', 'optimization']::text[]
  end,
  case
    when video.id = '36000000-0000-4000-8000-000000000001'
      then array['calculus']::text[]
    when video.id = '36000000-0000-4000-8000-000000000004'
      then array[]::text[]
    else array['model-training']::text[]
  end,
  case
    when video.id = '36000000-0000-4000-8000-000000000001'
      then array['model-training']::text[]
    when video.id = '36000000-0000-4000-8000-000000000004'
      then array[]::text[]
    else array['calculus']::text[]
  end,
  case
    when video.id = '36000000-0000-4000-8000-000000000001'
      then array['gradient-free-optimization']::text[]
    else array[]::text[]
  end,
  'intermediate',
  jsonb_build_object('schemaVersion', 'semantic-profile-v1')
from public.videos as video
where (
  video.id between
    '36000000-0000-4000-8000-000000000001'
    and '36000000-0000-4000-8000-000000000007'
) or video.id = '36000000-0000-4000-8000-000000000009';

do $$
declare
  dormant jsonb;
begin
  set local role service_role;
  select public.prepare_recommendation_candidate_pairs(
    '36000000-0000-4000-8000-000000000001'
  ) into dormant;
  if dormant ->> 'outcome' <> 'skipped'
    or dormant ->> 'reason' <> 'model_inactive'
  then
    raise exception 'candidate preparation was not fail-closed: %', dormant;
  end if;

  set local role postgres;
  if exists (select 1 from catalog_private.recommendation_candidate_pair_evidence)
    or exists (select 1 from catalog_private.discovery_demand)
  then
    raise exception 'dormant preparation wrote private recommendation state';
  end if;
end;
$$;

insert into catalog_private.semantic_profile_evaluations (
  evaluation_fingerprint,
  model_identifier,
  profile_schema_version,
  prompt_version,
  gateway_provider,
  metrics,
  status,
  evaluated_at
) values (
  repeat('d', 64),
  'fixture-semantic-retired',
  'semantic-profile-v1',
  'semantic-profile-prompt-v1',
  'fixture-gateway',
  jsonb_build_object(
    'schema_validity_rate', 1,
    'multilingual_concept_normalization', 1,
    'useful_neighbor_recall', 1,
    'false_neighbor_rejection', 1,
    'latency_ms_p95', 1,
    'token_cost_totals', jsonb_build_object('microUsd', 1),
    'retry_dead_letter_behavior', 'bounded',
    'representative_source_coverage', 1
  ),
  'passed',
  statement_timestamp()
), (
  repeat('e', 64),
  'fixture-semantic-v1',
  'semantic-profile-v1',
  'semantic-profile-prompt-v1',
  'fixture-gateway',
  jsonb_build_object(
    'schema_validity_rate', 1,
    'multilingual_concept_normalization', 1,
    'useful_neighbor_recall', 1,
    'false_neighbor_rejection', 1,
    'latency_ms_p95', 1,
    'token_cost_totals', jsonb_build_object('microUsd', 1),
    'retry_dead_letter_behavior', 'bounded',
    'representative_source_coverage', 1
  ),
  'passed',
  statement_timestamp()
);

insert into catalog_private.semantic_profile_human_approvals (
  approval_ref,
  evaluation_fingerprint,
  model_identifier,
  profile_schema_version,
  prompt_version,
  approved_by,
  decision,
  approved_at
) values (
  'issue-350-retired-fixture-approval',
  repeat('d', 64),
  'fixture-semantic-retired',
  'semantic-profile-v1',
  'semantic-profile-prompt-v1',
  'fixture-human-reviewer',
  'approved',
  statement_timestamp()
), (
  'issue-350-fixture-approval',
  repeat('e', 64),
  'fixture-semantic-v1',
  'semantic-profile-v1',
  'semantic-profile-prompt-v1',
  'fixture-human-reviewer',
  'approved',
  statement_timestamp()
);

do $$
declare
  retired_activation jsonb;
  activation jsonb;
  first_prepared jsonb;
  second_prepared jsonb;
  stale_source jsonb;
  retired jsonb;
  demand_count bigint;
  evidence_count integer;
  forbidden_columns text[];
begin
  set local role service_role;
  -- Preserve an active Profile from the first tuple, then switch the registry.
  -- Candidate preparation must use registry provenance, not Profile status alone.
  select public.activate_semantic_profile_model(
    'fixture-semantic-retired',
    'semantic-profile-v1',
    'semantic-profile-prompt-v1',
    repeat('d', 64),
    'issue-350-retired-fixture-approval'
  ) into retired_activation;
  if retired_activation ->> 'outcome' <> 'active' then
    raise exception 'retired fixture activation failed: %', retired_activation;
  end if;

  select public.activate_semantic_profile_model(
    'fixture-semantic-v1',
    'semantic-profile-v1',
    'semantic-profile-prompt-v1',
    repeat('e', 64),
    'issue-350-fixture-approval'
  ) into activation;
  if activation ->> 'outcome' <> 'active' then
    raise exception 'fixture activation failed: %', activation;
  end if;

  set local role postgres;
  if not exists (
    select 1
    from catalog_private.semantic_profile_model_registry
    where model_identifier = 'fixture-semantic-retired'
      and evaluation_fingerprint = repeat('d', 64)
      and status = 'retired'
  ) or (
    select status
    from catalog_private.semantic_profile_versions
    where video_id = '36000000-0000-4000-8000-000000000009'
  ) <> 'active'
  then
    raise exception 'fixture did not preserve an active Profile across activation switch';
  end if;

  set local role service_role;
  select public.prepare_recommendation_candidate_pairs(
    '36000000-0000-4000-8000-000000000001'
  ) into first_prepared;
  if first_prepared ->> 'outcome' <> 'prepared'
    or (first_prepared ->> 'pairCount')::integer <> 2
    or (first_prepared ->> 'minimumCoverage')::integer <> 4
    or (first_prepared ->> 'demandRecorded')::boolean is not true
    or (first_prepared ->> 'demandBucketCount')::integer <> 1
  then
    raise exception 'eligible pair preparation was incorrect: %', first_prepared;
  end if;
  if first_prepared #>> '{candidates,0,candidateVideoId}'
      <> '36000000-0000-4000-8000-000000000002'
    or first_prepared #>> '{candidates,1,candidateVideoId}'
      <> '36000000-0000-4000-8000-000000000003'
    or (first_prepared #>> '{candidates,0,relationshipScore}')::integer <> 17
    or (first_prepared #>> '{candidates,0,rank}')::integer <> 1
    or first_prepared #> '{candidates,0,matchedSourceApplicationCandidatePrerequisiteKeys}'
      <> '["model-training"]'::jsonb
    or first_prepared #> '{candidates,0,matchedSourcePrerequisiteCandidateApplicationKeys}'
      <> '["calculus"]'::jsonb
  then
    raise exception 'multilingual ordering or directional evidence was incorrect: %',
      first_prepared;
  end if;

  set local role postgres;
  select count(*) into evidence_count
  from catalog_private.recommendation_candidate_pair_evidence;
  if evidence_count <> 2 then
    raise exception 'ineligible or duplicate pair evidence persisted: %', evidence_count;
  end if;
  begin
    update catalog_private.recommendation_candidate_pair_evidence
    set created_at = created_at + interval '1 second';
    raise exception 'versioned candidate-pair evidence could be updated';
  exception when raise_exception then
    if sqlerrm <> 'Recommendation Candidate pair evidence is immutable' then
      raise;
    end if;
  end;
  begin
    delete from catalog_private.recommendation_candidate_pair_evidence;
    raise exception 'versioned candidate-pair evidence could be deleted';
  exception when raise_exception then
    if sqlerrm <> 'Recommendation Candidate pair evidence is immutable' then
      raise;
    end if;
  end;
  if exists (
    select 1
    from catalog_private.recommendation_candidate_pair_evidence as pair
    join catalog_private.semantic_profile_versions as profile
      on profile.id = pair.candidate_profile_id
    where profile.video_id in (
      '36000000-0000-4000-8000-000000000004',
      '36000000-0000-4000-8000-000000000005',
      '36000000-0000-4000-8000-000000000006',
      '36000000-0000-4000-8000-000000000007',
      '36000000-0000-4000-8000-000000000009'
    )
  ) then
    raise exception 'a below-floor, stale, failed, unsafe, or incompatible candidate passed gates';
  end if;
  if (select catalog_state from public.videos
      where id = '36000000-0000-4000-8000-000000000008') <> 'active'
  then
    raise exception 'metadata-only Video was incorrectly made inactive';
  end if;
  if exists (
    select 1
    from catalog_private.recommendation_candidate_pair_evidence as pair
    where pair.source_profile_id = pair.candidate_profile_id
  ) then
    raise exception 'source Video was retained as its own candidate';
  end if;

  select observation_count into demand_count
  from catalog_private.discovery_demand
  where topic_key = 'machine-learning'
    and language_bucket = 'en'
    and candidate_pair_policy_version = 'candidate-pair-policy-v1';
  if demand_count <> 1 then
    raise exception 'sparse Discovery Demand was not aggregated: %', demand_count;
  end if;
  select array_agg(column_name order by ordinal_position)
  into forbidden_columns
  from information_schema.columns
  where table_schema = 'catalog_private'
    and table_name = 'discovery_demand'
    and column_name ~ '(learner|source|video|query|history|summary|transcript|request|content|_id$)';
  if cardinality(coalesce(forbidden_columns, array[]::text[])) <> 0 then
    raise exception 'Discovery Demand retained forbidden identity/content columns: %',
      forbidden_columns;
  end if;
  if exists (
    select 1 from catalog_private.discovery_demand as demand
    where to_jsonb(demand)::text like '%36000000-0000-4000-8000-000000000001%'
       or to_jsonb(demand)::text like '%Gradient descent%'
  ) then
    raise exception 'Discovery Demand retained source identity or content';
  end if;

  set local role service_role;
  select public.prepare_recommendation_candidate_pairs(
    '36000000-0000-4000-8000-000000000001'
  ) into second_prepared;
  if second_prepared #>> '{candidates,0,candidatePairEvidenceId}'
      <> first_prepared #>> '{candidates,0,candidatePairEvidenceId}'
    or second_prepared #>> '{candidates,1,candidatePairEvidenceId}'
      <> first_prepared #>> '{candidates,1,candidatePairEvidenceId}'
  then
    raise exception 'repeated preparation did not reuse immutable pair evidence';
  end if;

  set local role postgres;
  select count(*) into evidence_count
  from catalog_private.recommendation_candidate_pair_evidence;
  select observation_count into demand_count
  from catalog_private.discovery_demand
  where topic_key = 'machine-learning'
    and language_bucket = 'en';
  if evidence_count <> 2 or demand_count <> 2 then
    raise exception 'repeated sparse preparation was incoherent: %, %',
      evidence_count, demand_count;
  end if;

  update catalog_private.youtube_provider_evidence
  set evidence_expires_at = statement_timestamp() - interval '1 minute'
  where video_id = '36000000-0000-4000-8000-000000000001';
  update public.videos
  set provider_evidence_expires_at = statement_timestamp() - interval '1 minute'
  where id = '36000000-0000-4000-8000-000000000001';
  set local role service_role;
  select public.prepare_recommendation_candidate_pairs(
    '36000000-0000-4000-8000-000000000001'
  ) into stale_source;
  if stale_source ->> 'reason' <> 'source_ineligible' then
    raise exception 'stale source created pair evidence or demand: %', stale_source;
  end if;

  set local role postgres;
  select observation_count into demand_count
  from catalog_private.discovery_demand
  where topic_key = 'machine-learning' and language_bucket = 'en';
  if demand_count <> 2 then
    raise exception 'ineligible source changed Discovery Demand: %', demand_count;
  end if;

  set local role service_role;
  begin
    perform 1 from catalog_private.recommendation_candidate_pair_evidence;
    raise exception 'service role could read private pair evidence';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from catalog_private.discovery_demand;
    raise exception 'service role could read private Discovery Demand';
  exception when insufficient_privilege then
    null;
  end;

  set local role anon;
  begin
    perform public.prepare_recommendation_candidate_pairs(
      '36000000-0000-4000-8000-000000000001'
    );
    raise exception 'browser role could prepare private candidate pairs';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from catalog_private.discovery_demand;
    raise exception 'anonymous browser role could read private Discovery Demand';
  exception when insufficient_privilege then
    null;
  end;

  set local role authenticated;
  begin
    perform public.prepare_recommendation_candidate_pairs(
      '36000000-0000-4000-8000-000000000001'
    );
    raise exception 'authenticated browser role could prepare private candidate pairs';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform 1 from catalog_private.recommendation_candidate_pair_evidence;
    raise exception 'authenticated browser role could read private pair evidence';
  exception when insufficient_privilege then
    null;
  end;

  set local role postgres;
  update catalog_private.semantic_profile_evaluations
  set status = 'revoked'
  where evaluation_fingerprint = repeat('e', 64);
  set local role service_role;
  select public.prepare_recommendation_candidate_pairs(
    '36000000-0000-4000-8000-000000000001'
  ) into retired;
  if retired ->> 'reason' <> 'model_inactive' then
    raise exception 'revoked evaluation remained usable for preparation: %', retired;
  end if;
end;
$$;

rollback;
