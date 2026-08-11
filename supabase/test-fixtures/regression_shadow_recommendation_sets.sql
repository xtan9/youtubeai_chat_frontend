-- Private atomic Shadow Recommendation Set materialization (Issue #351).

begin;

do $contract$
begin
  if to_regclass('catalog_private.recommendation_set_policies') is null
    or to_regclass('catalog_private.recommendation_sets') is null
    or to_regclass('catalog_private.recommendations') is null
  then
    raise exception 'private Recommendation Set storage is missing';
  end if;

  if to_regprocedure(
    'public.publish_shadow_recommendation_set(uuid,text,uuid[])'
  ) is null then
    raise exception 'Shadow Recommendation Set materializer is missing';
  end if;

  if exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'catalog_private'
      and relation.relname in (
        'recommendation_set_policies',
        'recommendation_sets',
        'recommendations'
      )
      and relation.relrowsecurity is not true
  ) then
    raise exception 'private Recommendation Set tables must enable RLS';
  end if;

  if has_schema_privilege('anon', 'catalog_private', 'USAGE')
    or has_schema_privilege('authenticated', 'catalog_private', 'USAGE')
    or has_table_privilege(
      'service_role', 'catalog_private.recommendation_sets', 'SELECT'
    )
    or has_table_privilege(
      'service_role', 'catalog_private.recommendation_sets', 'INSERT'
    )
    or has_table_privilege(
      'service_role', 'catalog_private.recommendations', 'SELECT'
    )
    or has_table_privilege(
      'service_role', 'catalog_private.recommendations', 'INSERT'
    )
    or has_function_privilege(
      'anon',
      'public.publish_shadow_recommendation_set(uuid,text,uuid[])',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.publish_shadow_recommendation_set(uuid,text,uuid[])',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.publish_shadow_recommendation_set(uuid,text,uuid[])',
      'EXECUTE'
    )
  then
    raise exception 'Recommendation Set least privilege is incorrect';
  end if;
end;
$contract$;

set local role anon;
do $anon_denial$
declare
  read_denied boolean := false;
  write_denied boolean := false;
  rpc_denied boolean := false;
begin
  begin
    perform 1 from catalog_private.recommendation_sets limit 1;
  exception when insufficient_privilege then
    read_denied := true;
  end;
  begin
    insert into catalog_private.recommendation_sets default values;
  exception when insufficient_privilege then
    write_denied := true;
  end;
  begin
    perform public.publish_shadow_recommendation_set(
      null::uuid, repeat('0', 64), array[]::uuid[]
    );
  exception when insufficient_privilege then
    rpc_denied := true;
  end;
  if not read_denied or not write_denied or not rpc_denied then
    raise exception
      'anon effective Set access was not denied (read %, write %, rpc %)',
      read_denied, write_denied, rpc_denied;
  end if;
end;
$anon_denial$;
reset role;

set local role authenticated;
do $authenticated_denial$
declare
  read_denied boolean := false;
  write_denied boolean := false;
  rpc_denied boolean := false;
begin
  begin
    perform 1 from catalog_private.recommendations limit 1;
  exception when insufficient_privilege then
    read_denied := true;
  end;
  begin
    insert into catalog_private.recommendations default values;
  exception when insufficient_privilege then
    write_denied := true;
  end;
  begin
    perform public.publish_shadow_recommendation_set(
      null::uuid, repeat('0', 64), array[]::uuid[]
    );
  exception when insufficient_privilege then
    rpc_denied := true;
  end;
  if not read_denied or not write_denied or not rpc_denied then
    raise exception
      'authenticated effective Set access was not denied '
      '(read %, write %, rpc %)',
      read_denied, write_denied, rpc_denied;
  end if;
end;
$authenticated_denial$;
reset role;

insert into public.videos (
  id, youtube_url, youtube_video_id, url_hash, title, language,
  default_language, catalog_state, privacy_status, embeddable, live_status,
  age_restricted
) values (
  '3a000000-0000-4000-8000-000000000001',
  'https://www.youtube.com/watch?v=setsource01', 'setsource01',
  'set-source-hash', 'Set source', 'en', 'en', 'active',
  'public', true, 'none', false
), (
  '3a000000-0000-4000-8000-000000000002',
  'https://www.youtube.com/watch?v=setcandida1', 'setcandida1',
  'set-candidate-a-hash', 'Set candidate A', 'en', 'es', 'active',
  'public', true, 'none', false
), (
  '3a000000-0000-4000-8000-000000000003',
  'https://www.youtube.com/watch?v=setcandidb1', 'setcandidb1',
  'set-candidate-b-hash', 'Set candidate B', 'en', 'fr', 'active',
  'public', true, 'none', false
);

