-- Validate and remember dormant Recommendation Assessments (Issue #351).
--
-- This migration deliberately adds no queue, worker, Gateway call,
-- Recommendation Set, or learner-facing reader. The only write seam consumes
-- the immutable candidate-pair evidence prepared by Issue #350 and remains
-- unavailable until Issue #349 has an active evaluated and human-approved
-- Semantic Profile tuple.

create table catalog_private.recommendation_assessment_contracts (
  relationship_policy_version text primary key check (
    relationship_policy_version ~ '^continuation-relationship-policy-v[1-9][0-9]*$'
  ),
  candidate_pair_policy_version text not null references
    catalog_private.recommendation_candidate_pair_policies(policy_version)
    on delete restrict,
  assessment_schema_version text not null check (
    assessment_schema_version = 'recommendation-assessment-v1'
  ),
  assessment_prompt_version text not null check (
    assessment_prompt_version = 'recommendation-assessment-prompt-v1'
  ),
  maximum_explanation_characters integer not null check (
    maximum_explanation_characters between 1 and 500
  ),
  maximum_evidence_references integer not null check (
    maximum_evidence_references between 1 and 16
  ),
  minimum_deeper_explanation_core_matches integer not null check (
    minimum_deeper_explanation_core_matches between 1 and 16
  ),
  minimum_prerequisite_directional_matches integer not null check (
    minimum_prerequisite_directional_matches between 1 and 16
  ),
  minimum_practical_application_directional_matches integer not null check (
    minimum_practical_application_directional_matches between 1 and 16
  ),
  minimum_credible_alternative_counterpoint_matches integer not null check (
    minimum_credible_alternative_counterpoint_matches between 1 and 16
  ),
  status text not null check (status in ('active', 'retired')),
  created_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  check (
    (status = 'active' and retired_at is null)
    or (status = 'retired' and retired_at is not null)
  )
);

create unique index recommendation_assessment_one_active_contract_idx
  on catalog_private.recommendation_assessment_contracts (
    candidate_pair_policy_version
  )
  where status = 'active';

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
  'continuation-relationship-policy-v1',
  'candidate-pair-policy-v1',
  'recommendation-assessment-v1',
  'recommendation-assessment-prompt-v1',
  280,
  8,
  1,
  1,
  1,
  1,
  'active'
);

create table catalog_private.recommendation_assessments (
  id uuid primary key default gen_random_uuid(),
  candidate_pair_evidence_id uuid not null references
    catalog_private.recommendation_candidate_pair_evidence(id)
    on delete restrict,
  source_profile_id uuid not null references
    catalog_private.semantic_profile_versions(id) on delete restrict,
  candidate_profile_id uuid not null references
    catalog_private.semantic_profile_versions(id) on delete restrict,
  source_catalog_admission_id uuid not null references
    catalog_private.catalog_admissions(id) on delete restrict,
  candidate_catalog_admission_id uuid not null references
    catalog_private.catalog_admissions(id) on delete restrict,
  semantic_model_identifier text not null check (
    btrim(semantic_model_identifier) <> ''
    and semantic_model_identifier = btrim(semantic_model_identifier)
  ),
  profile_schema_version text not null check (
    profile_schema_version = 'semantic-profile-v1'
  ),
  semantic_prompt_version text not null check (
    semantic_prompt_version = 'semantic-profile-prompt-v1'
  ),
  semantic_evaluation_fingerprint text not null references
    catalog_private.semantic_profile_evaluations(evaluation_fingerprint)
    on delete restrict check (semantic_evaluation_fingerprint ~ '^[a-f0-9]{64}$'),
  candidate_pair_policy_version text not null references
    catalog_private.recommendation_candidate_pair_policies(policy_version)
    on delete restrict,
  source_catalog_admission_policy_version text not null check (
    btrim(source_catalog_admission_policy_version) <> ''
    and source_catalog_admission_policy_version =
      btrim(source_catalog_admission_policy_version)
  ),
  candidate_catalog_admission_policy_version text not null check (
    btrim(candidate_catalog_admission_policy_version) <> ''
    and candidate_catalog_admission_policy_version =
      btrim(candidate_catalog_admission_policy_version)
  ),
  assessment_model_identifier text not null check (
    btrim(assessment_model_identifier) <> ''
    and assessment_model_identifier = btrim(assessment_model_identifier)
    and char_length(assessment_model_identifier) <= 200
  ),
  assessment_schema_version text not null check (
    assessment_schema_version = 'recommendation-assessment-v1'
  ),
  assessment_prompt_version text not null check (
    assessment_prompt_version = 'recommendation-assessment-prompt-v1'
  ),
  relationship_policy_version text not null references
    catalog_private.recommendation_assessment_contracts(relationship_policy_version)
    on delete restrict,
  supported boolean not null,
  continuation_relationship text check (
    continuation_relationship is null
    or continuation_relationship in (
      'deeper_explanation',
      'prerequisite',
      'practical_application',
      'credible_alternative'
    )
  ),
  explanation text,
  evidence_references jsonb not null check (
    jsonb_typeof(evidence_references) = 'array'
    and jsonb_array_length(evidence_references) <= 16
  ),
  created_at timestamptz not null default clock_timestamp(),
  check (
    (
      supported
      and continuation_relationship is not null
      and explanation is not null
      and btrim(explanation) <> ''
      and explanation = btrim(explanation)
      and char_length(explanation) <= 500
      and explanation !~ '[[:cntrl:]]'
      and jsonb_array_length(evidence_references) > 0
    )
    or (
      not supported
      and continuation_relationship is null
      and explanation is null
      and evidence_references = '[]'::jsonb
    )
  ),
  unique (
    source_profile_id,
    candidate_profile_id,
    source_catalog_admission_id,
    candidate_catalog_admission_id,
    semantic_model_identifier,
    profile_schema_version,
    semantic_prompt_version,
    semantic_evaluation_fingerprint,
    candidate_pair_policy_version,
    source_catalog_admission_policy_version,
    candidate_catalog_admission_policy_version,
    assessment_model_identifier,
    assessment_schema_version,
    assessment_prompt_version,
    relationship_policy_version
  )
);

