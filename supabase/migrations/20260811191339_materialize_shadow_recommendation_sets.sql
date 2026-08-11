-- Atomically materialize private Shadow Recommendation Sets (Issue #351).
--
-- This is a storage/materialization seam over exact supported Recommendation
-- Assessments. It deliberately adds no queue, worker, Gateway call, reader,
-- rollout state, Recommendation Composition, or learner-facing publication.

create or replace function catalog_private.recommendation_set_policy_fingerprint(
  p_set_policy_version text,
  p_candidate_pair_policy_version text,
  p_relationship_policy_version text,
  p_assessment_schema_version text,
  p_assessment_prompt_version text,
  p_set_schema_version text,
  p_minimum_recommendations integer,
  p_maximum_recommendations integer
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select
    md5(
      'recommendation-set-policy\n'
      || p_set_policy_version || E'\n'
      || p_candidate_pair_policy_version || E'\n'
      || p_relationship_policy_version || E'\n'
      || p_assessment_schema_version || E'\n'
      || p_assessment_prompt_version || E'\n'
      || p_set_schema_version || E'\n'
      || p_minimum_recommendations::text || E'\n'
      || p_maximum_recommendations::text
    )
    || md5(
      'recommendation-set-policy-secondary\n'
      || p_set_policy_version || E'\n'
      || p_candidate_pair_policy_version || E'\n'
      || p_relationship_policy_version || E'\n'
      || p_assessment_schema_version || E'\n'
      || p_assessment_prompt_version || E'\n'
      || p_set_schema_version || E'\n'
      || p_minimum_recommendations::text || E'\n'
      || p_maximum_recommendations::text
    );
$$;

create or replace function catalog_private.recommendation_set_build_fingerprint(
  p_source_profile_id uuid,
  p_set_policy_fingerprint text,
  p_ordered_assessment_ids uuid[]
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select
    md5(
      'shadow-recommendation-set-v1\n'
      || p_source_profile_id::text || E'\n'
      || p_set_policy_fingerprint || E'\n'
      || array_to_string(p_ordered_assessment_ids, ',')
    )
    || md5(
      'shadow-recommendation-set-v1-secondary\n'
      || p_source_profile_id::text || E'\n'
      || p_set_policy_fingerprint || E'\n'
      || array_to_string(p_ordered_assessment_ids, ',')
    );
$$;

create table catalog_private.recommendation_set_policies (
  set_policy_version text primary key check (
    set_policy_version ~ '^shadow-recommendation-set-policy-v[1-9][0-9]*$'
  ),
  set_policy_fingerprint text not null unique check (
    set_policy_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  candidate_pair_policy_version text not null references
    catalog_private.recommendation_candidate_pair_policies(policy_version)
    on delete restrict,
  relationship_policy_version text not null references
    catalog_private.recommendation_assessment_contracts(
      relationship_policy_version
    ) on delete restrict,
  assessment_schema_version text not null check (
    assessment_schema_version = 'recommendation-assessment-v1'
  ),
  assessment_prompt_version text not null check (
    assessment_prompt_version = 'recommendation-assessment-prompt-v1'
  ),
  set_schema_version text not null check (
    set_schema_version = 'shadow-recommendation-set-v1'
  ),
  minimum_recommendations integer not null check (
    minimum_recommendations between 1 and 50
  ),
  maximum_recommendations integer not null check (
    maximum_recommendations between minimum_recommendations and 50
  ),
  status text not null check (status in ('active', 'retired')),
  created_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  check (
    set_policy_fingerprint =
      catalog_private.recommendation_set_policy_fingerprint(
        set_policy_version,
        candidate_pair_policy_version,
        relationship_policy_version,
        assessment_schema_version,
        assessment_prompt_version,
        set_schema_version,
        minimum_recommendations,
        maximum_recommendations
      )
  ),
  check (
    (status = 'active' and retired_at is null)
    or (status = 'retired' and retired_at is not null)
  )
);

create unique index recommendation_set_one_active_policy_idx
  on catalog_private.recommendation_set_policies (
    candidate_pair_policy_version,
    relationship_policy_version,
    assessment_schema_version,
    assessment_prompt_version,
    set_schema_version
  )
  where status = 'active';

insert into catalog_private.recommendation_set_policies (
  set_policy_version,
  set_policy_fingerprint,
  candidate_pair_policy_version,
  relationship_policy_version,
  assessment_schema_version,
  assessment_prompt_version,
  set_schema_version,
  minimum_recommendations,
  maximum_recommendations,
  status
) values (
  'shadow-recommendation-set-policy-v1',
  catalog_private.recommendation_set_policy_fingerprint(
    'shadow-recommendation-set-policy-v1',
    'candidate-pair-policy-v1',
    'continuation-relationship-policy-v1',
    'recommendation-assessment-v1',
    'recommendation-assessment-prompt-v1',
    'shadow-recommendation-set-v1',
    1,
    12
  ),
  'candidate-pair-policy-v1',
  'continuation-relationship-policy-v1',
  'recommendation-assessment-v1',
  'recommendation-assessment-prompt-v1',
  'shadow-recommendation-set-v1',
  1,
  12,
  'active'
);

create table catalog_private.recommendation_sets (
  id uuid primary key default gen_random_uuid(),
  source_video_id uuid not null references public.videos(id) on delete restrict,
  source_profile_id uuid not null references
    catalog_private.semantic_profile_versions(id) on delete restrict,
  source_catalog_admission_id uuid not null references
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
    catalog_private.recommendation_assessment_contracts(
      relationship_policy_version
    ) on delete restrict,
  set_policy_version text not null references
    catalog_private.recommendation_set_policies(set_policy_version)
    on delete restrict,
  set_policy_fingerprint text not null references
    catalog_private.recommendation_set_policies(set_policy_fingerprint)
    on delete restrict check (set_policy_fingerprint ~ '^[a-f0-9]{64}$'),
  set_schema_version text not null check (
    set_schema_version = 'shadow-recommendation-set-v1'
  ),
  build_fingerprint text not null check (
    build_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  status text not null check (status in ('building', 'current', 'superseded')),
  item_count integer not null check (item_count between 1 and 50),
  created_at timestamptz not null default clock_timestamp(),
  published_at timestamptz,
  superseded_at timestamptz,
  superseded_by_set_id uuid,
  unique (source_profile_id, set_policy_fingerprint, build_fingerprint),
  check (
    (
      status = 'building'
      and published_at is null
      and superseded_at is null
      and superseded_by_set_id is null
    )
    or (
      status = 'current'
      and published_at is not null
      and superseded_at is null
      and superseded_by_set_id is null
    )
    or (
      status = 'superseded'
      and published_at is not null
      and superseded_at is not null
      and superseded_by_set_id is not null
      and superseded_by_set_id <> id
    )
  )
);

alter table catalog_private.recommendation_sets
  add constraint recommendation_sets_superseded_by_fkey
  foreign key (superseded_by_set_id)
  references catalog_private.recommendation_sets(id)
  on delete restrict;

create unique index recommendation_set_one_current_source_idx
  on catalog_private.recommendation_sets (source_video_id)
  where status = 'current';
create index recommendation_set_source_profile_idx
  on catalog_private.recommendation_sets (source_profile_id, created_at desc);
create index recommendation_set_policy_idx
  on catalog_private.recommendation_sets (
    set_policy_fingerprint,
    created_at desc
  );

create table catalog_private.recommendations (
  recommendation_set_id uuid not null references
    catalog_private.recommendation_sets(id) on delete restrict,
  ordinal integer not null check (ordinal between 1 and 50),
  recommendation_assessment_id uuid not null references
    catalog_private.recommendation_assessments(id) on delete restrict,
  candidate_pair_evidence_id uuid not null references
    catalog_private.recommendation_candidate_pair_evidence(id)
    on delete restrict,
  candidate_video_id uuid not null references public.videos(id) on delete restrict,
  candidate_profile_id uuid not null references
    catalog_private.semantic_profile_versions(id) on delete restrict,
  candidate_catalog_admission_id uuid not null references
    catalog_private.catalog_admissions(id) on delete restrict,
  continuation_relationship text not null check (
    continuation_relationship in (
      'deeper_explanation',
      'prerequisite',
      'practical_application',
      'credible_alternative'
    )
  ),
  explanation text not null check (
    btrim(explanation) <> ''
    and explanation = btrim(explanation)
    and char_length(explanation) <= 500
    and explanation !~ '[[:cntrl:]]'
  ),
  evidence_references jsonb not null check (
    jsonb_typeof(evidence_references) = 'array'
    and jsonb_array_length(evidence_references) between 1 and 16
  ),
  created_at timestamptz not null default clock_timestamp(),
  primary key (recommendation_set_id, ordinal),
  unique (recommendation_set_id, recommendation_assessment_id),
  unique (recommendation_set_id, candidate_video_id)
);

create index recommendation_candidate_video_idx
  on catalog_private.recommendations (candidate_video_id);
create index recommendation_assessment_idx
  on catalog_private.recommendations (recommendation_assessment_id);

alter table catalog_private.recommendation_set_policies
  enable row level security;
alter table catalog_private.recommendation_sets enable row level security;
alter table catalog_private.recommendations enable row level security;

revoke all on table catalog_private.recommendation_set_policies
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.recommendation_sets
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.recommendations
  from public, anon, authenticated, service_role;

create or replace function catalog_private.publish_shadow_recommendation_set(
  p_source_profile_id uuid,
  p_set_policy_fingerprint text,
  p_ordered_assessment_ids uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  set_policy record;
  source_state record;
  input_row record;
  assessment_state record;
  input_count integer;
  distinct_input_count integer;
  candidate_video_ids uuid[] := array[]::uuid[];
  set_assessment_model_identifier text;
  set_source_catalog_admission_policy_version text;
  set_build_fingerprint text;
  existing_set record;
  previous_current_set_id uuid;
  new_set_id uuid;
  inserted_item_count integer;
  publication_time timestamptz;
begin
  if p_source_profile_id is null
    or coalesce(p_set_policy_fingerprint, '') !~ '^[a-f0-9]{64}$'
    or p_set_policy_fingerprint <> btrim(p_set_policy_fingerprint)
    or p_ordered_assessment_ids is null
    or coalesce(array_ndims(p_ordered_assessment_ids), 0) <> 1
    or array_position(p_ordered_assessment_ids, null::uuid) is not null
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'recommendation_set_contract'
    );
  end if;

  -- Share the Issue #349 activation lock so retirement cannot race a valid
  -- check into publishing a Set for a no-longer-approved semantic tuple.
  perform pg_advisory_xact_lock_shared(hashtext('semantic-profile-activation'));

  select
    policy.*,
    pair_policy.profile_schema_version as pair_profile_schema_version,
    pair_policy.prompt_version as pair_prompt_version,
    pair_policy.candidate_limit,
    pair_policy.status as candidate_pair_policy_status,
    assessment_contract.status as assessment_contract_status
  into set_policy
  from catalog_private.recommendation_set_policies as policy
  join catalog_private.recommendation_candidate_pair_policies as pair_policy
    on pair_policy.policy_version = policy.candidate_pair_policy_version
  join catalog_private.recommendation_assessment_contracts as assessment_contract
    on assessment_contract.relationship_policy_version =
      policy.relationship_policy_version
   and assessment_contract.candidate_pair_policy_version =
      policy.candidate_pair_policy_version
   and assessment_contract.assessment_schema_version =
      policy.assessment_schema_version
   and assessment_contract.assessment_prompt_version =
      policy.assessment_prompt_version
  where policy.set_policy_fingerprint = p_set_policy_fingerprint
    and policy.status = 'active'
    and pair_policy.status = 'active'
    and assessment_contract.status = 'active'
  for share of policy, pair_policy, assessment_contract;

  if set_policy.set_policy_version is null then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unverifiable',
      'reason', 'recommendation_set_policy_inactive'
    );
  end if;

  input_count := cardinality(p_ordered_assessment_ids);
  if input_count < set_policy.minimum_recommendations
    or input_count > set_policy.maximum_recommendations
    or set_policy.maximum_recommendations > set_policy.candidate_limit
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'recommendation_set_size'
    );
  end if;

  select count(distinct input.assessment_id)
  into distinct_input_count
  from unnest(p_ordered_assessment_ids) as input(assessment_id);
  if distinct_input_count <> input_count then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'duplicate_assessment_input'
    );
  end if;

  select
    source_profile.id as source_profile_id,
    source_profile.video_id as source_video_id,
    source_profile.status as source_profile_status,
    source_profile.generator_model as semantic_model_identifier,
    source_profile.profile_schema_version,
    source_profile.prompt_version as semantic_prompt_version,
    source_profile.evaluation_fingerprint as semantic_evaluation_fingerprint,
    source_video.catalog_state,
    source_video.catalog_inactive_reason,
    source_video.privacy_status,
    source_video.embeddable,
    source_video.live_status,
    source_video.age_restricted,
    source_video.provider_evidence_path as video_provider_path,
    source_video.provider_verified_at as video_provider_verified_at,
    source_video.provider_evidence_expires_at as video_evidence_expires_at,
    source_admission.id as source_catalog_admission_id,
    source_admission.policy_version as source_admission_policy_version,
    source_admission.decision as source_admission_decision,
    source_admission.reason_code as source_admission_reason_code,
    source_provider_evidence.provider_outcome,
    source_provider_evidence.provider_path,
    source_provider_evidence.provider_verified_at,
    source_provider_evidence.evidence_expires_at
  into source_state
  from catalog_private.semantic_profile_versions as source_profile
  join public.videos as source_video
    on source_video.id = source_profile.video_id
  join lateral (
    select latest_source_admission.id
    from catalog_private.catalog_admissions as latest_source_admission
    where latest_source_admission.video_id = source_profile.video_id
    order by
      latest_source_admission.decided_at desc,
      latest_source_admission.id desc
    limit 1
  ) as latest_source_admission on true
  join catalog_private.catalog_admissions as source_admission
    on source_admission.id = latest_source_admission.id
  join catalog_private.youtube_provider_evidence as source_provider_evidence
    on source_provider_evidence.id = source_admission.provider_evidence_id
   and source_provider_evidence.video_id = source_admission.video_id
  where source_profile.id = p_source_profile_id
  for share of
    source_profile,
    source_video,
    source_admission,
    source_provider_evidence;

  if source_state.source_profile_id is null
    or source_state.source_profile_status <> 'active'
    or source_state.profile_schema_version is distinct from
      set_policy.pair_profile_schema_version
    or source_state.semantic_prompt_version is distinct from
      set_policy.pair_prompt_version
    or not catalog_private.semantic_profile_activation_is_available(
      source_state.semantic_model_identifier,
      source_state.profile_schema_version,
      source_state.semantic_prompt_version,
      source_state.semantic_evaluation_fingerprint
    )
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unverifiable',
      'reason', 'semantic_profile_tuple_inactive'
    );
  end if;

  if source_state.source_admission_decision <> 'admitted'
    or source_state.source_admission_reason_code is not null
    or source_state.provider_outcome <> 'verified'
    or source_state.provider_path <> 'youtube_data_api_v3_videos_list'
    or source_state.provider_verified_at >
      statement_timestamp() + interval '5 minutes'
    or source_state.evidence_expires_at <= statement_timestamp()
    or source_state.catalog_state <> 'active'
    or source_state.catalog_inactive_reason is not null
    or source_state.privacy_status is distinct from 'public'
    or source_state.embeddable is not true
    or source_state.live_status is distinct from 'none'
    or source_state.age_restricted is not false
    or source_state.video_provider_path is distinct from
      source_state.provider_path
    or source_state.video_provider_verified_at is distinct from
      source_state.provider_verified_at
    or source_state.video_evidence_expires_at is distinct from
      source_state.evidence_expires_at
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unverifiable',
      'reason', 'recommendation_source_ineligible'
    );
  end if;

  -- Serialize replacement per Recommendation Source while leaving unrelated
  -- sources independent. This lock is separate from the global model gate.
  perform pg_advisory_xact_lock(
    hashtext('shadow-recommendation-set'),
    hashtext(source_state.source_video_id::text)
  );

  for input_row in
    select input.assessment_id, input.ordinality::integer as ordinal
    from unnest(p_ordered_assessment_ids)
      with ordinality as input(assessment_id, ordinality)
    order by input.ordinality
  loop
    assessment_state := null;
    select
      assessment.*,
      pair.source_profile_id as pair_source_profile_id,
      pair.candidate_profile_id as pair_candidate_profile_id,
      pair.source_catalog_admission_id as pair_source_admission_id,
      pair.candidate_catalog_admission_id as pair_candidate_admission_id,
      pair.model_identifier as pair_semantic_model_identifier,
      pair.profile_schema_version as pair_profile_schema_version,
      pair.prompt_version as pair_semantic_prompt_version,
      pair.evaluation_fingerprint as pair_semantic_evaluation_fingerprint,
      pair.candidate_pair_policy_version as pair_policy_version,
      pair_policy.status as candidate_pair_policy_status,
      assessment_contract.status as assessment_contract_status,
      candidate_profile.video_id as candidate_video_id,
      candidate_profile.status as candidate_profile_status,
      candidate_profile.generator_model as candidate_semantic_model_identifier,
      candidate_profile.profile_schema_version as candidate_profile_schema_version,
      candidate_profile.prompt_version as candidate_semantic_prompt_version,
      candidate_profile.evaluation_fingerprint as
        candidate_semantic_evaluation_fingerprint,
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
      candidate_provider_evidence.provider_outcome as candidate_provider_outcome,
      candidate_provider_evidence.provider_path as candidate_provider_path,
      candidate_provider_evidence.provider_verified_at as
        candidate_provider_verified_at,
      candidate_provider_evidence.evidence_expires_at as
        candidate_evidence_expires_at,
      candidate_video.catalog_state as candidate_catalog_state,
      candidate_video.catalog_inactive_reason as candidate_catalog_inactive_reason,
      candidate_video.privacy_status as candidate_privacy_status,
      candidate_video.embeddable as candidate_embeddable,
      candidate_video.live_status as candidate_live_status,
      candidate_video.age_restricted as candidate_age_restricted,
      candidate_video.provider_evidence_path as candidate_video_provider_path,
      candidate_video.provider_verified_at as candidate_video_provider_verified_at,
      candidate_video.provider_evidence_expires_at as
        candidate_video_evidence_expires_at
    into assessment_state
    from catalog_private.recommendation_assessments as assessment
    join catalog_private.recommendation_candidate_pair_evidence as pair
      on pair.id = assessment.candidate_pair_evidence_id
    join catalog_private.recommendation_candidate_pair_policies as pair_policy
      on pair_policy.policy_version = pair.candidate_pair_policy_version
    join catalog_private.recommendation_assessment_contracts as assessment_contract
      on assessment_contract.relationship_policy_version =
        assessment.relationship_policy_version
    join catalog_private.semantic_profile_versions as candidate_profile
      on candidate_profile.id = assessment.candidate_profile_id
    join catalog_private.catalog_admissions as candidate_admission
      on candidate_admission.id = assessment.candidate_catalog_admission_id
     and candidate_admission.video_id = candidate_profile.video_id
    join catalog_private.youtube_provider_evidence as candidate_provider_evidence
      on candidate_provider_evidence.id = candidate_admission.provider_evidence_id
     and candidate_provider_evidence.video_id = candidate_admission.video_id
    join public.videos as candidate_video
      on candidate_video.id = candidate_profile.video_id
    where assessment.id = input_row.assessment_id
    for share of
      assessment,
      pair,
      pair_policy,
      assessment_contract,
      candidate_profile,
      candidate_admission,
      candidate_provider_evidence,
      candidate_video;

    if assessment_state.id is null then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'unverifiable',
        'reason', 'recommendation_assessment_missing'
      );
    end if;

    if assessment_state.supported is not true
      or assessment_state.continuation_relationship is null
      or assessment_state.explanation is null
      or jsonb_array_length(assessment_state.evidence_references) = 0
    then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'unverifiable',
        'reason', 'recommendation_assessment_unsupported'
      );
    end if;

    if assessment_state.source_profile_id <> source_state.source_profile_id
      or assessment_state.source_catalog_admission_id <>
        source_state.source_catalog_admission_id
      or assessment_state.source_catalog_admission_policy_version <>
        source_state.source_admission_policy_version
      or assessment_state.semantic_model_identifier <>
        source_state.semantic_model_identifier
      or assessment_state.profile_schema_version <>
        source_state.profile_schema_version
      or assessment_state.semantic_prompt_version <>
        source_state.semantic_prompt_version
      or assessment_state.semantic_evaluation_fingerprint <>
        source_state.semantic_evaluation_fingerprint
      or assessment_state.candidate_pair_policy_version <>
        set_policy.candidate_pair_policy_version
      or assessment_state.relationship_policy_version <>
        set_policy.relationship_policy_version
      or assessment_state.assessment_schema_version <>
        set_policy.assessment_schema_version
      or assessment_state.assessment_prompt_version <>
        set_policy.assessment_prompt_version
      or assessment_state.pair_source_profile_id <>
        assessment_state.source_profile_id
      or assessment_state.pair_candidate_profile_id <>
        assessment_state.candidate_profile_id
      or assessment_state.pair_source_admission_id <>
        assessment_state.source_catalog_admission_id
      or assessment_state.pair_candidate_admission_id <>
        assessment_state.candidate_catalog_admission_id
      or assessment_state.pair_semantic_model_identifier <>
        assessment_state.semantic_model_identifier
      or assessment_state.pair_profile_schema_version <>
        assessment_state.profile_schema_version
      or assessment_state.pair_semantic_prompt_version <>
        assessment_state.semantic_prompt_version
      or assessment_state.pair_semantic_evaluation_fingerprint <>
        assessment_state.semantic_evaluation_fingerprint
      or assessment_state.pair_policy_version <>
        assessment_state.candidate_pair_policy_version
      or assessment_state.candidate_pair_policy_status <> 'active'
      or assessment_state.assessment_contract_status <> 'active'
      or assessment_state.candidate_profile_status <> 'active'
      or assessment_state.candidate_semantic_model_identifier <>
        assessment_state.semantic_model_identifier
      or assessment_state.candidate_profile_schema_version <>
        assessment_state.profile_schema_version
      or assessment_state.candidate_semantic_prompt_version <>
        assessment_state.semantic_prompt_version
      or assessment_state.candidate_semantic_evaluation_fingerprint <>
        assessment_state.semantic_evaluation_fingerprint
    then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'unverifiable',
        'reason', 'recommendation_assessment_tuple_mismatch'
      );
    end if;

    if assessment_state.candidate_admission_decision <> 'admitted'
      or assessment_state.candidate_admission_reason_code is not null
      or assessment_state.candidate_admission_is_latest is not true
      or assessment_state.candidate_provider_outcome <> 'verified'
      or assessment_state.candidate_provider_path <>
        'youtube_data_api_v3_videos_list'
      or assessment_state.candidate_provider_verified_at >
        statement_timestamp() + interval '5 minutes'
      or assessment_state.candidate_evidence_expires_at <= statement_timestamp()
      or assessment_state.candidate_catalog_state <> 'active'
      or assessment_state.candidate_catalog_inactive_reason is not null
      or assessment_state.candidate_privacy_status is distinct from 'public'
      or assessment_state.candidate_embeddable is not true
      or assessment_state.candidate_live_status is distinct from 'none'
      or assessment_state.candidate_age_restricted is not false
      or assessment_state.candidate_video_provider_path is distinct from
        assessment_state.candidate_provider_path
      or assessment_state.candidate_video_provider_verified_at is distinct from
        assessment_state.candidate_provider_verified_at
      or assessment_state.candidate_video_evidence_expires_at is distinct from
        assessment_state.candidate_evidence_expires_at
    then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'unverifiable',
        'reason', 'recommendation_assessment_ineligible'
      );
    end if;

    if assessment_state.candidate_video_id = source_state.source_video_id
      or assessment_state.candidate_video_id = any(candidate_video_ids)
    then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'malformed',
        'reason', 'duplicate_recommendation_candidate'
      );
    end if;
    candidate_video_ids := array_append(
      candidate_video_ids,
      assessment_state.candidate_video_id
    );

    if set_assessment_model_identifier is null then
      set_assessment_model_identifier :=
        assessment_state.assessment_model_identifier;
      set_source_catalog_admission_policy_version :=
        assessment_state.source_catalog_admission_policy_version;
    elsif set_assessment_model_identifier <>
        assessment_state.assessment_model_identifier
      or set_source_catalog_admission_policy_version <>
        assessment_state.source_catalog_admission_policy_version
    then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'unverifiable',
        'reason', 'recommendation_assessment_configuration_mismatch'
      );
    end if;
  end loop;

  set_build_fingerprint :=
    catalog_private.recommendation_set_build_fingerprint(
      p_source_profile_id,
      p_set_policy_fingerprint,
      p_ordered_assessment_ids
    );

  select recommendation_set.id,
         recommendation_set.status,
         recommendation_set.item_count
  into existing_set
  from catalog_private.recommendation_sets as recommendation_set
  where recommendation_set.source_profile_id = p_source_profile_id
    and recommendation_set.set_policy_fingerprint = p_set_policy_fingerprint
    and recommendation_set.build_fingerprint = set_build_fingerprint;

  if existing_set.id is not null then
    if existing_set.status not in ('current', 'superseded') then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'unverifiable',
        'reason', 'recommendation_set_incomplete'
      );
    end if;
    return jsonb_build_object(
      'outcome', 'reused',
      'recommendationSetId', existing_set.id,
      'itemCount', existing_set.item_count,
      'status', existing_set.status
    );
  end if;

  insert into catalog_private.recommendation_sets (
    source_video_id,
    source_profile_id,
    source_catalog_admission_id,
    semantic_model_identifier,
    profile_schema_version,
    semantic_prompt_version,
    semantic_evaluation_fingerprint,
    candidate_pair_policy_version,
    source_catalog_admission_policy_version,
    assessment_model_identifier,
    assessment_schema_version,
    assessment_prompt_version,
    relationship_policy_version,
    set_policy_version,
    set_policy_fingerprint,
    set_schema_version,
    build_fingerprint,
    status,
    item_count
  ) values (
    source_state.source_video_id,
    source_state.source_profile_id,
    source_state.source_catalog_admission_id,
    source_state.semantic_model_identifier,
    source_state.profile_schema_version,
    source_state.semantic_prompt_version,
    source_state.semantic_evaluation_fingerprint,
    set_policy.candidate_pair_policy_version,
    set_source_catalog_admission_policy_version,
    set_assessment_model_identifier,
    set_policy.assessment_schema_version,
    set_policy.assessment_prompt_version,
    set_policy.relationship_policy_version,
    set_policy.set_policy_version,
    set_policy.set_policy_fingerprint,
    set_policy.set_schema_version,
    set_build_fingerprint,
    'building',
    input_count
  )
  returning id into new_set_id;

  insert into catalog_private.recommendations (
    recommendation_set_id,
    ordinal,
    recommendation_assessment_id,
    candidate_pair_evidence_id,
    candidate_video_id,
    candidate_profile_id,
    candidate_catalog_admission_id,
    continuation_relationship,
    explanation,
    evidence_references
  )
  select
    new_set_id,
    input.ordinality::integer,
    assessment.id,
    assessment.candidate_pair_evidence_id,
    candidate_profile.video_id,
    assessment.candidate_profile_id,
    assessment.candidate_catalog_admission_id,
    assessment.continuation_relationship,
    assessment.explanation,
    assessment.evidence_references
  from unnest(p_ordered_assessment_ids)
    with ordinality as input(assessment_id, ordinality)
  join catalog_private.recommendation_assessments as assessment
    on assessment.id = input.assessment_id
  join catalog_private.semantic_profile_versions as candidate_profile
    on candidate_profile.id = assessment.candidate_profile_id
  order by input.ordinality;

  get diagnostics inserted_item_count = row_count;
  if inserted_item_count <> input_count then
    raise exception 'Recommendation Set item insertion was incomplete';
  end if;

  select recommendation_set.id into previous_current_set_id
  from catalog_private.recommendation_sets as recommendation_set
  where recommendation_set.source_video_id = source_state.source_video_id
    and recommendation_set.status = 'current'
  for update;

  publication_time := clock_timestamp();
  if previous_current_set_id is not null then
    update catalog_private.recommendation_sets
    set status = 'superseded',
        superseded_at = publication_time,
        superseded_by_set_id = new_set_id
    where id = previous_current_set_id;
  end if;

  update catalog_private.recommendation_sets
  set status = 'current', published_at = publication_time
  where id = new_set_id;

  return jsonb_build_object(
    'outcome', 'published',
    'recommendationSetId', new_set_id,
    'itemCount', input_count,
    'status', 'current'
  );
end;
$$;

create or replace function public.publish_shadow_recommendation_set(
  p_source_profile_id uuid,
  p_set_policy_fingerprint text,
  p_ordered_assessment_ids uuid[]
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

  return catalog_private.publish_shadow_recommendation_set(
    p_source_profile_id,
    p_set_policy_fingerprint,
    p_ordered_assessment_ids
  );
end;
$$;

revoke all on function
  catalog_private.recommendation_set_policy_fingerprint(
    text, text, text, text, text, text, integer, integer
  ) from public, anon, authenticated, service_role;
revoke all on function
  catalog_private.recommendation_set_build_fingerprint(uuid, text, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function
  catalog_private.publish_shadow_recommendation_set(uuid, text, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function
  catalog_private.publish_shadow_recommendation_set(uuid, text, uuid[])
  to service_role;
revoke all on function
  public.publish_shadow_recommendation_set(uuid, text, uuid[])
  from public, anon, authenticated;
grant execute on function
  public.publish_shadow_recommendation_set(uuid, text, uuid[])
  to service_role;

notify pgrst, 'reload schema';
