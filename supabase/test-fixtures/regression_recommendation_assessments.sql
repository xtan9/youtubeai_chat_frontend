-- Dormant Recommendation Assessment validator/storage contract (Issue #351).

begin;

do $contract$
begin
  if to_regclass('catalog_private.recommendation_assessment_contracts') is null
    or to_regclass('catalog_private.recommendation_assessments') is null
  then
    raise exception 'Recommendation Assessment private storage is missing';
  end if;

  if to_regprocedure(
    'public.remember_recommendation_assessment(uuid,text,text,text,jsonb)'
  ) is null then
    raise exception 'Recommendation Assessment service seam is missing';
  end if;

  if exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'catalog_private'
      and relation.relname in (
        'recommendation_assessment_contracts',
        'recommendation_assessments'
      )
      and relation.relrowsecurity is not true
  ) then
    raise exception 'Recommendation Assessment private tables must enable RLS';
  end if;

  if has_schema_privilege('anon', 'catalog_private', 'USAGE')
    or has_schema_privilege('authenticated', 'catalog_private', 'USAGE')
    or has_table_privilege(
      'service_role',
      'catalog_private.recommendation_assessments',
      'SELECT'
    )
    or has_table_privilege(
      'service_role',
      'catalog_private.recommendation_assessments',
      'INSERT'
    )
    or has_function_privilege(
      'anon',
      'public.remember_recommendation_assessment(uuid,text,text,text,jsonb)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.remember_recommendation_assessment(uuid,text,text,text,jsonb)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.remember_recommendation_assessment(uuid,text,text,text,jsonb)',
      'EXECUTE'
    )
  then
    raise exception 'Recommendation Assessment least privilege is incorrect';
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
    perform 1
    from catalog_private.recommendation_assessments
    limit 1;
  exception when insufficient_privilege then
    read_denied := true;
  end;

  begin
    insert into catalog_private.recommendation_assessments default values;
  exception when insufficient_privilege then
    write_denied := true;
  end;

  begin
    perform public.remember_recommendation_assessment(
      null::uuid, 'forbidden-model', 'forbidden-prompt',
      'forbidden-policy', '{}'::jsonb
    );
  exception when insufficient_privilege then
    rpc_denied := true;
  end;

  if not read_denied or not write_denied or not rpc_denied then
    raise exception
      'anon effective access was not denied (read %, write %, rpc %)',
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
    perform 1
    from catalog_private.recommendation_assessments
    limit 1;
  exception when insufficient_privilege then
    read_denied := true;
  end;

  begin
    insert into catalog_private.recommendation_assessments default values;
  exception when insufficient_privilege then
    write_denied := true;
  end;

  begin
    perform public.remember_recommendation_assessment(
      null::uuid, 'forbidden-model', 'forbidden-prompt',
      'forbidden-policy', '{}'::jsonb
    );
  exception when insufficient_privilege then
    rpc_denied := true;
  end;

  if not read_denied or not write_denied or not rpc_denied then
    raise exception
      'authenticated effective access was not denied (read %, write %, rpc %)',
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
  '38000000-0000-4000-8000-000000000001',
  'https://www.youtube.com/watch?v=assesssrc01', 'assesssrc01',
  'assess-src-hash', 'Assessment source', 'en', 'en', 'active',
  'public', true, 'none', false
), (
  '38000000-0000-4000-8000-000000000002',
  'https://www.youtube.com/watch?v=assesscand1', 'assesscand1',
  'assess-candidate-hash', 'Assessment candidate', 'en', 'es', 'active',
  'public', true, 'none', false
);

insert into catalog_private.catalog_nominations (video_id, status, decided_at)
select id, 'admitted', statement_timestamp()
from public.videos
where id in (
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000002'
);