insert into catalog_private.catalog_nominations (video_id, status, decided_at)
select id, 'admitted', statement_timestamp()
from public.videos
where id in (
  '3a000000-0000-4000-8000-000000000001',
  '3a000000-0000-4000-8000-000000000002',
  '3a000000-0000-4000-8000-000000000003'
);

insert into catalog_private.youtube_provider_evidence (
  nomination_id, video_id, idempotency_key, provider_outcome, provider_path,
  youtube_video_id, title, channel_id, channel_name, default_language,
  duration_seconds, published_at, privacy_status, embeddable, live_status,
  age_restricted, provider_verified_at, evidence_expires_at
)
select
  nomination.id, video.id, 'issue-351-set:' || video.youtube_video_id,
  'verified', 'youtube_data_api_v3_videos_list', video.youtube_video_id,
  video.title, 'set-fixture-channel', 'Set Fixture Channel',
  video.default_language, 600, statement_timestamp() - interval '30 days',
  'public', true, 'none', false, statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '1 day'
from catalog_private.catalog_nominations as nomination
join public.videos as video on video.id = nomination.video_id
where video.id in (
  '3a000000-0000-4000-8000-000000000001',
  '3a000000-0000-4000-8000-000000000002',
  '3a000000-0000-4000-8000-000000000003'
);

insert into catalog_private.catalog_admissions (
  nomination_id, video_id, provider_evidence_id, idempotency_key,
  policy_version, decision, decided_at
)
select
  nomination.id, video.id, evidence.id,
  'issue-351-set:' || video.youtube_video_id,
  'catalog-admission-policy-v1', 'admitted', statement_timestamp()
from catalog_private.catalog_nominations as nomination
join public.videos as video on video.id = nomination.video_id
join catalog_private.youtube_provider_evidence as evidence
  on evidence.nomination_id = nomination.id
where video.id in (
  '3a000000-0000-4000-8000-000000000001',
  '3a000000-0000-4000-8000-000000000002',
  '3a000000-0000-4000-8000-000000000003'
);

update public.videos as video
set provider_evidence_path = evidence.provider_path,
    provider_verified_at = evidence.provider_verified_at,
    provider_evidence_expires_at = evidence.evidence_expires_at
from catalog_private.youtube_provider_evidence as evidence
where evidence.video_id = video.id
  and video.id in (
    '3a000000-0000-4000-8000-000000000001',
    '3a000000-0000-4000-8000-000000000002',
    '3a000000-0000-4000-8000-000000000003'
  );

insert into catalog_private.semantic_profile_versions (
  video_id, profile_schema_version, content_fingerprint, generator_model,
  prompt_version, evaluation_fingerprint, source_language, topics,
  core_concepts, topic_keys, core_concept_keys, prerequisite_concept_keys,
  application_concept_keys, counterpoint_concept_keys, difficulty, profile
) values (
  '3a000000-0000-4000-8000-000000000001',
  'semantic-profile-v1', repeat('1', 64), 'fixture-set-semantic-model',
  'semantic-profile-prompt-v1', repeat('c', 64), 'en',
  '[{"key":"set-theory","label":"Set theory"}]',
  '[{"key":"set-core-a","label":"Set core A"},{"key":"set-core-b","label":"Set core B"}]',
  array['set-theory'], array['set-core-a', 'set-core-b'],
  array['set-foundation'], array['set-practice'], array['set-alternative'],
  'intermediate', '{"schemaVersion":"semantic-profile-v1"}'
), (
  '3a000000-0000-4000-8000-000000000002',
  'semantic-profile-v1', repeat('2', 64), 'fixture-set-semantic-model',
  'semantic-profile-prompt-v1', repeat('c', 64), 'es',
  '[{"key":"set-theory","label":"Teoria de conjuntos"}]',
  '[{"key":"set-core-a","label":"Nucleo A"},{"key":"set-core-b","label":"Nucleo B"}]',
  array['set-theory'], array['set-core-a', 'set-core-b'],
  array['set-practice'], array['set-foundation'], array[]::text[],
  'advanced', '{"schemaVersion":"semantic-profile-v1"}'
), (
  '3a000000-0000-4000-8000-000000000003',
  'semantic-profile-v1', repeat('3', 64), 'fixture-set-semantic-model',
  'semantic-profile-prompt-v1', repeat('c', 64), 'fr',
  '[{"key":"set-theory","label":"Theorie des ensembles"}]',
  '[{"key":"set-core-a","label":"Coeur A"},{"key":"set-alternative","label":"Alternative"}]',
  array['set-theory'], array['set-core-a', 'set-alternative'],
  array[]::text[], array[]::text[], array[]::text[],
  'advanced', '{"schemaVersion":"semantic-profile-v1"}'
);