create index recommendation_assessment_pair_idx
  on catalog_private.recommendation_assessments (candidate_pair_evidence_id);
create index recommendation_assessment_source_profile_idx
  on catalog_private.recommendation_assessments (source_profile_id, created_at desc);
create index recommendation_assessment_candidate_profile_idx
  on catalog_private.recommendation_assessments (candidate_profile_id);

alter table catalog_private.recommendation_assessment_contracts
  enable row level security;
alter table catalog_private.recommendation_assessments enable row level security;

revoke all on table catalog_private.recommendation_assessment_contracts
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.recommendation_assessments
  from public, anon, authenticated, service_role;

create or replace function catalog_private.remember_recommendation_assessment(
  p_candidate_pair_evidence_id uuid,
  p_assessment_model_identifier text,
  p_assessment_prompt_version text,
  p_relationship_policy_version text,
  p_assessment jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  assessment_contract
    catalog_private.recommendation_assessment_contracts%rowtype;
  pair_evidence record;
  assessment_supported boolean;
  assessment_relationship text;
  assessment_explanation text;
  validated_assessment_schema_version text;
  assessment_id uuid;
  normalized_evidence_references jsonb := '[]'::jsonb;
  reference_row record;
  reference_is_supported boolean;
  inserted boolean := false;
  remembered_supported boolean;
begin
  if p_candidate_pair_evidence_id is null
    or btrim(coalesce(p_assessment_model_identifier, '')) = ''
    or char_length(btrim(p_assessment_model_identifier)) > 200
    or coalesce(p_assessment_prompt_version, '')
      <> 'recommendation-assessment-prompt-v1'
    or coalesce(p_relationship_policy_version, '')
      !~ '^continuation-relationship-policy-v[1-9][0-9]*$'
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'assessment_contract'
    );
  end if;

  -- Share the Issue #349 activation lock so retirement cannot race a valid
  -- check into storing an Assessment for a tuple that is no longer approved.
  perform pg_advisory_xact_lock_shared(hashtext('semantic-profile-activation'));

  select
    pair.*,
    source_profile.status as source_profile_status,
    source_profile.generator_model as source_generator_model,
    source_profile.profile_schema_version as source_profile_schema_version,
    source_profile.prompt_version as source_prompt_version,
    source_profile.evaluation_fingerprint as source_evaluation_fingerprint,
    source_profile.video_id as source_video_id,
    candidate_profile.status as candidate_profile_status,
    candidate_profile.generator_model as candidate_generator_model,
    candidate_profile.profile_schema_version as candidate_profile_schema_version,
    candidate_profile.prompt_version as candidate_prompt_version,
    candidate_profile.evaluation_fingerprint as candidate_evaluation_fingerprint,
    candidate_profile.video_id as candidate_video_id,
    source_admission.policy_version as source_admission_policy_version,
    source_admission.decision as source_admission_decision,
    source_admission.reason_code as source_admission_reason_code,
    source_admission.id = (
      select latest_source_admission.id
      from catalog_private.catalog_admissions as latest_source_admission
      where latest_source_admission.video_id = source_admission.video_id
      order by
        latest_source_admission.decided_at desc,
        latest_source_admission.id desc
      limit 1
    ) as source_admission_is_latest,
    candidate_admission.policy_version as candidate_admission_policy_version,
    candidate_admission.decision as candidate_admission_decision,
    candidate_admission.reason_code as candidate_admission_reason_code,
    candidate_admission.id = (
      select latest_candidate_admission.id
      from catalog_private.catalog_admissions as latest_candidate_admission
      where latest_candidate_admission.video_id = candidate_admission.video_id
      order by
        latest_candidate_admission.decided_at desc,
        latest_candidate_admission.id desc
      limit 1
    ) as candidate_admission_is_latest,
    source_provider_evidence.provider_outcome as source_provider_outcome,
    source_provider_evidence.provider_path as source_provider_path,
    source_provider_evidence.provider_verified_at as source_provider_verified_at,
    source_provider_evidence.evidence_expires_at as source_evidence_expires_at,
    candidate_provider_evidence.provider_outcome as candidate_provider_outcome,
    candidate_provider_evidence.provider_path as candidate_provider_path,
    candidate_provider_evidence.provider_verified_at as
      candidate_provider_verified_at,
    candidate_provider_evidence.evidence_expires_at as
      candidate_evidence_expires_at,
    source_video.catalog_state as source_catalog_state,
    source_video.catalog_inactive_reason as source_catalog_inactive_reason,
    source_video.privacy_status as source_privacy_status,
    source_video.embeddable as source_embeddable,
    source_video.live_status as source_live_status,
    source_video.age_restricted as source_age_restricted,
    source_video.provider_evidence_path as source_video_provider_path,
    source_video.provider_verified_at as source_video_provider_verified_at,
    source_video.provider_evidence_expires_at as
      source_video_evidence_expires_at,
    candidate_video.catalog_state as candidate_catalog_state,
    candidate_video.catalog_inactive_reason as candidate_catalog_inactive_reason,
    candidate_video.privacy_status as candidate_privacy_status,
    candidate_video.embeddable as candidate_embeddable,
    candidate_video.live_status as candidate_live_status,
    candidate_video.age_restricted as candidate_age_restricted,
    candidate_video.provider_evidence_path as candidate_video_provider_path,
    candidate_video.provider_verified_at as candidate_video_provider_verified_at,
    candidate_video.provider_evidence_expires_at as
      candidate_video_evidence_expires_at,
    pair_policy.status as candidate_pair_policy_status
  into pair_evidence
  from catalog_private.recommendation_candidate_pair_evidence as pair
  join catalog_private.semantic_profile_versions as source_profile
    on source_profile.id = pair.source_profile_id
  join catalog_private.semantic_profile_versions as candidate_profile
    on candidate_profile.id = pair.candidate_profile_id
  join catalog_private.catalog_admissions as source_admission
    on source_admission.id = pair.source_catalog_admission_id
   and source_admission.video_id = source_profile.video_id
  join catalog_private.catalog_admissions as candidate_admission
    on candidate_admission.id = pair.candidate_catalog_admission_id
   and candidate_admission.video_id = candidate_profile.video_id
  join catalog_private.youtube_provider_evidence as source_provider_evidence
    on source_provider_evidence.id = source_admission.provider_evidence_id
   and source_provider_evidence.video_id = source_admission.video_id
  join catalog_private.youtube_provider_evidence as candidate_provider_evidence
    on candidate_provider_evidence.id = candidate_admission.provider_evidence_id
   and candidate_provider_evidence.video_id = candidate_admission.video_id
  join public.videos as source_video
    on source_video.id = source_profile.video_id
  join public.videos as candidate_video
    on candidate_video.id = candidate_profile.video_id
  join catalog_private.recommendation_candidate_pair_policies as pair_policy
    on pair_policy.policy_version = pair.candidate_pair_policy_version
  where pair.id = p_candidate_pair_evidence_id;

  if pair_evidence.id is null then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unverifiable',
      'reason', 'candidate_pair_evidence_missing'
    );
  end if;

  select contract.* into assessment_contract
  from catalog_private.recommendation_assessment_contracts as contract
  where contract.relationship_policy_version = p_relationship_policy_version
    and contract.candidate_pair_policy_version =
      pair_evidence.candidate_pair_policy_version
    and contract.assessment_prompt_version = p_assessment_prompt_version
    and contract.status = 'active';

  if assessment_contract.relationship_policy_version is null then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unverifiable',
      'reason', 'assessment_contract_inactive'
    );
  end if;

  if pair_evidence.candidate_pair_policy_status <> 'active'
    or pair_evidence.source_profile_status <> 'active'
    or pair_evidence.candidate_profile_status <> 'active'
    or pair_evidence.source_generator_model is distinct from
      pair_evidence.model_identifier
    or pair_evidence.candidate_generator_model is distinct from
      pair_evidence.model_identifier
    or pair_evidence.source_profile_schema_version is distinct from
      pair_evidence.profile_schema_version
    or pair_evidence.candidate_profile_schema_version is distinct from
      pair_evidence.profile_schema_version
    or pair_evidence.source_prompt_version is distinct from
      pair_evidence.prompt_version
    or pair_evidence.candidate_prompt_version is distinct from
      pair_evidence.prompt_version
    or pair_evidence.source_evaluation_fingerprint is distinct from
      pair_evidence.evaluation_fingerprint
    or pair_evidence.candidate_evaluation_fingerprint is distinct from
      pair_evidence.evaluation_fingerprint
    or not catalog_private.semantic_profile_activation_is_available(
      pair_evidence.model_identifier,
      pair_evidence.profile_schema_version,
      pair_evidence.prompt_version,
      pair_evidence.evaluation_fingerprint
    )
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unverifiable',
      'reason', 'semantic_profile_tuple_inactive'
    );
  end if;

  if pair_evidence.evidence_level <> 'semantic-profile-v1'
    or pair_evidence.source_admission_decision <> 'admitted'
    or pair_evidence.source_admission_reason_code is not null
    or pair_evidence.source_admission_is_latest is not true
    or pair_evidence.candidate_admission_decision <> 'admitted'
    or pair_evidence.candidate_admission_reason_code is not null
    or pair_evidence.candidate_admission_is_latest is not true
    or pair_evidence.source_provider_outcome <> 'verified'
    or pair_evidence.source_provider_path <>
      'youtube_data_api_v3_videos_list'
    or pair_evidence.source_provider_verified_at >
      statement_timestamp() + interval '5 minutes'
    or pair_evidence.source_evidence_expires_at <= statement_timestamp()
    or pair_evidence.candidate_provider_outcome <> 'verified'
    or pair_evidence.candidate_provider_path <>
      'youtube_data_api_v3_videos_list'
    or pair_evidence.candidate_provider_verified_at >
      statement_timestamp() + interval '5 minutes'
    or pair_evidence.candidate_evidence_expires_at <= statement_timestamp()
    or pair_evidence.source_catalog_state <> 'active'
    or pair_evidence.source_catalog_inactive_reason is not null
    or pair_evidence.source_privacy_status <> 'public'
    or pair_evidence.source_embeddable is not true
    or pair_evidence.source_live_status <> 'none'
    or pair_evidence.source_age_restricted is not false
    or pair_evidence.source_video_provider_path is distinct from
      pair_evidence.source_provider_path
    or pair_evidence.source_video_provider_verified_at is distinct from
      pair_evidence.source_provider_verified_at
    or pair_evidence.source_video_evidence_expires_at is distinct from
      pair_evidence.source_evidence_expires_at
    or pair_evidence.candidate_catalog_state <> 'active'
    or pair_evidence.candidate_catalog_inactive_reason is not null
    or pair_evidence.candidate_privacy_status <> 'public'
    or pair_evidence.candidate_embeddable is not true
    or pair_evidence.candidate_live_status <> 'none'
    or pair_evidence.candidate_age_restricted is not false
    or pair_evidence.candidate_video_provider_path is distinct from
      pair_evidence.candidate_provider_path
    or pair_evidence.candidate_video_provider_verified_at is distinct from
      pair_evidence.candidate_provider_verified_at
    or pair_evidence.candidate_video_evidence_expires_at is distinct from
      pair_evidence.candidate_evidence_expires_at
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unverifiable',
      'reason', 'candidate_pair_ineligible'
    );
  end if;

  -- A valid exact tuple is reusable independently of a redelivered provider
  -- body. Lookup happens only after every current hard gate has been rechecked.
  select assessment.id, assessment.supported
  into assessment_id, remembered_supported
  from catalog_private.recommendation_assessments as assessment
  where assessment.source_profile_id = pair_evidence.source_profile_id
    and assessment.candidate_profile_id = pair_evidence.candidate_profile_id
    and assessment.source_catalog_admission_id =
      pair_evidence.source_catalog_admission_id
    and assessment.candidate_catalog_admission_id =
      pair_evidence.candidate_catalog_admission_id
    and assessment.semantic_model_identifier = pair_evidence.model_identifier
    and assessment.profile_schema_version = pair_evidence.profile_schema_version
    and assessment.semantic_prompt_version = pair_evidence.prompt_version
    and assessment.semantic_evaluation_fingerprint =
      pair_evidence.evaluation_fingerprint
    and assessment.candidate_pair_policy_version =
      pair_evidence.candidate_pair_policy_version
    and assessment.source_catalog_admission_policy_version =
      pair_evidence.source_admission_policy_version
    and assessment.candidate_catalog_admission_policy_version =
      pair_evidence.candidate_admission_policy_version
    and assessment.assessment_model_identifier =
      btrim(p_assessment_model_identifier)
    and assessment.assessment_schema_version =
      assessment_contract.assessment_schema_version
    and assessment.assessment_prompt_version = p_assessment_prompt_version
    and assessment.relationship_policy_version = p_relationship_policy_version;

  if assessment_id is not null then
    return jsonb_build_object(
      'outcome', 'reused',
      'assessmentId', assessment_id,
      'supported', remembered_supported
    );
  end if;

  if p_assessment is null
    or jsonb_typeof(p_assessment) <> 'object'
    or not (p_assessment ?& array[
      'schemaVersion',
      'supported',
      'continuationRelationship',
      'explanation',
      'evidenceReferences'
    ])
    or (
      select count(*) from jsonb_object_keys(p_assessment)
    ) <> 5
    or jsonb_typeof(p_assessment -> 'schemaVersion') <> 'string'
    or jsonb_typeof(p_assessment -> 'supported') <> 'boolean'
    or jsonb_typeof(p_assessment -> 'evidenceReferences') <> 'array'
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'assessment_contract'
    );
  end if;

  validated_assessment_schema_version := p_assessment ->> 'schemaVersion';
  assessment_supported := (p_assessment ->> 'supported')::boolean;
  assessment_relationship := p_assessment ->> 'continuationRelationship';
  assessment_explanation := p_assessment ->> 'explanation';

  if validated_assessment_schema_version <>
      assessment_contract.assessment_schema_version
    or jsonb_array_length(p_assessment -> 'evidenceReferences') >
      assessment_contract.maximum_evidence_references
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'assessment_contract'
    );
  end if;

  if not assessment_supported then
    if p_assessment -> 'continuationRelationship' <> 'null'::jsonb
      or p_assessment -> 'explanation' <> 'null'::jsonb
      or p_assessment -> 'evidenceReferences' <> '[]'::jsonb
    then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'malformed',
        'reason', 'unsupported_assessment_contract'
      );
    end if;
  else
    if jsonb_typeof(p_assessment -> 'continuationRelationship') <> 'string'
      or assessment_relationship not in (
        'deeper_explanation',
        'prerequisite',
        'practical_application',
        'credible_alternative'
      )
      or jsonb_typeof(p_assessment -> 'explanation') <> 'string'
      or btrim(coalesce(assessment_explanation, '')) = ''
      or assessment_explanation <> btrim(assessment_explanation)
      or char_length(assessment_explanation) >
        assessment_contract.maximum_explanation_characters
      or assessment_explanation ~ '[[:cntrl:]]'
      or jsonb_array_length(p_assessment -> 'evidenceReferences') = 0
    then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'malformed',
        'reason', 'supported_assessment_contract'
      );
    end if;

    if (
      assessment_relationship = 'deeper_explanation'
      and cardinality(pair_evidence.matched_core_concept_keys) <
        assessment_contract.minimum_deeper_explanation_core_matches
    ) or (
      assessment_relationship = 'prerequisite'
      and cardinality(
        pair_evidence.matched_source_prerequisite_candidate_application_keys
      ) < assessment_contract.minimum_prerequisite_directional_matches
    ) or (
      assessment_relationship = 'practical_application'
      and cardinality(
        pair_evidence.matched_source_application_candidate_prerequisite_keys
      ) < assessment_contract.minimum_practical_application_directional_matches
    ) or (
      assessment_relationship = 'credible_alternative'
      and cardinality(
        pair_evidence.matched_source_counterpoint_candidate_core_keys
      ) < assessment_contract.minimum_credible_alternative_counterpoint_matches
    ) then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'unverifiable',
        'reason', 'relationship_evidence_floor'
      );
    end if;

    for reference_row in
      select
        reference.value,
        reference.ordinality,
        reference.value ->> 'kind' as kind,
        reference.value ->> 'conceptKey' as concept_key
      from jsonb_array_elements(
        p_assessment -> 'evidenceReferences'
      ) with ordinality as reference(value, ordinality)
      order by reference.ordinality
    loop
      if jsonb_typeof(reference_row.value) <> 'object'
        or not (reference_row.value ?& array['kind', 'conceptKey'])
        or (
          select count(*) from jsonb_object_keys(reference_row.value)
        ) <> 2
        or jsonb_typeof(reference_row.value -> 'kind') <> 'string'
        or jsonb_typeof(reference_row.value -> 'conceptKey') <> 'string'
        or coalesce(reference_row.concept_key, '')
          !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      then
        return jsonb_build_object(
          'outcome', 'rejected',
          'failureClass', 'malformed',
          'reason', 'evidence_reference_contract'
        );
      end if;

      reference_is_supported := case
        when assessment_relationship = 'deeper_explanation'
          and reference_row.kind = 'matchedTopicKeys'
          then reference_row.concept_key = any(pair_evidence.matched_topic_keys)
        when assessment_relationship = 'deeper_explanation'
          and reference_row.kind = 'matchedCoreConceptKeys'
          then reference_row.concept_key = any(
            pair_evidence.matched_core_concept_keys
          )
        when assessment_relationship = 'prerequisite'
          and reference_row.kind =
            'matchedSourcePrerequisiteCandidateApplicationKeys'
          then reference_row.concept_key = any(
            pair_evidence.matched_source_prerequisite_candidate_application_keys
          )
        when assessment_relationship = 'practical_application'
          and reference_row.kind =
            'matchedSourceApplicationCandidatePrerequisiteKeys'
          then reference_row.concept_key = any(
            pair_evidence.matched_source_application_candidate_prerequisite_keys
          )
        when assessment_relationship = 'credible_alternative'
          and reference_row.kind =
            'matchedSourceCounterpointCandidateCoreKeys'
          then reference_row.concept_key = any(
            pair_evidence.matched_source_counterpoint_candidate_core_keys
          )
        else false
      end;

      if not coalesce(reference_is_supported, false) then
        return jsonb_build_object(
          'outcome', 'rejected',
          'failureClass', 'unverifiable',
          'reason', 'evidence_reference_unverifiable'
        );
      end if;
    end loop;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'kind', normalized.kind,
          'conceptKey', normalized.concept_key
        ) order by normalized.kind, normalized.concept_key
      ),
      '[]'::jsonb
    ) into normalized_evidence_references
    from (
      select distinct
        reference.value ->> 'kind' as kind,
        reference.value ->> 'conceptKey' as concept_key
      from jsonb_array_elements(
        p_assessment -> 'evidenceReferences'
      ) as reference(value)
    ) as normalized;

    if jsonb_array_length(normalized_evidence_references) <>
      jsonb_array_length(p_assessment -> 'evidenceReferences')
    then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'malformed',
        'reason', 'duplicate_evidence_reference'
      );
    end if;
  end if;

  insert into catalog_private.recommendation_assessments (
    candidate_pair_evidence_id,
    source_profile_id,
    candidate_profile_id,
    source_catalog_admission_id,
    candidate_catalog_admission_id,
    semantic_model_identifier,
    profile_schema_version,
    semantic_prompt_version,
    semantic_evaluation_fingerprint,
    candidate_pair_policy_version,
    source_catalog_admission_policy_version,
    candidate_catalog_admission_policy_version,
    assessment_model_identifier,
    assessment_schema_version,
    assessment_prompt_version,
    relationship_policy_version,
    supported,
    continuation_relationship,
    explanation,
    evidence_references
  ) values (
    pair_evidence.id,
    pair_evidence.source_profile_id,
    pair_evidence.candidate_profile_id,
    pair_evidence.source_catalog_admission_id,
    pair_evidence.candidate_catalog_admission_id,
    pair_evidence.model_identifier,
    pair_evidence.profile_schema_version,
    pair_evidence.prompt_version,
    pair_evidence.evaluation_fingerprint,
    pair_evidence.candidate_pair_policy_version,
    pair_evidence.source_admission_policy_version,
    pair_evidence.candidate_admission_policy_version,
    btrim(p_assessment_model_identifier),
    validated_assessment_schema_version,
    p_assessment_prompt_version,
    p_relationship_policy_version,
    assessment_supported,
    assessment_relationship,
    assessment_explanation,
    normalized_evidence_references
  )
  on conflict (
    source_profile_id,
    candidate_profile_id,
    source_catalog_admission_id,
    candidate_catalog_admission_id,
    semantic_model_identifier,
    profile_schema_version,
    semantic_prompt_version,
    semantic_evaluation_fingerprint,
    candidate_pair_policy_version,
    source_catalog_admission_policy_version,
    candidate_catalog_admission_policy_version,
    assessment_model_identifier,
    assessment_schema_version,
    assessment_prompt_version,
    relationship_policy_version
  ) do nothing
  returning id into assessment_id;

  inserted := assessment_id is not null;
  remembered_supported := assessment_supported;
  if not inserted then
    select assessment.id, assessment.supported
    into assessment_id, remembered_supported
    from catalog_private.recommendation_assessments as assessment
    where assessment.source_profile_id = pair_evidence.source_profile_id
      and assessment.candidate_profile_id = pair_evidence.candidate_profile_id
      and assessment.source_catalog_admission_id =
        pair_evidence.source_catalog_admission_id
      and assessment.candidate_catalog_admission_id =
        pair_evidence.candidate_catalog_admission_id
      and assessment.semantic_model_identifier = pair_evidence.model_identifier
      and assessment.profile_schema_version = pair_evidence.profile_schema_version
      and assessment.semantic_prompt_version = pair_evidence.prompt_version
      and assessment.semantic_evaluation_fingerprint =
        pair_evidence.evaluation_fingerprint
      and assessment.candidate_pair_policy_version =
        pair_evidence.candidate_pair_policy_version
      and assessment.source_catalog_admission_policy_version =
        pair_evidence.source_admission_policy_version
      and assessment.candidate_catalog_admission_policy_version =
        pair_evidence.candidate_admission_policy_version
      and assessment.assessment_model_identifier =
        btrim(p_assessment_model_identifier)
      and assessment.assessment_schema_version =
        validated_assessment_schema_version
      and assessment.assessment_prompt_version = p_assessment_prompt_version
      and assessment.relationship_policy_version = p_relationship_policy_version;
  end if;

  return jsonb_build_object(
    'outcome', case when inserted then 'stored' else 'reused' end,
    'assessmentId', assessment_id,
    'supported', remembered_supported
  );
end;
$$;

create or replace function public.remember_recommendation_assessment(
  p_candidate_pair_evidence_id uuid,
  p_assessment_model_identifier text,
  p_assessment_prompt_version text,
  p_relationship_policy_version text,
  p_assessment jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;

  return catalog_private.remember_recommendation_assessment(
    p_candidate_pair_evidence_id,
    p_assessment_model_identifier,
    p_assessment_prompt_version,
    p_relationship_policy_version,
    p_assessment
  );
end;
$$;

revoke all on function catalog_private.remember_recommendation_assessment(
  uuid, text, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function catalog_private.remember_recommendation_assessment(
  uuid, text, text, text, jsonb
) to service_role;
revoke all on function public.remember_recommendation_assessment(
  uuid, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.remember_recommendation_assessment(
  uuid, text, text, text, jsonb
) to service_role;

notify pgrst, 'reload schema';