insert into catalog_private.youtube_provider_evidence (
  nomination_id, video_id, idempotency_key, provider_outcome, provider_path,
  youtube_video_id, title, channel_id, channel_name, default_language,
  duration_seconds, published_at, privacy_status, embeddable, live_status,
  age_restricted, provider_verified_at, evidence_expires_at
)
select
  nomination.id, video.id, 'issue-351:' || video.youtube_video_id,
  'verified', 'youtube_data_api_v3_videos_list', video.youtube_video_id,
  video.title, 'fixture-channel', 'Fixture Channel', video.default_language,
  600, statement_timestamp() - interval '30 days', 'public', true, 'none',
  false, statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '1 day'
from catalog_private.catalog_nominations as nomination
join public.videos as video on video.id = nomination.video_id
where video.id in (
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000002'
);

insert into catalog_private.catalog_admissions (
  nomination_id, video_id, provider_evidence_id, idempotency_key,
  policy_version, decision, decided_at
)
select
  nomination.id, video.id, evidence.id,
  'issue-351:' || video.youtube_video_id,
  'catalog-admission-policy-v1', 'admitted', statement_timestamp()
from catalog_private.catalog_nominations as nomination
join public.videos as video on video.id = nomination.video_id
join catalog_private.youtube_provider_evidence as evidence
  on evidence.nomination_id = nomination.id
where video.id in (
  '38000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000002'
);

update public.videos as video
set provider_evidence_path = evidence.provider_path,
    provider_verified_at = evidence.provider_verified_at,
    provider_evidence_expires_at = evidence.evidence_expires_at
from catalog_private.youtube_provider_evidence as evidence
where evidence.video_id = video.id
  and video.id in (
    '38000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000002'
  );

insert into catalog_private.semantic_profile_versions (
  video_id, profile_schema_version, content_fingerprint, generator_model,
  prompt_version, evaluation_fingerprint, source_language, topics,
  core_concepts, topic_keys, core_concept_keys, prerequisite_concept_keys,
  application_concept_keys, counterpoint_concept_keys, difficulty, profile
) values (
  '38000000-0000-4000-8000-000000000001',
  'semantic-profile-v1', repeat('1', 64), 'fixture-assessment-model',
  'semantic-profile-prompt-v1', repeat('a', 64), 'en',
  '[{"key":"machine-learning","label":"Machine learning"}]',
  '[{"key":"gradient-descent","label":"Gradient descent"},{"key":"loss-functions","label":"Loss functions"}]',
  array['machine-learning'], array['gradient-descent', 'loss-functions'],
  array['calculus'], array['model-training'], array['bayesian-methods'],
  'intermediate', '{"schemaVersion":"semantic-profile-v1"}'
), (
  '38000000-0000-4000-8000-000000000002',
  'semantic-profile-v1', repeat('2', 64), 'fixture-assessment-model',
  'semantic-profile-prompt-v1', repeat('a', 64), 'es',
  '[{"key":"machine-learning","label":"Aprendizaje automatico"}]',
  '[{"key":"bayesian-methods","label":"Metodos bayesianos"},{"key":"gradient-descent","label":"Descenso de gradiente"},{"key":"loss-functions","label":"Funciones de perdida"}]',
  array['machine-learning'],
  array['bayesian-methods', 'gradient-descent', 'loss-functions'],
  array['model-training'], array['calculus'], array[]::text[],
  'advanced', '{"schemaVersion":"semantic-profile-v1"}'
);

insert into catalog_private.semantic_profile_evaluations (
  evaluation_fingerprint, model_identifier, profile_schema_version,
  prompt_version, gateway_provider, metrics, status, evaluated_at
) values (
  repeat('a', 64), 'fixture-assessment-model', 'semantic-profile-v1',
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
  'issue-351-fixture-approval', repeat('a', 64),
  'fixture-assessment-model', 'semantic-profile-v1',
  'semantic-profile-prompt-v1', 'fixture-human-reviewer', 'approved',
  statement_timestamp()
);

set role service_role;
select public.activate_semantic_profile_model(
  'fixture-assessment-model', 'semantic-profile-v1',
  'semantic-profile-prompt-v1', repeat('a', 64),
  'issue-351-fixture-approval'
);