insert into catalog_private.semantic_profile_evaluations (
  evaluation_fingerprint, model_identifier, profile_schema_version,
  prompt_version, gateway_provider, metrics, status, evaluated_at
) values (
  repeat('c', 64), 'fixture-set-semantic-model', 'semantic-profile-v1',
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
  'issue-351-set-approval', repeat('c', 64),
  'fixture-set-semantic-model', 'semantic-profile-v1',
  'semantic-profile-prompt-v1', 'fixture-human-reviewer', 'approved',
  statement_timestamp()
);

set local role service_role;
select public.activate_semantic_profile_model(
  'fixture-set-semantic-model', 'semantic-profile-v1',
  'semantic-profile-prompt-v1', repeat('c', 64),
  'issue-351-set-approval'
);

do $materialization$
declare
  prepared jsonb;
  assessment_a jsonb;
  assessment_b jsonb;
  unsupported jsonb;
  published jsonb;
  reused jsonb;
  replacement jsonb;
  rejected jsonb;
  source_profile_id uuid;
  pair_a_id uuid;
  pair_b_id uuid;
  assessment_a_id uuid;
  assessment_b_id uuid;
  unsupported_id uuid;
  first_set_id uuid;
  second_set_id uuid;
  set_policy_fingerprint text;
  stored_order uuid[];
  stored_set record;
  superseded_set record;
  set_count integer;
  recommendation_count integer;
  current_set_id uuid;
