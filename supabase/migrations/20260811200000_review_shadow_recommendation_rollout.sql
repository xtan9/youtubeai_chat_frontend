-- Private Review, quality, and rollout controls for Shadow Recommendations
-- (Issue #352).
--
-- This migration is deliberately service-only. It adds no learner reader,
-- Recommendation Composition, worker, Gateway call, or automatic promotion.
-- Every quality value is derived from immutable Set/Recommendation inputs,
-- server-stamped read observations, and structured human Review rows.

create or replace function catalog_private.recommendation_quality_input_fingerprint(
  p_review_policy_version text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  policy_row record;
  current_sets text;
  recommendation_rows text;
  review_rows text;
  read_rows text;
begin
  -- Keep policy thresholds in the same transaction snapshot as the Set and
  -- Review inputs. A direct owner configuration update must wait while a
  -- quality report is being computed or fingerprinted.
  perform pg_advisory_xact_lock(hashtext('recommendation-quality'));

  select policy.* into policy_row
  from catalog_private.recommendation_review_policies as policy
  where policy.review_policy_version = p_review_policy_version
    and policy.status = 'active'
  for share;

  if policy_row.review_policy_version is null then
    return null;
  end if;

  -- Lock the rows that a Set replacement updates. A replacement that starts
  -- after this point cannot make a report look current without changing the
  -- fingerprint checked again by the rollout mutation.
  perform 1
  from catalog_private.recommendation_sets as recommendation_set
  where recommendation_set.status = 'current'
    and recommendation_set.set_policy_fingerprint =
      policy_row.set_policy_fingerprint
  for share;

  select coalesce(
    string_agg(
      recommendation_set.id::text || ':' ||
      recommendation_set.source_video_id::text || ':' ||
      recommendation_set.source_profile_id::text || ':' ||
      recommendation_set.source_catalog_admission_id::text || ':' ||
      recommendation_set.semantic_model_identifier || ':' ||
      recommendation_set.profile_schema_version || ':' ||
      recommendation_set.semantic_prompt_version || ':' ||
      recommendation_set.semantic_evaluation_fingerprint || ':' ||
      recommendation_set.candidate_pair_policy_version || ':' ||
      recommendation_set.source_catalog_admission_policy_version || ':' ||
      recommendation_set.assessment_model_identifier || ':' ||
      recommendation_set.assessment_schema_version || ':' ||
      recommendation_set.assessment_prompt_version || ':' ||
      recommendation_set.relationship_policy_version || ':' ||
      recommendation_set.set_policy_version || ':' ||
      recommendation_set.set_policy_fingerprint || ':' ||
      recommendation_set.set_schema_version || ':' ||
      recommendation_set.item_count::text || ':' ||
      recommendation_set.build_fingerprint || ':' ||
      recommendation_set.status || ':' ||
      coalesce(recommendation_set.published_at::text, ''),
      ',' order by recommendation_set.id
    ),
    ''
  ) into current_sets
  from catalog_private.recommendation_sets as recommendation_set
  where recommendation_set.status = 'current'
    and recommendation_set.set_policy_fingerprint =
      policy_row.set_policy_fingerprint;

  select coalesce(
    string_agg(
      recommendation.recommendation_set_id::text || ':' ||
      recommendation.ordinal::text || ':' ||
      recommendation.recommendation_assessment_id::text || ':' ||
      recommendation.candidate_pair_evidence_id::text || ':' ||
      recommendation.candidate_video_id::text || ':' ||
      recommendation.candidate_profile_id::text || ':' ||
      recommendation.candidate_catalog_admission_id::text || ':' ||
      evidence.model_identifier || ':' || evidence.profile_schema_version || ':' ||
      evidence.prompt_version || ':' || evidence.evaluation_fingerprint || ':' ||
      evidence.candidate_pair_policy_version || ':' || evidence.evidence_level || ':' ||
      evidence.relationship_score::text || ':' ||
      md5(
        evidence.matched_topic_keys::text || ':' ||
        evidence.matched_core_concept_keys::text || ':' ||
        evidence.matched_source_application_candidate_prerequisite_keys::text || ':' ||
        evidence.matched_source_prerequisite_candidate_application_keys::text || ':' ||
        evidence.matched_source_counterpoint_candidate_core_keys::text
      ) || ':' ||
      assessment.semantic_model_identifier || ':' ||
      assessment.profile_schema_version || ':' ||
      assessment.semantic_prompt_version || ':' ||
      assessment.semantic_evaluation_fingerprint || ':' ||
      assessment.candidate_pair_policy_version || ':' ||
      assessment.source_catalog_admission_policy_version || ':' ||
      assessment.candidate_catalog_admission_policy_version || ':' ||
      assessment.assessment_model_identifier || ':' ||
      assessment.assessment_schema_version || ':' ||
      assessment.assessment_prompt_version || ':' ||
      assessment.relationship_policy_version || ':' ||
      assessment.supported::text || ':' ||
      md5(coalesce(assessment.explanation, '') || ':' || assessment.evidence_references::text) || ':' ||
      recommendation.continuation_relationship || ':' ||
      md5(recommendation.explanation || ':' || recommendation.evidence_references::text),
      ',' order by recommendation.recommendation_set_id, recommendation.ordinal
    ),
    ''
  ) into recommendation_rows
  from catalog_private.recommendations as recommendation
  join catalog_private.recommendation_candidate_pair_evidence as evidence
    on evidence.id = recommendation.candidate_pair_evidence_id
  join catalog_private.recommendation_assessments as assessment
    on assessment.id = recommendation.recommendation_assessment_id
  join catalog_private.recommendation_sets as recommendation_set
    on recommendation_set.id = recommendation.recommendation_set_id
   and recommendation_set.status = 'current'
   and recommendation_set.set_policy_fingerprint =
     policy_row.set_policy_fingerprint;

  select coalesce(
    string_agg(
      review.id::text || ':' || review.recommendation_set_id::text || ':' ||
      review.recommendation_ordinal::text || ':' ||
      review.reviewer_id::text || ':' ||
      review.admission_compliant::text || ':' ||
      review.relationship_supported::text || ':' ||
      review.explanation_supported::text || ':' ||
      review.explanation_safe::text || ':' || review.useful::text || ':' ||
      coalesce(review.failure_class, ''),
      ',' order by review.id
    ),
    ''
  ) into review_rows
  from catalog_private.recommendation_reviews as review
  join catalog_private.recommendation_sets as recommendation_set
    on recommendation_set.id = review.recommendation_set_id
   and recommendation_set.status = 'current'
   and recommendation_set.set_policy_fingerprint =
     policy_row.set_policy_fingerprint;

  select coalesce(
    string_agg(
      read_event.id::text || ':' || read_event.recommendation_set_id::text || ':' ||
      read_event.recommendation_ordinal::text || ':' ||
      read_event.latency_ms::text,
      ',' order by read_event.id
    ),
    ''
  ) into read_rows
  from catalog_private.recommendation_ready_read_events as read_event
  join catalog_private.recommendation_sets as recommendation_set
    on recommendation_set.id = read_event.recommendation_set_id
   and recommendation_set.status = 'current'
   and recommendation_set.set_policy_fingerprint =
     policy_row.set_policy_fingerprint;

  return md5(
    'recommendation-quality-v1\n' || p_review_policy_version || E'\n' ||
    policy_row.set_policy_fingerprint || E'\n' ||
    policy_row.minimum_review_corpus::text || E'\n' ||
    policy_row.minimum_usefulness_percent::text || E'\n' ||
    policy_row.minimum_source_coverage_percent::text || E'\n' ||
    policy_row.maximum_ready_read_latency_ms::text || E'\n' ||
    current_sets || E'\n' ||
    recommendation_rows || E'\n' ||
    review_rows || E'\n' || read_rows
  ) || md5(
    'recommendation-quality-v1-secondary\n' || p_review_policy_version ||
    E'\n' || policy_row.set_policy_fingerprint ||
    E'\n' || policy_row.minimum_review_corpus::text ||
    E'\n' || policy_row.minimum_usefulness_percent::text ||
    E'\n' || policy_row.minimum_source_coverage_percent::text ||
    E'\n' || policy_row.maximum_ready_read_latency_ms::text ||
    E'\n' || current_sets ||
    E'\n' || recommendation_rows || E'\n' || review_rows || E'\n' || read_rows
  );
end;
$$;

create table catalog_private.recommendation_review_policies (
  review_policy_version text primary key check (
    review_policy_version ~ '^recommendation-review-policy-v[1-9][0-9]*$'
  ),
  set_policy_version text not null references
    catalog_private.recommendation_set_policies(set_policy_version)
    on delete restrict,
  set_policy_fingerprint text not null references
    catalog_private.recommendation_set_policies(set_policy_fingerprint)
    on delete restrict check (set_policy_fingerprint ~ '^[a-f0-9]{64}$'),
  set_schema_version text not null check (
    set_schema_version = 'shadow-recommendation-set-v1'
  ),
  minimum_review_corpus integer not null check (
    minimum_review_corpus between 1 and 1000000
  ),
  minimum_usefulness_percent numeric(5,2) not null check (
    minimum_usefulness_percent between 0 and 100
  ),
  minimum_source_coverage_percent numeric(5,2) not null check (
    minimum_source_coverage_percent between 0 and 100
  ),
  maximum_ready_read_latency_ms integer not null check (
    maximum_ready_read_latency_ms between 1 and 86400000
  ),
  status text not null check (status in ('active', 'retired')),
  created_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  check (
    (status = 'active' and retired_at is null)
    or (status = 'retired' and retired_at is not null)
  )
);

create unique index recommendation_review_policy_one_active_set_idx
  on catalog_private.recommendation_review_policies (set_policy_fingerprint)
  where status = 'active';

insert into catalog_private.recommendation_review_policies (
  review_policy_version,
  set_policy_version,
  set_policy_fingerprint,
  set_schema_version,
  minimum_review_corpus,
  minimum_usefulness_percent,
  minimum_source_coverage_percent,
  maximum_ready_read_latency_ms,
  status
)
select
  'recommendation-review-policy-v1',
  policy.set_policy_version,
  policy.set_policy_fingerprint,
  policy.set_schema_version,
  20,
  80,
  60,
  500,
  'active'
from catalog_private.recommendation_set_policies as policy
where policy.set_policy_version = 'shadow-recommendation-set-policy-v1'
  and policy.status = 'active';

create table catalog_private.recommendation_reviews (
  id uuid primary key default gen_random_uuid(),
  recommendation_set_id uuid not null,
  recommendation_ordinal integer not null check (recommendation_ordinal between 1 and 50),
  recommendation_assessment_id uuid not null,
  reviewer_id uuid not null,
  reviewer_email text not null check (
    btrim(reviewer_email) <> ''
    and reviewer_email = btrim(reviewer_email)
    and char_length(reviewer_email) <= 320
  ),
  admission_compliant boolean not null,
  relationship_supported boolean not null,
  explanation_supported boolean not null,
  explanation_safe boolean not null,
  useful boolean not null,
  failure_class text check (
    failure_class is null
    or failure_class in (
      'admission',
      'relationship_unsupported',
      'explanation_unsupported',
      'explanation_unsafe',
      'not_useful',
      'multiple'
    )
  ),
  reviewed_at timestamptz not null default clock_timestamp(),
  foreign key (recommendation_set_id, recommendation_ordinal)
    references catalog_private.recommendations(recommendation_set_id, ordinal)
    on delete restrict,
  foreign key (recommendation_set_id, recommendation_assessment_id)
    references catalog_private.recommendations(
      recommendation_set_id, recommendation_assessment_id
    ) on delete restrict,
  unique (recommendation_set_id, recommendation_ordinal, reviewer_id),
  check (
    (
      admission_compliant
      and relationship_supported
      and explanation_supported
      and explanation_safe
      and useful
      and failure_class is null
    )
    or failure_class is not null
  )
);

create index recommendation_reviews_set_idx
  on catalog_private.recommendation_reviews (
    recommendation_set_id, recommendation_ordinal, reviewed_at desc
  );
create index recommendation_reviews_failure_idx
  on catalog_private.recommendation_reviews (failure_class, reviewed_at desc);

create table catalog_private.recommendation_ready_read_events (
  id uuid primary key default gen_random_uuid(),
  recommendation_set_id uuid not null,
  recommendation_ordinal integer not null check (recommendation_ordinal between 1 and 50),
  latency_ms bigint not null check (latency_ms >= 0),
  observed_at timestamptz not null default clock_timestamp(),
  foreign key (recommendation_set_id, recommendation_ordinal)
    references catalog_private.recommendations(recommendation_set_id, ordinal)
    on delete restrict
);

create index recommendation_ready_read_events_set_idx
  on catalog_private.recommendation_ready_read_events (
    recommendation_set_id, recommendation_ordinal, observed_at desc
  );

create table catalog_private.recommendation_quality_reports (
  id uuid primary key default gen_random_uuid(),
  review_policy_version text not null references
    catalog_private.recommendation_review_policies(review_policy_version)
    on delete restrict,
  set_policy_fingerprint text not null references
    catalog_private.recommendation_set_policies(set_policy_fingerprint)
    on delete restrict check (set_policy_fingerprint ~ '^[a-f0-9]{64}$'),
  input_fingerprint text not null unique check (input_fingerprint ~ '^[a-f0-9]{64}$'),
  current_set_count integer not null check (current_set_count >= 0),
  review_sample_size integer not null check (review_sample_size >= 0),
  reviewed_source_count integer not null check (reviewed_source_count >= 0),
  source_coverage_percent numeric(6,2) not null check (
    source_coverage_percent between 0 and 100
  ),
  gate_compliance_percent numeric(6,2) not null check (
    gate_compliance_percent between 0 and 100
  ),
  unsupported_or_unsafe_count integer not null check (unsupported_or_unsafe_count >= 0),
  useful_review_count integer not null check (useful_review_count >= 0),
  usefulness_percent numeric(6,2) not null check (usefulness_percent between 0 and 100),
  ready_read_sample_size integer not null check (ready_read_sample_size >= 0),
  ready_read_p95_latency_ms bigint,
  gates jsonb not null check (jsonb_typeof(gates) = 'object'),
  eligible boolean not null,
  computed_at timestamptz not null default clock_timestamp()
);

create index recommendation_quality_reports_policy_idx
  on catalog_private.recommendation_quality_reports (
    review_policy_version, computed_at desc
  );

create table catalog_private.recommendation_rollout_controls (
  singleton boolean primary key default true check (singleton),
  configured_state text not null check (
    configured_state in ('off', 'shadow', 'pilot', 'on')
  ),
  kill_switch boolean not null default true,
  approved_quality_report_id uuid references
    catalog_private.recommendation_quality_reports(id) on delete restrict,
  approved_quality_input_fingerprint text check (
    approved_quality_input_fingerprint is null
    or approved_quality_input_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  revision bigint not null default 0 check (revision >= 0),
  updated_by uuid,
  updated_by_email text check (
    updated_by_email is null
    or (
      btrim(updated_by_email) <> ''
      and updated_by_email = btrim(updated_by_email)
      and char_length(updated_by_email) <= 320
    )
  ),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (approved_quality_report_id is null and approved_quality_input_fingerprint is null)
    or (approved_quality_report_id is not null and approved_quality_input_fingerprint is not null)
  )
);

insert into catalog_private.recommendation_rollout_controls (singleton, configured_state, kill_switch)
values (true, 'off', true);

alter table catalog_private.recommendation_review_policies enable row level security;
alter table catalog_private.recommendation_reviews enable row level security;
alter table catalog_private.recommendation_ready_read_events enable row level security;
alter table catalog_private.recommendation_quality_reports enable row level security;
alter table catalog_private.recommendation_rollout_controls enable row level security;

revoke all on table catalog_private.recommendation_review_policies
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.recommendation_reviews
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.recommendation_ready_read_events
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.recommendation_quality_reports
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.recommendation_rollout_controls
  from public, anon, authenticated, service_role;

create or replace function catalog_private.reject_recommendation_review_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Recommendation Reviews are immutable';
end;
$$;

create trigger recommendation_reviews_immutable_trg
before update or delete on catalog_private.recommendation_reviews
for each row execute function catalog_private.reject_recommendation_review_mutation();

create or replace function catalog_private.reject_recommendation_quality_report_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Recommendation quality reports are immutable';
end;
$$;

create trigger recommendation_quality_reports_immutable_trg
before update or delete on catalog_private.recommendation_quality_reports
for each row execute function catalog_private.reject_recommendation_quality_report_mutation();

-- Set publication is an input to quality reports. Serialize every Set/
-- Recommendation row mutation with the quality snapshot lock so a report
-- cannot combine metrics from one committed Set with a fingerprint from the
-- next replacement. The #351 publisher keeps its per-source lock; this
-- trigger supplies the shared quality boundary without rewriting that RPC.
create or replace function catalog_private.lock_recommendation_quality_inputs()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('recommendation-quality'));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger recommendation_sets_quality_lock_trg
before insert or update or delete on catalog_private.recommendation_sets
for each row execute function catalog_private.lock_recommendation_quality_inputs();

create trigger recommendations_quality_lock_trg
before insert or update or delete on catalog_private.recommendations
for each row execute function catalog_private.lock_recommendation_quality_inputs();

-- Review policy thresholds are quality inputs too. Keep owner/admin edits
-- behind the same transaction lock so metrics and their fingerprint cannot
-- observe different threshold versions.
create trigger recommendation_review_policies_quality_lock_trg
before insert or update or delete on catalog_private.recommendation_review_policies
for each row execute function catalog_private.lock_recommendation_quality_inputs();

create or replace function catalog_private.assert_recommendation_admin(
  p_admin_id uuid,
  p_admin_email text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  admin_exists boolean;
begin
  select exists (
    select 1
    from auth.users as admin_user
    where admin_user.id = p_admin_id
      and lower(admin_user.email) = lower(btrim(coalesce(p_admin_email, '')))
      and (
        admin_user.is_super_admin
        or admin_user.raw_app_meta_data ->> 'is_admin' = 'true'
      )
  ) into admin_exists;

  if not admin_exists then
    raise insufficient_privilege using message = 'administrator gate required';
  end if;
end;
$$;

create or replace function catalog_private.submit_recommendation_review(
  p_recommendation_set_id uuid,
  p_recommendation_ordinal integer,
  p_reviewer_id uuid,
  p_reviewer_email text,
  p_admission_compliant boolean,
  p_relationship_supported boolean,
  p_explanation_supported boolean,
  p_explanation_safe boolean,
  p_useful boolean,
  p_rejection_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  recommendation_row record;
  existing_review record;
  review_id uuid;
  failure_class text;
  normalized_email text;
begin
  normalized_email := lower(btrim(coalesce(p_reviewer_email, '')));
  if p_recommendation_set_id is null
    or p_recommendation_ordinal is null
    or p_reviewer_id is null
    or normalized_email = ''
    or char_length(normalized_email) > 320
    or p_admission_compliant is null
    or p_relationship_supported is null
    or p_explanation_supported is null
    or p_explanation_safe is null
    or p_useful is null
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'recommendation_review_contract'
    );
  end if;

  perform catalog_private.assert_recommendation_admin(
    p_reviewer_id,
    normalized_email
  );

  failure_class := case
    when not p_admission_compliant
      and (not p_relationship_supported
        or not p_explanation_supported
        or not p_explanation_safe
        or not p_useful)
      then 'multiple'
    when not p_admission_compliant then 'admission'
    when not p_relationship_supported then 'relationship_unsupported'
    when not p_explanation_supported then 'explanation_unsupported'
    when not p_explanation_safe then 'explanation_unsafe'
    when not p_useful then 'not_useful'
    else null
  end;

  if failure_class is null then
    if p_rejection_reason is not null then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'malformed',
        'reason', 'unexpected_rejection_reason'
      );
    end if;
  elsif p_rejection_reason is distinct from failure_class then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'rejection_reason_mismatch'
    );
  end if;

  -- Review, quality-report, and rollout operations share one lock. This keeps
  -- report fingerprints and explicit promotion decisions race-free.
  perform pg_advisory_xact_lock(hashtext('recommendation-quality'));

  select
    recommendation.recommendation_assessment_id,
    recommendation.recommendation_set_id,
    recommendation.ordinal,
    recommendation.continuation_relationship,
    recommendation.explanation,
    recommendation.evidence_references,
    recommendation_set.status as set_status,
    recommendation_set.published_at
  into recommendation_row
  from catalog_private.recommendations as recommendation
  join catalog_private.recommendation_sets as recommendation_set
    on recommendation_set.id = recommendation.recommendation_set_id
  where recommendation.recommendation_set_id = p_recommendation_set_id
    and recommendation.ordinal = p_recommendation_ordinal
    and recommendation_set.status in ('current', 'superseded')
    and recommendation_set.published_at is not null;

  if recommendation_row.recommendation_assessment_id is null then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unverifiable',
      'reason', 'recommendation_missing'
    );
  end if;

  select review.id,
         review.admission_compliant,
         review.relationship_supported,
         review.explanation_supported,
         review.explanation_safe,
         review.useful,
         review.failure_class
  into existing_review
  from catalog_private.recommendation_reviews as review
  where review.recommendation_set_id = p_recommendation_set_id
    and review.recommendation_ordinal = p_recommendation_ordinal
    and review.reviewer_id = p_reviewer_id;

  if existing_review.id is not null then
    if existing_review.admission_compliant is distinct from p_admission_compliant
      or existing_review.relationship_supported is distinct from p_relationship_supported
      or existing_review.explanation_supported is distinct from p_explanation_supported
      or existing_review.explanation_safe is distinct from p_explanation_safe
      or existing_review.useful is distinct from p_useful
      or existing_review.failure_class is distinct from failure_class
    then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'conflict',
        'reason', 'recommendation_review_immutable'
      );
    end if;
    return jsonb_build_object(
      'outcome', 'reused',
      'reviewId', existing_review.id,
      'failureClass', existing_review.failure_class
    );
  end if;

  insert into catalog_private.recommendation_reviews (
    recommendation_set_id,
    recommendation_ordinal,
    recommendation_assessment_id,
    reviewer_id,
    reviewer_email,
    admission_compliant,
    relationship_supported,
    explanation_supported,
    explanation_safe,
    useful,
    failure_class
  ) values (
    p_recommendation_set_id,
    p_recommendation_ordinal,
    recommendation_row.recommendation_assessment_id,
    p_reviewer_id,
    normalized_email,
    p_admission_compliant,
    p_relationship_supported,
    p_explanation_supported,
    p_explanation_safe,
    p_useful,
    failure_class
  ) returning id into review_id;

  -- A review is not durable unless its existing-style admin audit row is also
  -- durable. The server caller reaches this function only after its existing
  -- admin gate has produced the reviewer identity.
  insert into public.admin_audit_log (
    admin_id,
    admin_email,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    p_reviewer_id,
    normalized_email,
    'submit_recommendation_review',
    'recommendation_review',
    review_id::text,
    jsonb_build_object(
      'recommendationSetId', p_recommendation_set_id,
      'recommendationOrdinal', p_recommendation_ordinal,
      'failureClass', failure_class
    )
  );

  return jsonb_build_object(
    'outcome', 'stored',
    'reviewId', review_id,
    'failureClass', failure_class
  );