do $happy_path$
declare
  prepared jsonb;
  remembered jsonb;
  replayed jsonb;
  unsupported jsonb;
  rejected jsonb;
  valid_supported jsonb;
  pair_evidence_id uuid;
  stored record;
  assessment_count integer;
  relationship_case record;
  relationship_result jsonb;
begin
  select public.prepare_recommendation_candidate_pairs(
    '38000000-0000-4000-8000-000000000001'
  ) into prepared;
  pair_evidence_id := (
    prepared #>> '{candidates,0,candidatePairEvidenceId}'
  )::uuid;
  if prepared ->> 'outcome' <> 'prepared' or pair_evidence_id is null then
    raise exception 'fixture pair preparation failed: %', prepared;
  end if;

  valid_supported := jsonb_build_object(
    'schemaVersion', 'recommendation-assessment-v1',
    'supported', true,
    'continuationRelationship', 'deeper_explanation',
    'explanation', 'A deeper treatment of the shared optimization concepts.',
    'evidenceReferences', jsonb_build_array(
      jsonb_build_object(
        'kind', 'matchedCoreConceptKeys',
        'conceptKey', 'gradient-descent'
      )
    )
  );

  select public.remember_recommendation_assessment(
    pair_evidence_id,
    'fixture-assessor-v1',
    'recommendation-assessment-prompt-v1',
    'continuation-relationship-policy-v1',
    valid_supported
  ) into remembered;

  if remembered ->> 'outcome' <> 'stored'
    or (remembered ->> 'supported')::boolean is not true
    or remembered ->> 'assessmentId' is null
  then
    raise exception 'valid supported Assessment was not stored: %', remembered;
  end if;

  set local role postgres;
  select * into stored
  from catalog_private.recommendation_assessments
  where id = (remembered ->> 'assessmentId')::uuid;
  if stored.candidate_pair_evidence_id <> pair_evidence_id
    or stored.source_profile_id is null
    or stored.candidate_profile_id is null
    or stored.semantic_model_identifier <> 'fixture-assessment-model'
    or stored.semantic_evaluation_fingerprint <> repeat('a', 64)
    or stored.source_catalog_admission_policy_version
      <> 'catalog-admission-policy-v1'
    or stored.candidate_catalog_admission_policy_version
      <> 'catalog-admission-policy-v1'
    or stored.continuation_relationship <> 'deeper_explanation'
    or stored.evidence_references <> jsonb_build_array(
      jsonb_build_object(
        'kind', 'matchedCoreConceptKeys',
        'conceptKey', 'gradient-descent'
      )
    )
  then
    raise exception 'stored Assessment lost its versioned evidence: %',
      to_jsonb(stored);
  end if;

  set local role service_role;
  select public.remember_recommendation_assessment(
    pair_evidence_id,
    'fixture-assessor-v1',
    'recommendation-assessment-prompt-v1',
    'continuation-relationship-policy-v1',
    valid_supported
  ) into replayed;
  if replayed ->> 'outcome' <> 'reused'
    or replayed ->> 'assessmentId' <> remembered ->> 'assessmentId'
  then
    raise exception 'exact Assessment tuple was not reused: %, %',
      remembered, replayed;
  end if;

  select public.remember_recommendation_assessment(
    pair_evidence_id,
    'fixture-assessor-v1',
    'recommendation-assessment-prompt-v1',
    'continuation-relationship-policy-v1',
    jsonb_build_object(
      'schemaVersion', 'recommendation-assessment-v1',
      'supported', false,
      'continuationRelationship', null,
      'explanation', null,
      'evidenceReferences', jsonb_build_array()
    )
  ) into replayed;
  if replayed ->> 'outcome' <> 'reused'
    or replayed ->> 'assessmentId' <> remembered ->> 'assessmentId'
    or (replayed ->> 'supported')::boolean is not true
  then
    raise exception 'remembered Assessment was replaced by duplicate output: %',
      replayed;
  end if;

  select public.remember_recommendation_assessment(
    pair_evidence_id,
    'fixture-assessor-unsupported-v1',
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
  if unsupported ->> 'outcome' <> 'stored'
    or (unsupported ->> 'supported')::boolean is not false
  then
    raise exception 'valid unsupported Assessment was not stored: %', unsupported;
  end if;

  for relationship_case in
    select *
    from (values
      (
        'prerequisite',
        'matchedSourcePrerequisiteCandidateApplicationKeys',
        'calculus'
      ),
      (
        'practical_application',
        'matchedSourceApplicationCandidatePrerequisiteKeys',
        'model-training'
      ),
      (
        'credible_alternative',
        'matchedSourceCounterpointCandidateCoreKeys',
        'bayesian-methods'
      )
    ) as relationship_cases(relationship, evidence_kind, concept_key)
  loop
    select public.remember_recommendation_assessment(
      pair_evidence_id,
      'fixture-assessor-' || relationship_case.relationship || '-v1',
      'recommendation-assessment-prompt-v1',
      'continuation-relationship-policy-v1',
      jsonb_build_object(
        'schemaVersion', 'recommendation-assessment-v1',
        'supported', true,
        'continuationRelationship', relationship_case.relationship,
        'explanation',
          'The exact prepared pair supports this governed relationship.',
        'evidenceReferences', jsonb_build_array(
          jsonb_build_object(
            'kind', relationship_case.evidence_kind,
            'conceptKey', relationship_case.concept_key
          )
        )
      )
    ) into relationship_result;

    if relationship_result ->> 'outcome' <> 'stored'
      or relationship_result ->> 'supported' <> 'true'
    then
      raise exception 'valid % Assessment was not stored: %',
        relationship_case.relationship, relationship_result;
    end if;
  end loop;

  set local role postgres;
  update catalog_private.recommendation_assessment_contracts
  set status = 'retired', retired_at = statement_timestamp()
  where relationship_policy_version = 'continuation-relationship-policy-v1';
  insert into catalog_private.recommendation_assessment_contracts (
    relationship_policy_version,
    candidate_pair_policy_version,
    assessment_schema_version,
    assessment_prompt_version,
    maximum_explanation_characters,
    maximum_evidence_references,
    minimum_deeper_explanation_core_matches,
    minimum_prerequisite_directional_matches,
    minimum_practical_application_directional_matches,
    minimum_credible_alternative_counterpoint_matches,
    status
  ) values (
    'continuation-relationship-policy-v2',
    'candidate-pair-policy-v1',
    'recommendation-assessment-v1',
    'recommendation-assessment-prompt-v1',
    280, 8, 3, 2, 2, 2, 'active'
  );
  set local role service_role;

  for relationship_case in
    select *
    from (values
      ('deeper_explanation', 'matchedCoreConceptKeys', 'gradient-descent'),
      (
        'prerequisite',
        'matchedSourcePrerequisiteCandidateApplicationKeys',
        'calculus'
      ),
      (
        'practical_application',
        'matchedSourceApplicationCandidatePrerequisiteKeys',
        'model-training'
      ),
      (
        'credible_alternative',
        'matchedSourceCounterpointCandidateCoreKeys',
        'bayesian-methods'
      )
    ) as relationship_cases(relationship, evidence_kind, concept_key)
  loop
    select public.remember_recommendation_assessment(
      pair_evidence_id,
      'fixture-assessor-below-floor-' || relationship_case.relationship || '-v1',
      'recommendation-assessment-prompt-v1',
      'continuation-relationship-policy-v2',
      jsonb_build_object(
        'schemaVersion', 'recommendation-assessment-v1',
        'supported', true,
        'continuationRelationship', relationship_case.relationship,
        'explanation', 'The pair does not meet this test policy evidence floor.',
        'evidenceReferences', jsonb_build_array(
          jsonb_build_object(
            'kind', relationship_case.evidence_kind,
            'conceptKey', relationship_case.concept_key
          )
        )
      )
    ) into relationship_result;

    if relationship_result ->> 'outcome' <> 'rejected'
      or relationship_result ->> 'failureClass' <> 'unverifiable'
      or relationship_result ->> 'reason' <> 'relationship_evidence_floor'
    then
      raise exception 'below-floor % Assessment did not fail closed: %',
        relationship_case.relationship, relationship_result;
    end if;
  end loop;

  set local role postgres;
  delete from catalog_private.recommendation_assessment_contracts
  where relationship_policy_version = 'continuation-relationship-policy-v2';
  update catalog_private.recommendation_assessment_contracts
  set status = 'active', retired_at = null
  where relationship_policy_version = 'continuation-relationship-policy-v1';
  set local role service_role;

  select public.remember_recommendation_assessment(
    pair_evidence_id,
    'fixture-assessor-malformed-v1',
    'recommendation-assessment-prompt-v1',
    'continuation-relationship-policy-v1',
    valid_supported || jsonb_build_object('providerScore', 0.99)
  ) into rejected;
  if rejected ->> 'outcome' <> 'rejected'
    or rejected ->> 'failureClass' <> 'malformed'
  then
    raise exception 'unknown provider fields did not fail closed: %', rejected;
  end if;

  select public.remember_recommendation_assessment(
    pair_evidence_id,
    'fixture-assessor-forged-v1',
    'recommendation-assessment-prompt-v1',
    'continuation-relationship-policy-v1',
    jsonb_set(
      valid_supported,
      '{evidenceReferences,0,conceptKey}',
      '"not-recorded"'::jsonb
    )
  ) into rejected;
  if rejected ->> 'outcome' <> 'rejected'
    or rejected ->> 'failureClass' <> 'unverifiable'
  then
    raise exception 'forged evidence reference did not fail closed: %', rejected;
  end if;

  set local role postgres;
  select count(*) into assessment_count
  from catalog_private.recommendation_assessments;
  if assessment_count <> 5 then
    raise exception 'invalid or repeated output changed Assessment count: %',
      assessment_count;
  end if;
end;
$happy_path$;

update catalog_private.youtube_provider_evidence
set evidence_expires_at = statement_timestamp() - interval '1 minute'
where video_id = '38000000-0000-4000-8000-000000000002';
update public.videos
set provider_evidence_expires_at = statement_timestamp() - interval '1 minute'
where id = '38000000-0000-4000-8000-000000000002';

do $stale_evidence$
declare
  pair_evidence_id uuid;
  rejected jsonb;
  assessment_count integer;
begin
  select id into pair_evidence_id
  from catalog_private.recommendation_candidate_pair_evidence
  where candidate_profile_id in (
    select id
    from catalog_private.semantic_profile_versions
    where video_id = '38000000-0000-4000-8000-000000000002'
  );

  set local role service_role;
  select public.remember_recommendation_assessment(
    pair_evidence_id,
    'fixture-assessor-after-stale-v1',
    'recommendation-assessment-prompt-v1',
    'continuation-relationship-policy-v1',
    jsonb_build_object(
      'schemaVersion', 'recommendation-assessment-v1',
      'supported', false,
      'continuationRelationship', null,
      'explanation', null,
      'evidenceReferences', jsonb_build_array()
    )
  ) into rejected;
  if rejected ->> 'outcome' <> 'rejected'
    or rejected ->> 'failureClass' <> 'unverifiable'
    or rejected ->> 'reason' <> 'candidate_pair_ineligible'
  then
    raise exception 'stale pair evidence did not fail closed: %', rejected;
  end if;

  set local role postgres;
  select count(*) into assessment_count
  from catalog_private.recommendation_assessments;
  if assessment_count <> 5 then
    raise exception 'stale pair evidence persisted an Assessment: %',
      assessment_count;
  end if;
end;
$stale_evidence$;

reset role;

rollback;