begin
  set local role postgres;
  select id into source_profile_id
  from catalog_private.semantic_profile_versions
  where video_id = '3a000000-0000-4000-8000-000000000001';
  select policy.set_policy_fingerprint into set_policy_fingerprint
  from catalog_private.recommendation_set_policies as policy
  where policy.status = 'active';

  set local role service_role;
  select public.prepare_recommendation_candidate_pairs(
    '3a000000-0000-4000-8000-000000000001'
  ) into prepared;
  select (candidate.value ->> 'candidatePairEvidenceId')::uuid
  into pair_a_id
  from jsonb_array_elements(prepared -> 'candidates') as candidate(value)
  where candidate.value ->> 'candidateVideoId' =
    '3a000000-0000-4000-8000-000000000002';
  select (candidate.value ->> 'candidatePairEvidenceId')::uuid
  into pair_b_id
  from jsonb_array_elements(prepared -> 'candidates') as candidate(value)
  where candidate.value ->> 'candidateVideoId' =
    '3a000000-0000-4000-8000-000000000003';
  if prepared ->> 'outcome' <> 'prepared'
    or pair_a_id is null
    or pair_b_id is null
  then
    raise exception 'Set fixture pair preparation failed: %', prepared;
  end if;

  select public.remember_recommendation_assessment(
    pair_a_id,
    'fixture-set-assessor-v1',
    'recommendation-assessment-prompt-v1',
    'continuation-relationship-policy-v1',
    jsonb_build_object(
      'schemaVersion', 'recommendation-assessment-v1',
      'supported', true,
      'continuationRelationship', 'deeper_explanation',
      'explanation', 'Candidate A deepens the shared Set core concepts.',
      'evidenceReferences', jsonb_build_array(
        jsonb_build_object(
          'kind', 'matchedCoreConceptKeys',
          'conceptKey', 'set-core-a'
        )
      )
    )
  ) into assessment_a;
  select public.remember_recommendation_assessment(
    pair_b_id,
    'fixture-set-assessor-v1',
    'recommendation-assessment-prompt-v1',
    'continuation-relationship-policy-v1',
    jsonb_build_object(
      'schemaVersion', 'recommendation-assessment-v1',
      'supported', true,
      'continuationRelationship', 'deeper_explanation',
      'explanation', 'Candidate B deepens one exact shared Set concept.',
      'evidenceReferences', jsonb_build_array(
        jsonb_build_object(
          'kind', 'matchedCoreConceptKeys',
          'conceptKey', 'set-core-a'
        )
      )
    )
  ) into assessment_b;
  select public.remember_recommendation_assessment(
    pair_a_id,
    'fixture-set-unsupported-assessor-v1',
    'recommendation-assessment-prompt-v1',
    'continuation-relationship-policy-v1',
    jsonb_build_object(
      'schemaVersion', 'recommendation-assessment-v1',
      'supported', false,
      'continuationRelationship', null,
      'explanation', null,
      'evidenceReferences', jsonb_build_array()
    )
  ) into unsupported;
  assessment_a_id := (assessment_a ->> 'assessmentId')::uuid;
  assessment_b_id := (assessment_b ->> 'assessmentId')::uuid;
  unsupported_id := (unsupported ->> 'assessmentId')::uuid;
  if assessment_a ->> 'outcome' <> 'stored'
    or assessment_b ->> 'outcome' <> 'stored'
    or unsupported ->> 'outcome' <> 'stored'
    or assessment_a_id is null
    or assessment_b_id is null
    or unsupported_id is null
  then
    raise exception 'Set fixture Assessments failed: %, %, %',
      assessment_a, assessment_b, unsupported;
  end if;

  select public.publish_shadow_recommendation_set(
    source_profile_id,
    set_policy_fingerprint,
    array[assessment_b_id, assessment_a_id]
  ) into published;
  first_set_id := (published ->> 'recommendationSetId')::uuid;
  if published ->> 'outcome' <> 'published'
    or published ->> 'status' <> 'current'
    or (published ->> 'itemCount')::integer <> 2
    or first_set_id is null
  then
    raise exception 'exact supported Assessments were not published: %',
      published;
  end if;

  set local role postgres;
  select * into stored_set
  from catalog_private.recommendation_sets
  where id = first_set_id;
  select array_agg(recommendation.candidate_video_id order by ordinal)
  into stored_order
  from catalog_private.recommendations as recommendation
  where recommendation.recommendation_set_id = first_set_id;
  if stored_set.status <> 'current'
    or stored_set.source_profile_id <> source_profile_id
    or stored_set.set_policy_fingerprint <> set_policy_fingerprint
    or stored_set.assessment_model_identifier <> 'fixture-set-assessor-v1'
    or stored_set.item_count <> 2
    or stored_set.build_fingerprint <>
      catalog_private.recommendation_set_build_fingerprint(
        source_profile_id,
        set_policy_fingerprint,
        array[assessment_b_id, assessment_a_id]
      )
    or stored_order <> array[
      '3a000000-0000-4000-8000-000000000003'::uuid,
      '3a000000-0000-4000-8000-000000000002'::uuid
    ]
  then
    raise exception 'published Set lost exact order/configuration: %, %',
      to_jsonb(stored_set), stored_order;
  end if;

  set local role service_role;
  select public.publish_shadow_recommendation_set(
    source_profile_id,
    set_policy_fingerprint,
    array[assessment_b_id, assessment_a_id]
  ) into reused;
  if reused ->> 'outcome' <> 'reused'
    or reused ->> 'recommendationSetId' <> first_set_id::text
    or reused ->> 'status' <> 'current'
  then
    raise exception 'exact Set build was not reused: %, %', published, reused;
  end if;

  select public.publish_shadow_recommendation_set(
    source_profile_id,
    set_policy_fingerprint,
    array[assessment_a_id, assessment_b_id]
  ) into replacement;
  second_set_id := (replacement ->> 'recommendationSetId')::uuid;
  if replacement ->> 'outcome' <> 'published'
    or replacement ->> 'status' <> 'current'
    or second_set_id is null
    or second_set_id = first_set_id
  then
    raise exception 'ordered replacement Set was not published: %', replacement;
  end if;

  set local role postgres;
  select * into superseded_set
  from catalog_private.recommendation_sets
  where id = first_set_id;
  select id into current_set_id
  from catalog_private.recommendation_sets
  where source_video_id = '3a000000-0000-4000-8000-000000000001'
    and status = 'current';
  if superseded_set.status <> 'superseded'
    or superseded_set.superseded_by_set_id <> second_set_id
    or superseded_set.published_at is null
    or superseded_set.superseded_at is null
    or current_set_id <> second_set_id
  then
    raise exception 'Set replacement was not atomic/coherent: %, %, %',
      to_jsonb(superseded_set), current_set_id, second_set_id;
  end if;

  set local role service_role;
  select public.publish_shadow_recommendation_set(
    source_profile_id,
    set_policy_fingerprint,
    array[assessment_b_id, assessment_a_id]
  ) into reused;
  set local role postgres;
  select id into current_set_id
  from catalog_private.recommendation_sets
  where source_video_id = '3a000000-0000-4000-8000-000000000001'
    and status = 'current';
  if reused ->> 'outcome' <> 'reused'
    or reused ->> 'recommendationSetId' <> first_set_id::text
    or reused ->> 'status' <> 'superseded'
    or current_set_id <> second_set_id
  then
    raise exception 'old redelivery resurrected a superseded Set: %, %',
      reused, current_set_id;
  end if;

  set local role service_role;
  select public.publish_shadow_recommendation_set(
    source_profile_id,
    set_policy_fingerprint,
    array[assessment_a_id, unsupported_id]
  ) into rejected;
  if rejected ->> 'outcome' <> 'rejected'
    or rejected ->> 'failureClass' <> 'unverifiable'
    or rejected ->> 'reason' <> 'recommendation_assessment_unsupported'
  then
    raise exception 'unsupported Assessment did not fail closed: %', rejected;
  end if;

  select public.publish_shadow_recommendation_set(
    source_profile_id,
    set_policy_fingerprint,
    array[assessment_a_id, assessment_a_id]
  ) into rejected;
  if rejected ->> 'outcome' <> 'rejected'
    or rejected ->> 'failureClass' <> 'malformed'
    or rejected ->> 'reason' <> 'duplicate_assessment_input'
  then
    raise exception 'duplicate Assessment input did not fail closed: %', rejected;
  end if;

  select public.publish_shadow_recommendation_set(
    source_profile_id,
    repeat('f', 64),
    array[assessment_a_id]
  ) into rejected;
  if rejected ->> 'outcome' <> 'rejected'
    or rejected ->> 'reason' <> 'recommendation_set_policy_inactive'
  then
    raise exception 'unknown Set policy fingerprint did not fail closed: %',
      rejected;
  end if;

  set local role postgres;
  select count(*) into set_count
  from catalog_private.recommendation_sets;
  select count(*) into recommendation_count
  from catalog_private.recommendations;
  select id into current_set_id
  from catalog_private.recommendation_sets
  where source_video_id = '3a000000-0000-4000-8000-000000000001'
    and status = 'current';
  if set_count <> 2
    or recommendation_count <> 4
    or current_set_id <> second_set_id
  then
    raise exception 'rejected Set input changed durable state: %, %, %',
      set_count, recommendation_count, current_set_id;
  end if;

  update public.videos
  set privacy_status = null
  where id = '3a000000-0000-4000-8000-000000000001';
  set local role service_role;
  select public.publish_shadow_recommendation_set(
    source_profile_id,
    set_policy_fingerprint,
    array[assessment_a_id]
  ) into rejected;
  if rejected ->> 'outcome' <> 'rejected'
    or rejected ->> 'failureClass' <> 'unverifiable'
    or rejected ->> 'reason' <> 'recommendation_source_ineligible'
  then
    raise exception 'NULL source privacy gate did not fail closed: %', rejected;
  end if;

  set local role postgres;
  update public.videos
  set privacy_status = 'public', live_status = null
  where id = '3a000000-0000-4000-8000-000000000001';
  set local role service_role;
  select public.publish_shadow_recommendation_set(
    source_profile_id,
    set_policy_fingerprint,
    array[assessment_a_id]
  ) into rejected;
  if rejected ->> 'outcome' <> 'rejected'
    or rejected ->> 'failureClass' <> 'unverifiable'
    or rejected ->> 'reason' <> 'recommendation_source_ineligible'
  then
    raise exception 'NULL source live gate did not fail closed: %', rejected;
  end if;

  set local role postgres;
  update public.videos
  set live_status = 'none'
  where id = '3a000000-0000-4000-8000-000000000001';
  update public.videos
  set privacy_status = null
  where id = '3a000000-0000-4000-8000-000000000002';
  set local role service_role;
  select public.publish_shadow_recommendation_set(
    source_profile_id,
    set_policy_fingerprint,
    array[assessment_a_id]
  ) into rejected;
  if rejected ->> 'outcome' <> 'rejected'
    or rejected ->> 'failureClass' <> 'unverifiable'
    or rejected ->> 'reason' <> 'recommendation_assessment_ineligible'
  then
    raise exception 'NULL candidate privacy gate did not fail closed: %', rejected;
  end if;

  set local role postgres;
  update public.videos
  set privacy_status = 'public', live_status = null
  where id = '3a000000-0000-4000-8000-000000000002';
  set local role service_role;
  select public.publish_shadow_recommendation_set(
    source_profile_id,
    set_policy_fingerprint,
    array[assessment_a_id]
  ) into rejected;
  if rejected ->> 'outcome' <> 'rejected'
    or rejected ->> 'failureClass' <> 'unverifiable'
    or rejected ->> 'reason' <> 'recommendation_assessment_ineligible'
  then
    raise exception 'NULL candidate live gate did not fail closed: %', rejected;
  end if;

  set local role postgres;
  update public.videos
  set live_status = 'none'
  where id = '3a000000-0000-4000-8000-000000000002';
  select count(*) into set_count
  from catalog_private.recommendation_sets;
  select count(*) into recommendation_count
  from catalog_private.recommendations;
  select id into current_set_id
  from catalog_private.recommendation_sets
  where source_video_id = '3a000000-0000-4000-8000-000000000001'
    and status = 'current';
  if set_count <> 2
    or recommendation_count <> 4
    or current_set_id <> second_set_id
  then
    raise exception 'NULL Catalog gates changed durable Set state: %, %, %',
      set_count, recommendation_count, current_set_id;
  end if;

  update catalog_private.youtube_provider_evidence
  set evidence_expires_at = statement_timestamp() - interval '1 minute'
  where video_id = '3a000000-0000-4000-8000-000000000003';
  update public.videos
  set provider_evidence_expires_at = statement_timestamp() - interval '1 minute'
  where id = '3a000000-0000-4000-8000-000000000003';

  set local role service_role;
  select public.publish_shadow_recommendation_set(
    source_profile_id,
    set_policy_fingerprint,
    array[assessment_b_id, assessment_a_id]
  ) into rejected;
  if rejected ->> 'outcome' <> 'rejected'
    or rejected ->> 'failureClass' <> 'unverifiable'
    or rejected ->> 'reason' <> 'recommendation_assessment_ineligible'
  then
    raise exception 'stale Assessment input did not fail closed: %', rejected;
  end if;

  set local role postgres;
  select count(*) into set_count
  from catalog_private.recommendation_sets;
  select count(*) into recommendation_count
  from catalog_private.recommendations;
  select id into current_set_id
  from catalog_private.recommendation_sets
  where source_video_id = '3a000000-0000-4000-8000-000000000001'
    and status = 'current';
  if set_count <> 2
    or recommendation_count <> 4
    or current_set_id <> second_set_id
  then
    raise exception 'stale Set input replaced the current Set: %, %, %',
      set_count, recommendation_count, current_set_id;
  end if;