end;
$$;

create or replace function public.submit_recommendation_review(
  p_recommendation_set_id uuid,
  p_recommendation_ordinal integer,
  p_reviewer_id uuid,
  p_reviewer_email text,
  p_admission_compliant boolean,
  p_relationship_supported boolean,
  p_explanation_supported boolean,
  p_explanation_safe boolean,
  p_useful boolean,
  p_rejection_reason text
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
  return catalog_private.submit_recommendation_review(
    p_recommendation_set_id,
    p_recommendation_ordinal,
    p_reviewer_id,
    p_reviewer_email,
    p_admission_compliant,
    p_relationship_supported,
    p_explanation_supported,
    p_explanation_safe,
    p_useful,
    p_rejection_reason
  );
end;
$$;

create or replace function catalog_private.record_recommendation_ready_read(
  p_recommendation_set_id uuid,
  p_recommendation_ordinal integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  published_at timestamptz;
  observed_at timestamptz := clock_timestamp();
  latency bigint;
  event_id uuid;
begin
  if p_recommendation_set_id is null or p_recommendation_ordinal is null then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'ready_read_contract'
    );
  end if;

  perform pg_advisory_xact_lock(hashtext('recommendation-quality'));

  select recommendation_set.published_at
  into published_at
  from catalog_private.recommendations as recommendation
  join catalog_private.recommendation_sets as recommendation_set
    on recommendation_set.id = recommendation.recommendation_set_id
  where recommendation.recommendation_set_id = p_recommendation_set_id
    and recommendation.ordinal = p_recommendation_ordinal
    and recommendation_set.status = 'current'
    and recommendation_set.published_at is not null;

  if published_at is null then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unverifiable',
      'reason', 'current_recommendation_missing'
    );
  end if;

  latency := floor(extract(epoch from (observed_at - published_at)) * 1000)::bigint;
  if latency < 0 then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unverifiable',
      'reason', 'ready_read_before_publication'
    );
  end if;

  insert into catalog_private.recommendation_ready_read_events (
    recommendation_set_id,
    recommendation_ordinal,
    latency_ms,
    observed_at
  ) values (
    p_recommendation_set_id,
    p_recommendation_ordinal,
    latency,
    observed_at
  ) returning id into event_id;

  return jsonb_build_object(
    'outcome', 'recorded',
    'readyReadEventId', event_id,
    'latencyMs', latency
  );
