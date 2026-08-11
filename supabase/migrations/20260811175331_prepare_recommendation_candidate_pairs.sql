-- Prepare versioned Recommendation Candidate pair evidence and aggregate
-- learner-unlinked Discovery Demand (Issue #350).
--
-- This slice is dormant while Issue #349 has no evaluated and human-approved
-- active Semantic Profile tuple. It adds no learner-facing caller and makes no
-- network call. All durable state remains in the unexposed catalog schema.

create table catalog_private.recommendation_candidate_pair_policies (
  policy_version text primary key check (
    policy_version ~ '^candidate-pair-policy-v[1-9][0-9]*$'
  ),
  profile_schema_version text not null check (
    profile_schema_version = 'semantic-profile-v1'
  ),
  prompt_version text not null check (
    prompt_version = 'semantic-profile-prompt-v1'
  ),
  candidate_limit integer not null check (candidate_limit between 1 and 50),
  minimum_relationship_score integer not null check (
    minimum_relationship_score between 1 and 1000
  ),
  minimum_coverage integer not null check (
    minimum_coverage between 1 and candidate_limit
  ),
  status text not null check (status in ('active', 'retired')),
  created_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  check (
    (status = 'active' and retired_at is null)
    or (status = 'retired' and retired_at is not null)
  )
);

create unique index recommendation_candidate_pair_one_active_policy_idx
  on catalog_private.recommendation_candidate_pair_policies (
    profile_schema_version,
    prompt_version
  )
  where status = 'active';

insert into catalog_private.recommendation_candidate_pair_policies (
  policy_version,
  profile_schema_version,
  prompt_version,
  candidate_limit,
  minimum_relationship_score,
  minimum_coverage,
  status
) values (
  'candidate-pair-policy-v1',
  'semantic-profile-v1',
  'semantic-profile-prompt-v1',
  12,
  5,
  4,
  'active'
);

create table catalog_private.recommendation_candidate_pair_evidence (
  id uuid primary key default gen_random_uuid(),
  source_profile_id uuid not null references
    catalog_private.semantic_profile_versions(id) on delete restrict,
  candidate_profile_id uuid not null references
    catalog_private.semantic_profile_versions(id) on delete restrict,
  source_catalog_admission_id uuid not null references
    catalog_private.catalog_admissions(id) on delete restrict,
  candidate_catalog_admission_id uuid not null references
    catalog_private.catalog_admissions(id) on delete restrict,
  model_identifier text not null check (
    btrim(model_identifier) <> '' and model_identifier = btrim(model_identifier)
  ),
  profile_schema_version text not null check (
    profile_schema_version = 'semantic-profile-v1'
  ),
  prompt_version text not null check (
    prompt_version = 'semantic-profile-prompt-v1'
  ),
  evaluation_fingerprint text not null references
    catalog_private.semantic_profile_evaluations(evaluation_fingerprint)
    on delete restrict check (evaluation_fingerprint ~ '^[a-f0-9]{64}$'),
  candidate_pair_policy_version text not null references
    catalog_private.recommendation_candidate_pair_policies(policy_version)
    on delete restrict,
  evidence_level text not null check (evidence_level = 'semantic-profile-v1'),
  relationship_score integer not null check (relationship_score > 0),
  matched_topic_keys text[] not null default '{}',
  matched_core_concept_keys text[] not null default '{}',
  matched_source_application_candidate_prerequisite_keys text[] not null default '{}',
  matched_source_prerequisite_candidate_application_keys text[] not null default '{}',
  matched_source_counterpoint_candidate_core_keys text[] not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  check (source_profile_id <> candidate_profile_id),
  check (
    relationship_score =
      cardinality(matched_topic_keys) * 3
      + cardinality(matched_core_concept_keys) * 5
      + cardinality(matched_source_application_candidate_prerequisite_keys) * 2
      + cardinality(matched_source_prerequisite_candidate_application_keys) * 2
      + cardinality(matched_source_counterpoint_candidate_core_keys)
  ),
  unique (
    source_profile_id,
    candidate_profile_id,
    source_catalog_admission_id,
    candidate_catalog_admission_id,
    model_identifier,
    profile_schema_version,
    prompt_version,
    evaluation_fingerprint,
    candidate_pair_policy_version
  )
);

create index recommendation_candidate_pair_source_score_idx
  on catalog_private.recommendation_candidate_pair_evidence (
    source_profile_id,
    candidate_pair_policy_version,
    relationship_score desc,
    candidate_profile_id
  );
create index recommendation_candidate_pair_candidate_profile_idx
  on catalog_private.recommendation_candidate_pair_evidence (candidate_profile_id);
create index recommendation_candidate_pair_source_admission_idx
  on catalog_private.recommendation_candidate_pair_evidence (source_catalog_admission_id);
create index recommendation_candidate_pair_candidate_admission_idx
  on catalog_private.recommendation_candidate_pair_evidence (candidate_catalog_admission_id);
create index recommendation_candidate_pair_policy_idx
  on catalog_private.recommendation_candidate_pair_evidence (
    candidate_pair_policy_version
  );
create index recommendation_candidate_pair_evaluation_idx
  on catalog_private.recommendation_candidate_pair_evidence (
    evaluation_fingerprint
  );

create table catalog_private.discovery_demand (
  topic_key text not null check (
    topic_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  language_bucket text not null check (
    language_bucket ~ '^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$'
  ),
  candidate_pair_policy_version text not null references
    catalog_private.recommendation_candidate_pair_policies(policy_version)
    on delete restrict,
  observation_count bigint not null default 1 check (observation_count > 0),
  first_observed_at timestamptz not null default clock_timestamp(),
  last_observed_at timestamptz not null default clock_timestamp(),
  primary key (topic_key, language_bucket, candidate_pair_policy_version),
  check (last_observed_at >= first_observed_at)
);

create index discovery_demand_recency_idx
  on catalog_private.discovery_demand (last_observed_at desc);
create index discovery_demand_policy_idx
  on catalog_private.discovery_demand (candidate_pair_policy_version);

alter table catalog_private.recommendation_candidate_pair_policies
  enable row level security;
alter table catalog_private.recommendation_candidate_pair_evidence
  enable row level security;
alter table catalog_private.discovery_demand enable row level security;

revoke all on table catalog_private.recommendation_candidate_pair_policies
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.recommendation_candidate_pair_evidence
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.discovery_demand
  from public, anon, authenticated, service_role;

create or replace function catalog_private.prepare_recommendation_candidate_pairs(
  p_source_video_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  active_model record;
  active_policy catalog_private.recommendation_candidate_pair_policies%rowtype;
  source_evidence record;
  candidate_rows jsonb := '[]'::jsonb;
  candidates jsonb := '[]'::jsonb;
  pair_count integer := 0;
  demand_bucket_count integer := 0;
begin
  if p_source_video_id is null then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'source_ineligible');
  end if;

  -- Use the Issue #349 activation lock so retirement cannot race this
  -- preparation into observing a torn or already-retired model tuple.
  perform pg_advisory_xact_lock_shared(hashtext('semantic-profile-activation'));

  select policy.* into active_policy
  from catalog_private.recommendation_candidate_pair_policies as policy
  where policy.status = 'active'
    and policy.profile_schema_version = 'semantic-profile-v1'
    and policy.prompt_version = 'semantic-profile-prompt-v1'
  limit 1;

  if active_policy.policy_version is null then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'policy_inactive');
  end if;

  select
    registry.model_identifier,
    registry.profile_schema_version,
    registry.prompt_version,
    registry.evaluation_fingerprint
  into active_model
  from catalog_private.semantic_profile_model_registry as registry
  join catalog_private.semantic_profile_evaluations as evaluation
    on evaluation.evaluation_fingerprint = registry.evaluation_fingerprint
   and evaluation.model_identifier = registry.model_identifier
   and evaluation.profile_schema_version = registry.profile_schema_version
   and evaluation.prompt_version = registry.prompt_version
   and evaluation.status = 'passed'
  join catalog_private.semantic_profile_human_approvals as approval
    on approval.approval_ref = registry.human_approval_ref
   and approval.evaluation_fingerprint = registry.evaluation_fingerprint
   and approval.model_identifier = registry.model_identifier
   and approval.profile_schema_version = registry.profile_schema_version
   and approval.prompt_version = registry.prompt_version
   and approval.decision = 'approved'
  where registry.status = 'active'
    and registry.profile_schema_version = active_policy.profile_schema_version
    and registry.prompt_version = active_policy.prompt_version
  limit 1;

  if active_model.model_identifier is null then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'model_inactive');
  end if;

  select
    profile.id as profile_id,
    admission.id as catalog_admission_id,
    profile.source_language,
    profile.topic_keys,
    profile.core_concept_keys,
    profile.prerequisite_concept_keys,
    profile.application_concept_keys,
    profile.counterpoint_concept_keys
  into source_evidence
  from catalog_private.semantic_profile_versions as profile
  join public.videos as video on video.id = profile.video_id
  join lateral (
    select candidate_admission.id,
           candidate_admission.decision,
           candidate_admission.reason_code,
           provider_evidence.provider_outcome,
           provider_evidence.provider_path,
           provider_evidence.provider_verified_at,
           provider_evidence.evidence_expires_at
    from catalog_private.catalog_admissions as candidate_admission
    join catalog_private.youtube_provider_evidence as provider_evidence
      on provider_evidence.id = candidate_admission.provider_evidence_id
     and provider_evidence.video_id = candidate_admission.video_id
    where candidate_admission.video_id = video.id
    order by candidate_admission.decided_at desc, candidate_admission.id desc
    limit 1
  ) as admission on true
  where profile.video_id = p_source_video_id
    and profile.status = 'active'
    and profile.generator_model = active_model.model_identifier
    and profile.profile_schema_version = active_model.profile_schema_version
    and profile.prompt_version = active_model.prompt_version
    and profile.evaluation_fingerprint = active_model.evaluation_fingerprint
    and video.catalog_state = 'active'
    and video.catalog_inactive_reason is null
    and video.privacy_status = 'public'
    and video.embeddable is true
    and video.live_status = 'none'
    and video.age_restricted is false
    and admission.decision = 'admitted'
    and admission.reason_code is null
    and admission.provider_outcome = 'verified'
    and admission.provider_path = 'youtube_data_api_v3_videos_list'
    and admission.provider_verified_at <= statement_timestamp() + interval '5 minutes'
    and admission.evidence_expires_at > statement_timestamp()
    and video.provider_evidence_path = admission.provider_path
    and video.provider_verified_at = admission.provider_verified_at
    and video.provider_evidence_expires_at = admission.evidence_expires_at
  order by profile.created_at desc
  limit 1;

  if source_evidence.profile_id is null then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'source_ineligible');
  end if;

  with eligible as (
    select
      retrieved.candidate_video_id,
      retrieved.candidate_profile_id,
      candidate_admission.id as candidate_catalog_admission_id,
      retrieved.relationship_score,
      array(
        select overlap.key from (
          select unnest(source_evidence.topic_keys) as key
          intersect
          select unnest(candidate_profile.topic_keys) as key
        ) as overlap order by overlap.key
      ) as matched_topic_keys,
      array(
        select overlap.key from (
          select unnest(source_evidence.core_concept_keys) as key
          intersect
          select unnest(candidate_profile.core_concept_keys) as key
        ) as overlap order by overlap.key
      ) as matched_core_concept_keys,
      array(
        select overlap.key from (
          select unnest(source_evidence.application_concept_keys) as key
          intersect
          select unnest(candidate_profile.prerequisite_concept_keys) as key
        ) as overlap order by overlap.key
      ) as matched_source_application_candidate_prerequisite_keys,
      array(
        select overlap.key from (
          select unnest(source_evidence.prerequisite_concept_keys) as key
          intersect
          select unnest(candidate_profile.application_concept_keys) as key
        ) as overlap order by overlap.key
      ) as matched_source_prerequisite_candidate_application_keys,
      array(
        select overlap.key from (
          select unnest(source_evidence.counterpoint_concept_keys) as key
          intersect
          select unnest(candidate_profile.core_concept_keys) as key
        ) as overlap order by overlap.key
      ) as matched_source_counterpoint_candidate_core_keys
    from catalog_private.retrieve_semantic_profile_candidates(
      p_source_video_id,
      50
    ) as retrieved
    join catalog_private.semantic_profile_versions as candidate_profile
      on candidate_profile.id = retrieved.candidate_profile_id
    join public.videos as candidate_video
      on candidate_video.id = retrieved.candidate_video_id
    join lateral (
      select admission.id,
             admission.decision,
             admission.reason_code,
             provider_evidence.provider_outcome,
             provider_evidence.provider_path,
             provider_evidence.provider_verified_at,
             provider_evidence.evidence_expires_at
      from catalog_private.catalog_admissions as admission
      join catalog_private.youtube_provider_evidence as provider_evidence
        on provider_evidence.id = admission.provider_evidence_id
       and provider_evidence.video_id = admission.video_id
      where admission.video_id = candidate_video.id
      order by admission.decided_at desc, admission.id desc
      limit 1
    ) as candidate_admission on true
    where retrieved.relationship_score >= active_policy.minimum_relationship_score
      and candidate_video.catalog_state = 'active'
      and candidate_video.catalog_inactive_reason is null
      and candidate_video.privacy_status = 'public'
      and candidate_video.embeddable is true
      and candidate_video.live_status = 'none'
      and candidate_video.age_restricted is false
      and candidate_admission.decision = 'admitted'
      and candidate_admission.reason_code is null
      and candidate_admission.provider_outcome = 'verified'
      and candidate_admission.provider_path = 'youtube_data_api_v3_videos_list'
      and candidate_admission.provider_verified_at <= statement_timestamp() + interval '5 minutes'
      and candidate_admission.evidence_expires_at > statement_timestamp()
      and candidate_video.provider_evidence_path = candidate_admission.provider_path
      and candidate_video.provider_verified_at = candidate_admission.provider_verified_at
      and candidate_video.provider_evidence_expires_at = candidate_admission.evidence_expires_at
    order by retrieved.relationship_score desc, retrieved.candidate_video_id asc
    limit active_policy.candidate_limit
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'candidateVideoId', eligible.candidate_video_id,
        'candidateProfileId', eligible.candidate_profile_id,
        'candidateCatalogAdmissionId', eligible.candidate_catalog_admission_id,
        'relationshipScore', eligible.relationship_score,
        'matchedTopicKeys', to_jsonb(eligible.matched_topic_keys),
        'matchedCoreConceptKeys', to_jsonb(eligible.matched_core_concept_keys),
        'matchedSourceApplicationCandidatePrerequisiteKeys',
          to_jsonb(eligible.matched_source_application_candidate_prerequisite_keys),
        'matchedSourcePrerequisiteCandidateApplicationKeys',
          to_jsonb(eligible.matched_source_prerequisite_candidate_application_keys),
        'matchedSourceCounterpointCandidateCoreKeys',
          to_jsonb(eligible.matched_source_counterpoint_candidate_core_keys)
      )
      order by eligible.relationship_score desc, eligible.candidate_video_id asc
    ),
    '[]'::jsonb
  ) into candidate_rows
  from eligible;

  insert into catalog_private.recommendation_candidate_pair_evidence (
    source_profile_id,
    candidate_profile_id,
    source_catalog_admission_id,
    candidate_catalog_admission_id,
    model_identifier,
    profile_schema_version,
    prompt_version,
    evaluation_fingerprint,
    candidate_pair_policy_version,
    evidence_level,
    relationship_score,
    matched_topic_keys,
    matched_core_concept_keys,
    matched_source_application_candidate_prerequisite_keys,
    matched_source_prerequisite_candidate_application_keys,
    matched_source_counterpoint_candidate_core_keys
  )
  select
    source_evidence.profile_id,
    (candidate.value ->> 'candidateProfileId')::uuid,
    source_evidence.catalog_admission_id,
    (candidate.value ->> 'candidateCatalogAdmissionId')::uuid,
    active_model.model_identifier,
    active_model.profile_schema_version,
    active_model.prompt_version,
    active_model.evaluation_fingerprint,
    active_policy.policy_version,
    'semantic-profile-v1',
    (candidate.value ->> 'relationshipScore')::integer,
    array(select jsonb_array_elements_text(candidate.value -> 'matchedTopicKeys')),
    array(select jsonb_array_elements_text(candidate.value -> 'matchedCoreConceptKeys')),
    array(select jsonb_array_elements_text(
      candidate.value -> 'matchedSourceApplicationCandidatePrerequisiteKeys'
    )),
    array(select jsonb_array_elements_text(
      candidate.value -> 'matchedSourcePrerequisiteCandidateApplicationKeys'
    )),
    array(select jsonb_array_elements_text(
      candidate.value -> 'matchedSourceCounterpointCandidateCoreKeys'
    ))
  from jsonb_array_elements(candidate_rows) as candidate(value)
  on conflict (
    source_profile_id,
    candidate_profile_id,
    source_catalog_admission_id,
    candidate_catalog_admission_id,
    model_identifier,
    profile_schema_version,
    prompt_version,
    evaluation_fingerprint,
    candidate_pair_policy_version
  ) do nothing;

  pair_count := jsonb_array_length(candidate_rows);

  if pair_count < active_policy.minimum_coverage then
    insert into catalog_private.discovery_demand as existing_demand (
      topic_key,
      language_bucket,
      candidate_pair_policy_version,
      observation_count,
      first_observed_at,
      last_observed_at
    )
    select
      topic_key,
      lower(source_evidence.source_language),
      active_policy.policy_version,
      1,
      statement_timestamp(),
      statement_timestamp()
    from (
      select distinct topic.topic_key
      from unnest(source_evidence.topic_keys) as topic(topic_key)
    ) as topic
    order by topic.topic_key
    on conflict (topic_key, language_bucket, candidate_pair_policy_version)
    do update set
      observation_count = existing_demand.observation_count + 1,
      last_observed_at = greatest(
        existing_demand.last_observed_at,
        excluded.last_observed_at
      );
    get diagnostics demand_bucket_count = row_count;
  end if;

  select coalesce(
    jsonb_agg(
      candidate.value
      || jsonb_build_object(
        'candidatePairEvidenceId', evidence.id,
        'evidenceLevel', evidence.evidence_level,
        'rank', candidate.ordinality
      )
      order by candidate.ordinality
    ),
    '[]'::jsonb
  ) into candidates
  from jsonb_array_elements(candidate_rows) with ordinality as candidate(value, ordinality)
  join catalog_private.recommendation_candidate_pair_evidence as evidence
    on evidence.source_profile_id = source_evidence.profile_id
   and evidence.candidate_profile_id = (candidate.value ->> 'candidateProfileId')::uuid
   and evidence.source_catalog_admission_id = source_evidence.catalog_admission_id
   and evidence.candidate_catalog_admission_id =
     (candidate.value ->> 'candidateCatalogAdmissionId')::uuid
   and evidence.model_identifier = active_model.model_identifier
   and evidence.profile_schema_version = active_model.profile_schema_version
   and evidence.prompt_version = active_model.prompt_version
   and evidence.evaluation_fingerprint = active_model.evaluation_fingerprint
   and evidence.candidate_pair_policy_version = active_policy.policy_version;

  return jsonb_build_object(
    'outcome', 'prepared',
    'policyVersion', active_policy.policy_version,
    'sourceProfileId', source_evidence.profile_id,
    'sourceCatalogAdmissionId', source_evidence.catalog_admission_id,
    'pairCount', pair_count,
    'minimumCoverage', active_policy.minimum_coverage,
    'demandRecorded', pair_count < active_policy.minimum_coverage,
    'demandBucketCount', demand_bucket_count,
    'candidates', candidates
  );
end;
$$;

create or replace function public.prepare_recommendation_candidate_pairs(
  p_source_video_id uuid
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
  return catalog_private.prepare_recommendation_candidate_pairs(p_source_video_id);
end;
$$;

revoke all on function catalog_private.prepare_recommendation_candidate_pairs(uuid)
  from public, anon, authenticated, service_role;
grant execute on function catalog_private.prepare_recommendation_candidate_pairs(uuid)
  to service_role;
revoke all on function public.prepare_recommendation_candidate_pairs(uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_recommendation_candidate_pairs(uuid)
  to service_role;

notify pgrst, 'reload schema';