end;
$materialization$;

do $review_rollout$
declare
  current_set_id uuid;
  review_id uuid;
  quality_report_id uuid;
  quality_report jsonb;
  rollout jsonb;
begin
  -- The fixture uses one current two-item Set. Lowering only the fixture
  -- policy's minimum corpus keeps the positive gate deterministic without
  -- weakening the production default (20).
  set local role postgres;
  update catalog_private.recommendation_review_policies
  set minimum_review_corpus = 1
  where review_policy_version = 'recommendation-review-policy-v1';
  select id into current_set_id
  from catalog_private.recommendation_sets
  where source_video_id = '3a000000-0000-4000-8000-000000000001'
    and status = 'current';
  if current_set_id is null then
    raise exception 'Review fixture current Set is missing';
  end if;

  insert into auth.users (
    id,
    email,
    raw_app_meta_data,
    is_anonymous
  ) values (
    '3a000000-0000-4000-8000-0000000000f1'::uuid,
    'reviewer@example.com',
    jsonb_build_object('is_admin', true),
    false
  ) on conflict (id) do update
  set email = excluded.email,
      raw_app_meta_data = excluded.raw_app_meta_data,
      is_anonymous = excluded.is_anonymous;

  set local role service_role;
  select public.submit_recommendation_review(
    current_set_id,
    1,
    '3a000000-0000-4000-8000-0000000000f1'::uuid,
    'reviewer@example.com',
    true, true, true, true, true, null
  ) into rollout;
  if rollout ->> 'outcome' <> 'stored'
    or rollout ->> 'failureClass' is not null
  then
    raise exception 'valid Review was not stored: %', rollout;
  end if;
  review_id := (rollout ->> 'reviewId')::uuid;

  select public.record_recommendation_ready_read(current_set_id, 1)
  into rollout;
  if rollout ->> 'outcome' <> 'recorded' then
    raise exception 'ready-read observation was not recorded: %', rollout;
  end if;

  select public.compute_recommendation_quality_report(
    'recommendation-review-policy-v1'
  ) into quality_report;
  if quality_report ->> 'outcome' <> 'computed'
    or quality_report ->> 'eligible' <> 'true'
    or (quality_report ->> 'reviewSampleSize')::integer <> 1
  then
    raise exception 'valid Review did not produce an eligible report: %',
      quality_report;
  end if;
  quality_report_id := (quality_report ->> 'qualityReportId')::uuid;

  -- The reader may serve only the exact approved Set policy/report. This
  -- fixture supplies the existing successful Summary row, then verifies that
  -- retiring either the source Profile or its approved semantic model makes
  -- the previously current Set non-retrievable without changing the Set.
  set local role postgres;
  insert into public.summaries (
    video_id, summary, transcript_source
  ) values (
    '3a000000-0000-4000-8000-000000000001'::uuid,
    'Set reader fixture summary', 'auto_captions'
  );
  set local role service_role;
  select public.set_recommendation_rollout(
    'shadow', false, null,
    '3a000000-0000-4000-8000-0000000000f1'::uuid,
    'reviewer@example.com'
  ) into rollout;
  if rollout ->> 'effectiveState' <> 'shadow' then
    raise exception 'reader fixture could not enter shadow: %', rollout;
  end if;
  select public.set_recommendation_rollout(
    'pilot', false, quality_report_id,
    '3a000000-0000-4000-8000-0000000000f1'::uuid,
    'reviewer@example.com'
  ) into rollout;
  if rollout ->> 'effectiveState' <> 'pilot' then
    raise exception 'reader fixture could not enter pilot: %', rollout;
  end if;
  select public.set_recommendation_rollout(
    'on', false, quality_report_id,
    '3a000000-0000-4000-8000-0000000000f1'::uuid,
    'reviewer@example.com'
  ) into rollout;
  if rollout ->> 'effectiveState' <> 'on' then
    raise exception 'eligible quality report did not permit on: %', rollout;
  end if;

  select public.read_continue_learning_recommendations(
    '3a000000-0000-4000-8000-0000000000f2'::uuid,
    'setsource01', 4
  ) into rollout;
  if rollout ->> 'outcome' <> 'ready'
    or jsonb_array_length(rollout -> 'items') not between 1 and 4
  then
    raise exception 'approved current Set was not readable: %', rollout;
  end if;

  set local role postgres;
  update catalog_private.semantic_profile_versions
  set status = 'superseded', superseded_at = statement_timestamp()
  where video_id = '3a000000-0000-4000-8000-000000000001'::uuid
    and status = 'active';
  set local role service_role;
  select public.read_continue_learning_recommendations(
    '3a000000-0000-4000-8000-0000000000f2'::uuid,
    'setsource01', 4
  ) into rollout;
  if rollout ->> 'outcome' <> 'unavailable'
    or rollout ->> 'reason' <> 'source_not_ready'
  then
    raise exception 'superseded source Profile remained readable: %', rollout;
  end if;

  set local role postgres;
  update catalog_private.semantic_profile_versions
  set status = 'active', superseded_at = null
  where video_id = '3a000000-0000-4000-8000-000000000001'::uuid;
  update catalog_private.semantic_profile_model_registry
  set status = 'retired', retired_at = statement_timestamp()
  where model_identifier = 'fixture-set-semantic-model'
    and profile_schema_version = 'semantic-profile-v1'
    and prompt_version = 'semantic-profile-prompt-v1'
    and status = 'active';
  set local role service_role;
  select public.read_continue_learning_recommendations(
    '3a000000-0000-4000-8000-0000000000f2'::uuid,
    'setsource01', 4
  ) into rollout;
  if rollout ->> 'outcome' <> 'unavailable'
    or rollout ->> 'reason' <> 'source_not_ready'
  then
    raise exception 'retired semantic model remained readable: %', rollout;
  end if;

  set local role postgres;
  update catalog_private.semantic_profile_model_registry
  set status = 'active', retired_at = null
  where model_identifier = 'fixture-set-semantic-model'
    and profile_schema_version = 'semantic-profile-v1'
    and prompt_version = 'semantic-profile-prompt-v1';
  set local role service_role;
  select public.set_recommendation_rollout(
    'off', true, null, '3a000000-0000-4000-8000-0000000000f1'::uuid,
    'reviewer@example.com'
  ) into rollout;

  select public.list_recommendation_reviews(
    '3a000000-0000-4000-8000-000000000001'::uuid,
    null, null, null, 'current', null
  ) into rollout;
  if rollout ->> 'outcome' <> 'listed'
    or jsonb_array_length(rollout -> 'reviews') <> 2
    or (rollout -> 'reviews' -> 0 ->> 'reviewerId')::uuid
      <> '3a000000-0000-4000-8000-0000000000f1'::uuid
    or rollout -> 'reviews' -> 1 ->> 'reviewerId' is not null
  then
    raise exception 'Review/prepared Recommendation list contract failed: %', rollout;
  end if;

  select public.list_recommendation_reviews(
    '3a000000-0000-4000-8000-000000000001'::uuid,
    null, 'semantic-profile-v1', null, 'current', null,
    'fixture-set-semantic-model', 'fixture-set-assessor-v1',
    'candidate-pair-policy-v1', 'continuation-relationship-policy-v1',
    'fixture-set-semantic-model', 'catalog-admission-policy-v1',
    'catalog-admission-policy-v1'
  ) into rollout;
  if rollout ->> 'outcome' <> 'listed'
    or jsonb_array_length(rollout -> 'reviews') <> 2
    or rollout -> 'reviews' -> 0 ->> 'evidenceLevel'
      <> 'semantic-profile-v1'
    or rollout -> 'reviews' -> 0 ->> 'assessmentModelIdentifier'
      <> 'fixture-set-assessor-v1'
    or rollout -> 'reviews' -> 0 ->> 'assessmentCandidateCatalogAdmissionPolicyVersion'
      <> 'catalog-admission-policy-v1'
    or rollout -> 'reviews' -> 0 ->> 'candidatePairModelIdentifier'
      <> 'fixture-set-semantic-model'
    or (rollout -> 'reviews' -> 0 ->> 'itemCount')::integer <> 2
  then
    raise exception 'exact Set model/policy/evidence filters failed: %', rollout;
  end if;

  select public.list_recommendation_reviews(
    '3a000000-0000-4000-8000-000000000001'::uuid,
    null, null, null, 'building', null,
    null, null, null, null, null, null, null
  ) into rollout;
  if rollout ->> 'outcome' <> 'listed'
    or jsonb_array_length(rollout -> 'reviews') <> 0
  then
    raise exception 'building Set state filter was not accepted: %', rollout;
  end if;

  select public.set_recommendation_rollout(
    'shadow', false, null, '3a000000-0000-4000-8000-0000000000f1'::uuid,
    'reviewer@example.com'
  ) into rollout;
  if rollout ->> 'effectiveState' <> 'shadow' then
    raise exception 'shadow rollout was not explicitly enabled: %', rollout;
  end if;

  select public.set_recommendation_rollout(
    'pilot', false, quality_report_id,
    '3a000000-0000-4000-8000-0000000000f1'::uuid,
    'reviewer@example.com'
  ) into rollout;
  if rollout ->> 'effectiveState' <> 'pilot' then
    raise exception 'eligible quality report did not permit pilot: %', rollout;
  end if;

  set local role postgres;
  update catalog_private.recommendation_review_policies
  set minimum_review_corpus = 2
  where review_policy_version = 'recommendation-review-policy-v1';
  set local role service_role;
  select public.set_recommendation_rollout(
    'pilot', false, quality_report_id,
    '3a000000-0000-4000-8000-0000000000f1'::uuid,
    'reviewer@example.com'
  ) into rollout;
  if rollout ->> 'outcome' <> 'rejected'
    or rollout ->> 'reason' <> 'quality_report_inputs_stale'
  then
    raise exception 'threshold change did not stale quality report: %', rollout;
  end if;
  set local role postgres;
  update catalog_private.recommendation_review_policies
  set minimum_review_corpus = 1
  where review_policy_version = 'recommendation-review-policy-v1';
  insert into auth.users (
    id,
    email,
    raw_app_meta_data,
    is_anonymous
  ) values (
    '3a000000-0000-4000-8000-0000000000f2'::uuid,
    'second-reviewer@example.com',
    jsonb_build_object('is_admin', true),
    false
  ) on conflict (id) do update
  set email = excluded.email,
      raw_app_meta_data = excluded.raw_app_meta_data,
      is_anonymous = excluded.is_anonymous;
  set local role service_role;

  select public.submit_recommendation_review(
    current_set_id,
    2,
    '3a000000-0000-4000-8000-0000000000f2'::uuid,
    'second-reviewer@example.com',
    false, false, false, false, false, 'multiple'
  ) into rollout;
  if rollout ->> 'outcome' <> 'stored'
    or rollout ->> 'failureClass' <> 'multiple'
  then
    raise exception 'failing Review was not stored with server failure class: %',
      rollout;
  end if;

  select public.compute_recommendation_quality_report(
    'recommendation-review-policy-v1'
  ) into rollout;
  if rollout ->> 'outcome' <> 'computed'
    or rollout ->> 'eligible' <> 'false'
    or (rollout ->> 'unsupportedOrUnsafeCount')::integer <> 1
  then
    raise exception 'quality gates did not fail closed: %', rollout;
  end if;

  select public.get_recommendation_rollout() into rollout;
  if rollout ->> 'effectiveState' <> 'off'
    or rollout ->> 'qualityCurrent' <> 'false'
  then
    raise exception 'stale quality report did not fail closed: %', rollout;
  end if;

  select public.set_recommendation_rollout(
    'pilot', false, quality_report_id,
    '3a000000-0000-4000-8000-0000000000f1'::uuid,
    'reviewer@example.com'
  ) into rollout;
  if rollout ->> 'outcome' <> 'rejected'
    or rollout ->> 'reason' <> 'quality_report_inputs_stale'
  then
    raise exception 'stale quality report was accepted: %', rollout;
  end if;

  select public.set_recommendation_rollout(
    'off', true, null, '3a000000-0000-4000-8000-0000000000f1'::uuid,
    'reviewer@example.com'
  ) into rollout;
  if rollout ->> 'effectiveState' <> 'off'
    or rollout ->> 'killSwitch' <> 'true'
  then
    raise exception 'kill switch did not force rollout off: %', rollout;
  end if;

  set local role postgres;
  if not exists (
    select 1 from public.admin_audit_log
    where action = 'submit_recommendation_review'
      and resource_id = review_id::text
  ) then
    raise exception 'Review audit row is missing';
  end if;
end;
$review_rollout$;

reset role;

rollback;