end;
$$;

create or replace function public.record_recommendation_ready_read(
  p_recommendation_set_id uuid,
  p_recommendation_ordinal integer
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
  return catalog_private.record_recommendation_ready_read(
    p_recommendation_set_id,
    p_recommendation_ordinal
  );
end;
$$;

create or replace function catalog_private.compute_recommendation_quality_report(
  p_review_policy_version text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  policy_row record;
  report_row record;
  v_input_fingerprint text;
  current_set_count integer;
  review_sample_size integer;
  reviewed_source_count integer;
  compliant_review_count integer;
  unsupported_or_unsafe_count integer;
  useful_review_count integer;
  ready_read_sample_size integer;
  ready_read_p95_latency_ms bigint;
  source_coverage_percent numeric(6,2);
  gate_compliance_percent numeric(6,2);
  usefulness_percent numeric(6,2);
  eligible boolean;
  gates jsonb;
begin
  if p_review_policy_version is null
    or btrim(p_review_policy_version) = ''
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'review_policy_required'
    );
  end if;

  perform pg_advisory_xact_lock(hashtext('recommendation-quality'));

  select policy.*
  into policy_row
  from catalog_private.recommendation_review_policies as policy
  where policy.review_policy_version = p_review_policy_version
    and policy.status = 'active'
  for share;

  if policy_row.review_policy_version is null then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unverifiable',
      'reason', 'active_review_policy_missing'
    );
  end if;

  -- The review sample is over immutable Review rows attached to current Sets.
  -- A source counts as reviewed once any Recommendation in that Set has a
  -- Review. This keeps source coverage independent of the number of items.
  select
    count(distinct recommendation_set.id)::integer,
    count(review.id)::integer,
    count(distinct recommendation_set.source_video_id)
      filter (where review.id is not null)::integer,
    count(*) filter (
      where review.admission_compliant
        and review.relationship_supported
        and review.explanation_supported
        and review.explanation_safe
        and review.useful
    )::integer,
    count(*) filter (
      where not review.relationship_supported
        or not review.explanation_supported
        or not review.explanation_safe
    )::integer,
    count(*) filter (where review.useful)::integer
  into
    current_set_count,
    review_sample_size,
    reviewed_source_count,
    compliant_review_count,
    unsupported_or_unsafe_count,
    useful_review_count
  from catalog_private.recommendation_sets as recommendation_set
  left join catalog_private.recommendation_reviews as review
    on review.recommendation_set_id = recommendation_set.id
  where recommendation_set.status = 'current'
    and recommendation_set.set_policy_fingerprint =
      policy_row.set_policy_fingerprint;

  select
    count(*)::integer,
    percentile_disc(0.95) within group (order by read_event.latency_ms)
  into ready_read_sample_size, ready_read_p95_latency_ms
  from catalog_private.recommendation_ready_read_events as read_event
  join catalog_private.recommendation_sets as recommendation_set
    on recommendation_set.id = read_event.recommendation_set_id
   and recommendation_set.status = 'current'
   and recommendation_set.set_policy_fingerprint =
     policy_row.set_policy_fingerprint;

  source_coverage_percent := case
    when current_set_count = 0 then 0
    else round(reviewed_source_count * 100.0 / current_set_count, 2)
  end;
  gate_compliance_percent := case
    when review_sample_size = 0 then 0
    else round(compliant_review_count * 100.0 / review_sample_size, 2)
  end;
  usefulness_percent := case
    when review_sample_size = 0 then 0
    else round(useful_review_count * 100.0 / review_sample_size, 2)
  end;

  eligible := current_set_count > 0
    and review_sample_size >= policy_row.minimum_review_corpus
    and gate_compliance_percent >= 100
    and unsupported_or_unsafe_count = 0
    and usefulness_percent >= policy_row.minimum_usefulness_percent
    and source_coverage_percent >= policy_row.minimum_source_coverage_percent
    and ready_read_sample_size > 0
    and ready_read_p95_latency_ms is not null
    and ready_read_p95_latency_ms < policy_row.maximum_ready_read_latency_ms;

  gates := jsonb_build_object(
    'minimumReviewCorpus', review_sample_size >= policy_row.minimum_review_corpus,
    'gateCompliance', gate_compliance_percent >= 100,
    'unsupportedOrUnsafe', unsupported_or_unsafe_count = 0,
    'usefulness', usefulness_percent >= policy_row.minimum_usefulness_percent,
    'sourceCoverage', source_coverage_percent >= policy_row.minimum_source_coverage_percent,
    'readyReadLatency', ready_read_sample_size > 0
      and ready_read_p95_latency_ms is not null
      and ready_read_p95_latency_ms < policy_row.maximum_ready_read_latency_ms,
    'eligible', eligible
  );

  v_input_fingerprint := catalog_private.recommendation_quality_input_fingerprint(
    p_review_policy_version
  );

  if v_input_fingerprint is null then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unverifiable',
      'reason', 'quality_inputs_missing'
    );
  end if;

  insert into catalog_private.recommendation_quality_reports (
    review_policy_version,
    set_policy_fingerprint,
    input_fingerprint,
    current_set_count,
    review_sample_size,
    reviewed_source_count,
    source_coverage_percent,
    gate_compliance_percent,
    unsupported_or_unsafe_count,
    useful_review_count,
    usefulness_percent,
    ready_read_sample_size,
    ready_read_p95_latency_ms,
    gates,
    eligible
  ) values (
    p_review_policy_version,
    policy_row.set_policy_fingerprint,
    v_input_fingerprint,
    current_set_count,
    review_sample_size,
    reviewed_source_count,
    source_coverage_percent,
    gate_compliance_percent,
    unsupported_or_unsafe_count,
    useful_review_count,
    usefulness_percent,
    ready_read_sample_size,
    ready_read_p95_latency_ms,
    gates,
    eligible
  ) on conflict (input_fingerprint) do nothing;

  select report.*
  into report_row
  from catalog_private.recommendation_quality_reports as report
  where report.input_fingerprint = v_input_fingerprint;

  return jsonb_build_object(
    'outcome', 'computed',
    'qualityReportId', report_row.id,
    'reviewPolicyVersion', p_review_policy_version,
    'setPolicyFingerprint', policy_row.set_policy_fingerprint,
    'inputFingerprint', report_row.input_fingerprint,
    'currentSetCount', report_row.current_set_count,
    'reviewSampleSize', report_row.review_sample_size,
    'reviewedSourceCount', report_row.reviewed_source_count,
    'sourceCoveragePercent', report_row.source_coverage_percent,
    'gateCompliancePercent', report_row.gate_compliance_percent,
    'unsupportedOrUnsafeCount', report_row.unsupported_or_unsafe_count,
    'usefulReviewCount', report_row.useful_review_count,
    'usefulnessPercent', report_row.usefulness_percent,
    'readyReadSampleSize', report_row.ready_read_sample_size,
    'readyReadP95LatencyMs', report_row.ready_read_p95_latency_ms,
    'gates', report_row.gates,
    'eligible', report_row.eligible
  );
end;
$$;

create or replace function public.compute_recommendation_quality_report(
  p_review_policy_version text
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
  return catalog_private.compute_recommendation_quality_report(
    p_review_policy_version
  );
end;
$$;

create or replace function catalog_private.list_recommendation_reviews(
  p_source_video_id uuid,
  p_relationship text,
  p_evidence_level text,
  p_set_policy_version text,
  p_build_state text,
  p_failure_class text,
  p_semantic_model_identifier text,
  p_assessment_model_identifier text,
  p_candidate_pair_policy_version text,
  p_relationship_policy_version text,
  p_candidate_pair_model_identifier text,
  p_source_catalog_admission_policy_version text,
  p_candidate_catalog_admission_policy_version text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  review_rows jsonb;
begin
  if p_relationship is not null
    and p_relationship not in (
      'deeper_explanation', 'prerequisite', 'practical_application',
      'credible_alternative'
    )
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'relationship_filter'
    );
  end if;
  if p_build_state is not null
    and p_build_state not in ('building', 'current', 'superseded', 'all')
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'build_state_filter'
    );
  end if;
  if p_failure_class is not null
    and p_failure_class not in (
      'admission', 'relationship_unsupported', 'explanation_unsupported',
      'explanation_unsafe', 'not_useful', 'multiple'
    )
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'failure_class_filter'
    );
  end if;
  if p_evidence_level is not null and char_length(p_evidence_level) > 100 then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'evidence_level_filter'
    );
  end if;

  select coalesce(
    jsonb_agg(
      (
        jsonb_build_object(
        'recommendationSetId', recommendation_set.id,
        'setStatus', recommendation_set.status,
        'sourceVideoId', recommendation_set.source_video_id,
        'sourceProfileId', recommendation_set.source_profile_id,
        'sourceCatalogAdmissionId', recommendation_set.source_catalog_admission_id,
        'sourceVideoTitle', source_video.title,
        'sourceVideoLanguage', source_video.language,
        'candidateVideoId', recommendation.candidate_video_id,
        'candidateProfileId', recommendation.candidate_profile_id,
        'candidateCatalogAdmissionId', recommendation.candidate_catalog_admission_id,
        'candidateVideoTitle', candidate_video.title,
        'candidateVideoLanguage', candidate_video.language,
        'ordinal', recommendation.ordinal,
        'recommendationAssessmentId', recommendation.recommendation_assessment_id,
        'candidatePairEvidenceId', recommendation.candidate_pair_evidence_id,
        'candidatePairModelIdentifier', evidence.model_identifier,
        'candidatePairProfileSchemaVersion', evidence.profile_schema_version,
        'candidatePairPromptVersion', evidence.prompt_version,
        'candidatePairEvaluationFingerprint', evidence.evaluation_fingerprint,
        'candidatePairPolicyVersion', evidence.candidate_pair_policy_version,
        'evidenceLevel', evidence.evidence_level,
        'relationshipScore', evidence.relationship_score,
        'relationship', recommendation.continuation_relationship,
        'explanation', recommendation.explanation,
        'evidenceReferences', recommendation.evidence_references
        )
        || jsonb_build_object(
        'semanticModelIdentifier', recommendation_set.semantic_model_identifier,
        'profileSchemaVersion', recommendation_set.profile_schema_version,
        'semanticPromptVersion', recommendation_set.semantic_prompt_version,
        'semanticEvaluationFingerprint', recommendation_set.semantic_evaluation_fingerprint,
        'setCandidatePairPolicyVersion',
          recommendation_set.candidate_pair_policy_version,
        'sourceCatalogAdmissionPolicyVersion',
          recommendation_set.source_catalog_admission_policy_version,
        'candidatePairSourceProfileId', evidence.source_profile_id,
        'candidatePairCandidateProfileId', evidence.candidate_profile_id,
        'candidatePairSourceCatalogAdmissionId',
          evidence.source_catalog_admission_id,
        'candidatePairCandidateCatalogAdmissionId',
          evidence.candidate_catalog_admission_id,
        'assessmentSourceProfileId', assessment.source_profile_id,
        'assessmentCandidateProfileId', assessment.candidate_profile_id,
        'assessmentSourceCatalogAdmissionId',
          assessment.source_catalog_admission_id,
        'assessmentCandidateCatalogAdmissionId',
          assessment.candidate_catalog_admission_id,
        'assessmentSemanticModelIdentifier',
          assessment.semantic_model_identifier,
        'assessmentProfileSchemaVersion', assessment.profile_schema_version,
        'assessmentSemanticPromptVersion', assessment.semantic_prompt_version,
        'assessmentSemanticEvaluationFingerprint',
          assessment.semantic_evaluation_fingerprint,
        'assessmentCandidatePairPolicyVersion',
          assessment.candidate_pair_policy_version,
        'assessmentSourceCatalogAdmissionPolicyVersion',
          assessment.source_catalog_admission_policy_version,
        'assessmentCandidateCatalogAdmissionPolicyVersion',
          assessment.candidate_catalog_admission_policy_version,
        'assessmentModelIdentifier', recommendation_set.assessment_model_identifier,
        'assessmentSchemaVersion', recommendation_set.assessment_schema_version,
        'assessmentPromptVersion', recommendation_set.assessment_prompt_version,
        'relationshipPolicyVersion', recommendation_set.relationship_policy_version,
        'assessmentRelationshipPolicyVersion', assessment.relationship_policy_version,
        'assessmentSupported', assessment.supported,
        'assessmentContinuationRelationship', assessment.continuation_relationship,
        'assessmentExplanation', assessment.explanation,
        'assessmentEvidenceReferences', assessment.evidence_references,
        'setPolicyVersion', recommendation_set.set_policy_version,
        'setPolicyFingerprint', recommendation_set.set_policy_fingerprint,
        'setSchemaVersion', recommendation_set.set_schema_version,
        'itemCount', recommendation_set.item_count,
        'buildFingerprint', recommendation_set.build_fingerprint,
        'publishedAt', recommendation_set.published_at,
        'reviewerId', review.reviewer_id,
        'reviewerEmail', review.reviewer_email,
        'reviewedAt', review.reviewed_at,
        'admissionCompliant', review.admission_compliant,
        'relationshipSupported', review.relationship_supported,
        'explanationSupported', review.explanation_supported,
        'explanationSafe', review.explanation_safe,
        'useful', review.useful,
        'failureClass', review.failure_class
        )
      ) order by recommendation_set.published_at desc,
        recommendation_set.id, recommendation.ordinal, review.reviewed_at
    ),
    '[]'::jsonb
  ) into review_rows
  from catalog_private.recommendation_reviews as review
  join catalog_private.recommendations as recommendation
    on recommendation.recommendation_set_id = review.recommendation_set_id
   and recommendation.ordinal = review.recommendation_ordinal
  join catalog_private.recommendation_candidate_pair_evidence as evidence
    on evidence.id = recommendation.candidate_pair_evidence_id
  join catalog_private.recommendation_assessments as assessment
    on assessment.id = recommendation.recommendation_assessment_id
  join catalog_private.recommendation_sets as recommendation_set
    on recommendation_set.id = recommendation.recommendation_set_id
  join public.videos as source_video
    on source_video.id = recommendation_set.source_video_id
  join public.videos as candidate_video
    on candidate_video.id = recommendation.candidate_video_id
  where (p_source_video_id is null
    or recommendation_set.source_video_id = p_source_video_id)
    and (p_relationship is null
      or recommendation.continuation_relationship = p_relationship)
    and (p_set_policy_version is null
      or recommendation_set.set_policy_version = p_set_policy_version)
    and (p_semantic_model_identifier is null
      or recommendation_set.semantic_model_identifier = p_semantic_model_identifier)
    and (p_assessment_model_identifier is null
      or recommendation_set.assessment_model_identifier = p_assessment_model_identifier)
    and (p_candidate_pair_policy_version is null
      or evidence.candidate_pair_policy_version = p_candidate_pair_policy_version)
    and (p_relationship_policy_version is null
      or recommendation_set.relationship_policy_version = p_relationship_policy_version)
    and (p_candidate_pair_model_identifier is null
      or evidence.model_identifier = p_candidate_pair_model_identifier)
    and (p_source_catalog_admission_policy_version is null
      or recommendation_set.source_catalog_admission_policy_version =
        p_source_catalog_admission_policy_version)
    and (p_candidate_catalog_admission_policy_version is null
      or assessment.candidate_catalog_admission_policy_version =
        p_candidate_catalog_admission_policy_version)
    and (p_build_state is null or p_build_state = 'all'
      or recommendation_set.status = p_build_state)
    and (p_failure_class is null
      or review.failure_class = p_failure_class)
    and (p_evidence_level is null
      or evidence.evidence_level = p_evidence_level);

  return jsonb_build_object(
    'outcome', 'listed',
    'reviews', review_rows
  );
end;
$$;

create or replace function public.list_recommendation_reviews(
  p_source_video_id uuid,
  p_relationship text,
  p_evidence_level text,
  p_set_policy_version text,
  p_build_state text,
  p_failure_class text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.list_recommendation_reviews(
    p_source_video_id,
    p_relationship,
    p_evidence_level,
    p_set_policy_version,
    p_build_state,
    p_failure_class,
    null,
    null,
    null,
    null,
    null,
    null,
    null
  );
end;
$$;

create or replace function public.list_recommendation_reviews(
  p_source_video_id uuid,
  p_relationship text,
  p_evidence_level text,
  p_set_policy_version text,
  p_build_state text,
  p_failure_class text,
  p_semantic_model_identifier text,
  p_assessment_model_identifier text,
  p_candidate_pair_policy_version text,
  p_relationship_policy_version text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.list_recommendation_reviews(
    p_source_video_id,
    p_relationship,
    p_evidence_level,
    p_set_policy_version,
    p_build_state,
    p_failure_class,
    p_semantic_model_identifier,
    p_assessment_model_identifier,
    p_candidate_pair_policy_version,
    p_relationship_policy_version,
    null,
    null,
    null
  );
end;
$$;

create or replace function public.list_recommendation_reviews(
  p_source_video_id uuid,
  p_relationship text,
  p_evidence_level text,
  p_set_policy_version text,
  p_build_state text,
  p_failure_class text,
  p_semantic_model_identifier text,
  p_assessment_model_identifier text,
  p_candidate_pair_policy_version text,
  p_relationship_policy_version text,
  p_candidate_pair_model_identifier text,
  p_source_catalog_admission_policy_version text,
  p_candidate_catalog_admission_policy_version text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.list_recommendation_reviews(
    p_source_video_id,
    p_relationship,
    p_evidence_level,
    p_set_policy_version,
    p_build_state,
    p_failure_class,
    p_semantic_model_identifier,
    p_assessment_model_identifier,
    p_candidate_pair_policy_version,
    p_relationship_policy_version,
    p_candidate_pair_model_identifier,
    p_source_catalog_admission_policy_version,
    p_candidate_catalog_admission_policy_version
  );
end;
$$;

create or replace function catalog_private.set_recommendation_rollout(
  p_requested_state text,
  p_kill_switch boolean,
  p_quality_report_id uuid,
  p_admin_id uuid,
  p_admin_email text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  control_row record;
  policy_row record;
  quality_row record;
  current_input_fingerprint text;
  normalized_email text;
  current_set_count integer;
  current_rank integer;
  requested_rank integer;
  effective_state text;
  approved_input_fingerprint text;
begin
  normalized_email := lower(btrim(coalesce(p_admin_email, '')));
  if p_requested_state is null
    or p_requested_state not in ('off', 'shadow', 'pilot', 'on')
    or p_kill_switch is null
    or p_admin_id is null
    or normalized_email = ''
    or char_length(normalized_email) > 320
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'rollout_control_contract'
    );
  end if;

  if p_requested_state <> 'off' and p_kill_switch then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unsafe',
      'reason', 'kill_switch_requires_off'
    );
  end if;

  perform catalog_private.assert_recommendation_admin(
    p_admin_id,
    normalized_email
  );

  perform pg_advisory_xact_lock(hashtext('recommendation-quality'));
  perform pg_advisory_xact_lock(hashtext('recommendation-rollout'));

  select control.*
  into control_row
  from catalog_private.recommendation_rollout_controls as control
  where control.singleton
  for update;

  if control_row.singleton is null then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unverifiable',
      'reason', 'rollout_control_missing'
    );
  end if;

  current_rank := case control_row.configured_state
    when 'off' then 0
    when 'shadow' then 1
    when 'pilot' then 2
    when 'on' then 3
  end;
  requested_rank := case p_requested_state
    when 'off' then 0
    when 'shadow' then 1
    when 'pilot' then 2
    when 'on' then 3
  end;

  if requested_rank > current_rank + 1 then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unsafe',
      'reason', 'rollout_transition_requires_intermediate_state'
    );
  end if;

  if p_requested_state = 'off' then
    if p_quality_report_id is not null then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'malformed',
        'reason', 'off_cannot_approve_quality_report'
      );
    end if;
  elsif p_requested_state = 'shadow' then
    if p_quality_report_id is not null then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'malformed',
        'reason', 'shadow_cannot_approve_quality_report'
      );
    end if;

    select count(*)::integer into current_set_count
    from catalog_private.recommendation_sets as recommendation_set
    join catalog_private.recommendation_review_policies as policy
      on policy.set_policy_fingerprint = recommendation_set.set_policy_fingerprint
     and policy.status = 'active'
    where recommendation_set.status = 'current';

    if current_set_count = 0 then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'unverifiable',
        'reason', 'current_shadow_set_missing'
      );
    end if;
  else
    if p_quality_report_id is null then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'unsafe',
        'reason', 'eligible_quality_report_required'
      );
    end if;

    select report.*
    into quality_row
    from catalog_private.recommendation_quality_reports as report
    where report.id = p_quality_report_id
    for share;

    if quality_row.id is null or not quality_row.eligible then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'unsafe',
        'reason', 'quality_report_not_eligible'
      );
    end if;

    select policy.*
    into policy_row
    from catalog_private.recommendation_review_policies as policy
    where policy.review_policy_version = quality_row.review_policy_version
      and policy.status = 'active';

    if policy_row.review_policy_version is null
      or quality_row.set_policy_fingerprint <> policy_row.set_policy_fingerprint
    then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'unsafe',
        'reason', 'quality_report_policy_stale'
      );
    end if;

    current_input_fingerprint :=
      catalog_private.recommendation_quality_input_fingerprint(
        quality_row.review_policy_version
      );

    if current_input_fingerprint is null
      or current_input_fingerprint <> quality_row.input_fingerprint
    then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'unsafe',
        'reason', 'quality_report_inputs_stale'
      );
    end if;

    approved_input_fingerprint := quality_row.input_fingerprint;
  end if;

  effective_state := case
    when p_kill_switch then 'off'
    else p_requested_state
  end;

  update catalog_private.recommendation_rollout_controls
  set configured_state = p_requested_state,
      kill_switch = p_kill_switch,
      approved_quality_report_id = case
        when p_requested_state in ('pilot', 'on') then p_quality_report_id
        else null
      end,
      approved_quality_input_fingerprint = case
        when p_requested_state in ('pilot', 'on') then approved_input_fingerprint
        else null
      end,
      revision = control_row.revision + 1,
      updated_by = p_admin_id,
      updated_by_email = normalized_email,
      updated_at = clock_timestamp()
  where singleton;

  insert into public.admin_audit_log (
    admin_id,
    admin_email,
    action,
    resource_type,
    resource_id,
    metadata
  ) values (
    p_admin_id,
    normalized_email,
    'set_recommendation_rollout',
    'recommendation_rollout',
    'singleton',
    jsonb_build_object(
      'requestedState', p_requested_state,
      'effectiveState', effective_state,
      'killSwitch', p_kill_switch,
      'qualityReportId', p_quality_report_id,
      'qualityInputFingerprint', approved_input_fingerprint,
      'revision', control_row.revision + 1
    )
  );

  return jsonb_build_object(
    'outcome', 'updated',
    'configuredState', p_requested_state,
    'effectiveState', effective_state,
    'killSwitch', p_kill_switch,
    'revision', control_row.revision + 1,
    'qualityReportId', p_quality_report_id,
    'qualityInputFingerprint', approved_input_fingerprint
  );
end;
$$;

create or replace function public.set_recommendation_rollout(
  p_requested_state text,
  p_kill_switch boolean,
  p_quality_report_id uuid,
  p_admin_id uuid,
  p_admin_email text
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
  return catalog_private.set_recommendation_rollout(
    p_requested_state,
    p_kill_switch,
    p_quality_report_id,
    p_admin_id,
    p_admin_email
  );
end;
$$;

create or replace function catalog_private.get_recommendation_rollout()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  control_row record;
  quality_row record;
  current_input_fingerprint text;
  quality_current boolean := false;
  current_set_count integer;
  effective_state text;
begin
  perform pg_advisory_xact_lock(hashtext('recommendation-quality'));
  perform pg_advisory_xact_lock(hashtext('recommendation-rollout'));

  select control.*
  into control_row
  from catalog_private.recommendation_rollout_controls as control
  where control.singleton;

  if control_row.singleton is null then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'unverifiable',
      'reason', 'rollout_control_missing'
    );
  end if;

  if control_row.approved_quality_report_id is not null then
    select report.*
    into quality_row
    from catalog_private.recommendation_quality_reports as report
    where report.id = control_row.approved_quality_report_id;

    if quality_row.id is not null and quality_row.eligible then
      current_input_fingerprint :=
        catalog_private.recommendation_quality_input_fingerprint(
          quality_row.review_policy_version
        );
      quality_current := current_input_fingerprint =
        control_row.approved_quality_input_fingerprint;
    end if;
  end if;

  if control_row.configured_state = 'shadow' then
    select count(*)::integer into current_set_count
    from catalog_private.recommendation_sets as recommendation_set
    join catalog_private.recommendation_review_policies as policy
      on policy.set_policy_fingerprint = recommendation_set.set_policy_fingerprint
     and policy.status = 'active'
    where recommendation_set.status = 'current';
  end if;

  effective_state := case
    when control_row.kill_switch then 'off'
    when control_row.configured_state in ('pilot', 'on')
      and not quality_current then 'off'
    when control_row.configured_state = 'shadow'
      and coalesce(current_set_count, 0) = 0 then 'off'
    else control_row.configured_state
  end;

  return jsonb_build_object(
    'outcome', 'read',
    'configuredState', control_row.configured_state,
    'effectiveState', effective_state,
    'killSwitch', control_row.kill_switch,
    'revision', control_row.revision,
    'updatedBy', control_row.updated_by,
    'updatedByEmail', control_row.updated_by_email,
    'updatedAt', control_row.updated_at,
    'qualityReportId', control_row.approved_quality_report_id,
    'qualityInputFingerprint', control_row.approved_quality_input_fingerprint,
    'qualityCurrent', quality_current
  );
end;
$$;

create or replace function public.get_recommendation_rollout()
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
  return catalog_private.get_recommendation_rollout();
end;
$$;

revoke all on function catalog_private.recommendation_quality_input_fingerprint(text)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.lock_recommendation_quality_inputs()
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.assert_recommendation_admin(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.submit_recommendation_review(
  uuid, integer, uuid, text, boolean, boolean, boolean, boolean, boolean, text
) from public, anon, authenticated, service_role;
revoke all on function catalog_private.record_recommendation_ready_read(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.compute_recommendation_quality_report(text)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.list_recommendation_reviews(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function catalog_private.set_recommendation_rollout(
  text, boolean, uuid, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function catalog_private.get_recommendation_rollout()
  from public, anon, authenticated, service_role;

grant execute on function catalog_private.submit_recommendation_review(
  uuid, integer, uuid, text, boolean, boolean, boolean, boolean, boolean, text
) to service_role;
grant execute on function catalog_private.record_recommendation_ready_read(uuid, integer)
  to service_role;
grant execute on function catalog_private.compute_recommendation_quality_report(text)
  to service_role;
grant execute on function catalog_private.list_recommendation_reviews(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text
) to service_role;
grant execute on function catalog_private.set_recommendation_rollout(
  text, boolean, uuid, uuid, text
) to service_role;
grant execute on function catalog_private.get_recommendation_rollout()
  to service_role;

revoke all on function public.submit_recommendation_review(
  uuid, integer, uuid, text, boolean, boolean, boolean, boolean, boolean, text
) from public, anon, authenticated;
revoke all on function public.record_recommendation_ready_read(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.compute_recommendation_quality_report(text)
  from public, anon, authenticated;
revoke all on function public.list_recommendation_reviews(
  uuid, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.list_recommendation_reviews(
  uuid, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.list_recommendation_reviews(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.set_recommendation_rollout(text, boolean, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_recommendation_rollout()
  from public, anon, authenticated;

grant execute on function public.submit_recommendation_review(
  uuid, integer, uuid, text, boolean, boolean, boolean, boolean, boolean, text
) to service_role;
grant execute on function public.record_recommendation_ready_read(uuid, integer)
  to service_role;
grant execute on function public.compute_recommendation_quality_report(text)
  to service_role;
grant execute on function public.list_recommendation_reviews(
  uuid, text, text, text, text, text
) to service_role;
grant execute on function public.list_recommendation_reviews(
  uuid, text, text, text, text, text, text, text, text, text
) to service_role;
grant execute on function public.list_recommendation_reviews(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text
) to service_role;
grant execute on function public.set_recommendation_rollout(text, boolean, uuid, uuid, text)
  to service_role;
grant execute on function public.get_recommendation_rollout()
  to service_role;

notify pgrst, 'reload schema';
