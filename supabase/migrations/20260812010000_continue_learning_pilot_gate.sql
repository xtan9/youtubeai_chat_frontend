-- Server-owned Continue Learning pilot cohort and readiness gate (Issue #357).
--
-- This migration adds no learner rollout and never promotes Recommendation
-- Rollout. Cohort membership is stored as a salted digest, the default cohort
-- state is absent/off, and readiness remains hold until every required gate has
-- independently recorded evidence. The report binds the existing semantic
-- activation and Recommendation Quality fingerprints without manufacturing
-- benchmark, review, delivery, discovery, or catalog-maintenance evidence.

create extension if not exists pgcrypto;

create table catalog_private.continue_learning_pilot_cohorts (
  cohort_key text primary key check (
    cohort_key ~ '^[a-z][a-z0-9_-]{0,63}$'
  ),
  status text not null check (status in ('draft', 'active', 'revoked')),
  member_salt text not null check (member_salt ~ '^[a-f0-9]{64}$'),
  starts_at timestamptz not null,
  ends_at timestamptz,
  revision bigint not null default 0 check (revision >= 0),
  configured_by uuid,
  configured_by_email text check (
    configured_by_email is null
    or (
      btrim(configured_by_email) <> ''
      and configured_by_email = btrim(configured_by_email)
      and char_length(configured_by_email) <= 320
    )
  ),
  configured_at timestamptz not null default clock_timestamp(),
  check (ends_at is null or ends_at > starts_at)
);

create unique index continue_learning_one_active_cohort_idx
  on catalog_private.continue_learning_pilot_cohorts ((status))
  where status = 'active';

create table catalog_private.continue_learning_pilot_members (
  cohort_key text not null references
    catalog_private.continue_learning_pilot_cohorts(cohort_key)
    on delete cascade,
  learner_hash text not null check (learner_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('eligible', 'revoked')),
  added_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  primary key (cohort_key, learner_hash),
  check ((status = 'eligible' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null))
);

create index continue_learning_pilot_members_status_idx
  on catalog_private.continue_learning_pilot_members (cohort_key, status);

alter table catalog_private.continue_learning_pilot_cohorts enable row level security;
alter table catalog_private.continue_learning_pilot_members enable row level security;

revoke all on table catalog_private.continue_learning_pilot_cohorts
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.continue_learning_pilot_members
  from public, anon, authenticated, service_role;

create or replace function catalog_private.continue_learning_pilot_member_hash(
  p_learner_id uuid,
  p_member_salt text
)
returns text
language sql
immutable
security definer
set search_path = extensions, public, pg_temp
as $$
  select encode(
    digest(p_learner_id::text || ':' || p_member_salt, 'sha256'),
    'hex'
  );
$$;

create or replace function catalog_private.continue_learning_pilot_readiness()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  rollout jsonb;
  semantic_evaluation_ok boolean := false;
  semantic_approval_ok boolean := false;
  quality_report_ok boolean := false;
  cohort_ok boolean := false;
  active_cohort_key text;
  active_cohort_members integer := 0;
  semantic_fingerprint text;
  semantic_model text;
  semantic_approval_ref text;
  quality_report_id text;
  quality_input_fingerprint text;
  gates jsonb;
  decision text;
begin
  rollout := catalog_private.get_recommendation_rollout();

  select
    evaluation.evaluation_fingerprint,
    evaluation.model_identifier,
    approval.approval_ref,
    true,
    true
  into
    semantic_fingerprint,
    semantic_model,
    semantic_approval_ref,
    semantic_evaluation_ok,
    semantic_approval_ok
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
    and registry.profile_schema_version = 'semantic-profile-v1'
    and registry.prompt_version = 'semantic-profile-prompt-v1'
  limit 1;

  quality_report_id := rollout->>'qualityReportId';
  quality_input_fingerprint := rollout->>'qualityInputFingerprint';
  quality_report_ok := rollout->>'qualityCurrent' = 'true'
    and quality_report_id ~
      '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'
    and quality_input_fingerprint ~ '^[a-f0-9]{64}$';

  select cohort.cohort_key, count(member.learner_hash)::integer
  into active_cohort_key, active_cohort_members
  from catalog_private.continue_learning_pilot_cohorts as cohort
  left join catalog_private.continue_learning_pilot_members as member
    on member.cohort_key = cohort.cohort_key
   and member.status = 'eligible'
  where cohort.status in ('draft', 'active')
    and cohort.starts_at <= statement_timestamp()
    and (cohort.ends_at is null or cohort.ends_at > statement_timestamp())
  group by cohort.cohort_key, cohort.status, cohort.configured_at
  order by case when cohort.status = 'active' then 0 else 1 end,
    cohort.configured_at desc,
    cohort.cohort_key
  limit 1;
  cohort_ok := active_cohort_key is not null and active_cohort_members > 0;

  gates := jsonb_build_array(
    jsonb_build_object(
      'id', 'semantic_evaluation',
      'status', case when semantic_evaluation_ok then 'passed' else 'hold' end,
      'failureClass', case when semantic_evaluation_ok then null else 'evaluation_missing' end,
      'evaluationFingerprint', case when semantic_evaluation_ok then semantic_fingerprint else null end,
      'modelIdentifier', case when semantic_evaluation_ok then semantic_model else null end
    ),
    jsonb_build_object(
      'id', 'semantic_human_approval',
      'status', case when semantic_approval_ok then 'passed' else 'hold' end,
      'failureClass', case when semantic_approval_ok then null else 'approval_missing' end,
      'approvalRef', case when semantic_approval_ok then semantic_approval_ref else null end
    ),
    jsonb_build_object(
      'id', 'candidate_pairs',
      'status', 'hold',
      'failureClass', 'dependency_open'
    ),
    jsonb_build_object(
      'id', 'assessment_sets',
      'status', 'hold',
      'failureClass', 'dependency_open'
    ),
    jsonb_build_object(
      'id', 'quality_report',
      'status', case when quality_report_ok then 'passed' else 'hold' end,
      'failureClass', case when quality_report_ok then null else 'quality_evidence_missing' end,
      'qualityReportId', case when quality_report_ok then quality_report_id else null end,
      'qualityInputFingerprint', case when quality_report_ok then quality_input_fingerprint else null end
    ),
    jsonb_build_object(
      'id', 'cohort',
      'status', case when cohort_ok then 'passed' else 'hold' end,
      'failureClass', case when cohort_ok then null else 'cohort_unconfigured' end,
      'memberCount', active_cohort_members
    ),
    jsonb_build_object('id', 'delivery', 'status', 'hold', 'failureClass', 'evidence_missing'),
    jsonb_build_object('id', 'feedback_analytics', 'status', 'hold', 'failureClass', 'evidence_missing'),
    jsonb_build_object('id', 'discovery', 'status', 'hold', 'failureClass', 'dependency_open'),
    jsonb_build_object('id', 'catalog_maintenance', 'status', 'hold', 'failureClass', 'dependency_open'),
    jsonb_build_object('id', 'browser_verification', 'status', 'hold', 'failureClass', 'evidence_missing'),
    jsonb_build_object('id', 'migration_security', 'status', 'hold', 'failureClass', 'evidence_missing'),
    jsonb_build_object('id', 'concurrency', 'status', 'hold', 'failureClass', 'evidence_missing'),
    jsonb_build_object('id', 'performance', 'status', 'hold', 'failureClass', 'evidence_missing'),
    jsonb_build_object('id', 'operations_cost', 'status', 'hold', 'failureClass', 'evidence_missing')
  );

  if not exists (
    select 1
    from jsonb_array_elements(gates) as gate
    where gate->>'status' <> 'passed'
  ) then
    decision := 'eligible_for_owner_review';
  else
    decision := 'hold';
  end if;

  return jsonb_build_object(
    'outcome', 'read',
    'schemaVersion', 1,
    'decision', decision,
    'pilotFlag', 'off',
    'configuredState', coalesce(rollout->>'configuredState', 'off'),
    'effectiveState', coalesce(rollout->>'effectiveState', 'off'),
    'killSwitch', coalesce((rollout->>'killSwitch')::boolean, true),
    'cohortKey', active_cohort_key,
    'gates', gates
  );
end;
$$;

create or replace function catalog_private.continue_learning_pilot_eligibility(
  p_learner_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  cohort_row record;
  learner_hash_value text;
begin
  if p_learner_id is null then
    return jsonb_build_object('eligible', false, 'reason', 'invalid_learner');
  end if;

  select cohort.*
  into cohort_row
  from catalog_private.continue_learning_pilot_cohorts as cohort
  where cohort.status = 'active'
    and cohort.starts_at <= statement_timestamp()
    and (cohort.ends_at is null or cohort.ends_at > statement_timestamp())
  limit 1;

  if cohort_row.cohort_key is null then
    return jsonb_build_object('eligible', false, 'reason', 'cohort_unconfigured');
  end if;

  learner_hash_value := catalog_private.continue_learning_pilot_member_hash(
    p_learner_id,
    cohort_row.member_salt
  );
  if not exists (
    select 1
    from catalog_private.continue_learning_pilot_members as member
    where member.cohort_key = cohort_row.cohort_key
      and member.learner_hash = learner_hash_value
      and member.status = 'eligible'
  ) then
    return jsonb_build_object('eligible', false, 'reason', 'cohort_member_not_eligible');
  end if;

  return jsonb_build_object(
    'eligible', true,
    'cohortKey', cohort_row.cohort_key
  );
end;
$$;

create or replace function catalog_private.configure_continue_learning_pilot_cohort(
  p_cohort_key text,
  p_status text,
  p_member_learner_ids uuid[],
  p_admin_id uuid,
  p_admin_email text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  cohort_row record;
  normalized_email text := lower(btrim(coalesce(p_admin_email, '')));
  readiness jsonb;
  member_count integer := coalesce(array_length(p_member_learner_ids, 1), 0);
begin
  if p_cohort_key is null
    or p_cohort_key !~ '^[a-z][a-z0-9_-]{0,63}$'
    or p_status is null
    or p_status not in ('draft', 'active', 'revoked')
    or p_starts_at is null
    or (p_ends_at is not null and p_ends_at <= p_starts_at)
    or (p_status <> 'revoked' and member_count = 0)
  then
    return jsonb_build_object(
      'outcome', 'rejected',
      'failureClass', 'malformed',
      'reason', 'cohort_configuration_contract'
    );
  end if;

  perform catalog_private.assert_recommendation_admin(p_admin_id, normalized_email);
  perform pg_advisory_xact_lock(hashtext('continue-learning-pilot-cohort'));

  select cohort.*
  into cohort_row
  from catalog_private.continue_learning_pilot_cohorts as cohort
  where cohort.cohort_key = p_cohort_key
  for update;

  if p_status = 'active' then
    readiness := catalog_private.continue_learning_pilot_readiness();
    if readiness->>'decision' <> 'eligible_for_owner_review' then
      return jsonb_build_object(
        'outcome', 'rejected',
        'failureClass', 'unsafe',
        'reason', 'readiness_hold'
      );
    end if;
  end if;

  if cohort_row.cohort_key is null then
    insert into catalog_private.continue_learning_pilot_cohorts (
      cohort_key,
      status,
      member_salt,
      starts_at,
      ends_at,
      configured_by,
      configured_by_email
    ) values (
      p_cohort_key,
      p_status,
      encode(gen_random_bytes(32), 'hex'),
      p_starts_at,
      p_ends_at,
      p_admin_id,
      normalized_email
    ) returning * into cohort_row;
  else
    update catalog_private.continue_learning_pilot_cohorts
    set status = p_status,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        revision = cohort_row.revision + 1,
        configured_by = p_admin_id,
        configured_by_email = normalized_email,
        configured_at = clock_timestamp()
    where cohort_key = p_cohort_key
    returning * into cohort_row;
  end if;

  if p_status = 'revoked' then
    update catalog_private.continue_learning_pilot_members
    set status = 'revoked', revoked_at = clock_timestamp()
    where cohort_key = p_cohort_key and status = 'eligible';
  else
    update catalog_private.continue_learning_pilot_members as member
    set status = 'revoked', revoked_at = clock_timestamp()
    where member.cohort_key = p_cohort_key
      and member.status = 'eligible'
      and not exists (
        select 1
        from unnest(p_member_learner_ids) as learner(learner_id)
        where member.learner_hash = catalog_private.continue_learning_pilot_member_hash(
          learner.learner_id,
          cohort_row.member_salt
        )
      );

    insert into catalog_private.continue_learning_pilot_members (
      cohort_key,
      learner_hash,
      status,
      revoked_at
    )
    select
      p_cohort_key,
      catalog_private.continue_learning_pilot_member_hash(
        learner.learner_id,
        cohort_row.member_salt
      ),
      'eligible',
      null
    from unnest(p_member_learner_ids) as learner(learner_id)
    where learner.learner_id is not null
    on conflict (cohort_key, learner_hash) do update
      set status = 'eligible', revoked_at = null;
  end if;

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
    'configure_continue_learning_pilot_cohort',
    'continue_learning_pilot_cohort',
    p_cohort_key,
    jsonb_build_object(
      'status', p_status,
      'memberCount', member_count,
      'revision', cohort_row.revision
    )
  );

  return jsonb_build_object(
    'outcome', 'configured',
    'cohortKey', p_cohort_key,
    'status', p_status,
    'revision', cohort_row.revision,
    'memberCount', member_count
  );
end;
$$;

create or replace function public.get_continue_learning_pilot_readiness()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.continue_learning_pilot_readiness();
end;
$$;

create or replace function public.get_continue_learning_pilot_eligibility(
  p_learner_id uuid
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
  return catalog_private.continue_learning_pilot_eligibility(p_learner_id);
end;
$$;

create or replace function public.configure_continue_learning_pilot_cohort(
  p_cohort_key text,
  p_status text,
  p_member_learner_ids uuid[],
  p_admin_id uuid,
  p_admin_email text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
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
  return catalog_private.configure_continue_learning_pilot_cohort(
    p_cohort_key,
    p_status,
    p_member_learner_ids,
    p_admin_id,
    p_admin_email,
    p_starts_at,
    p_ends_at
  );
end;
$$;

revoke all on function catalog_private.continue_learning_pilot_member_hash(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.continue_learning_pilot_readiness()
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.continue_learning_pilot_eligibility(uuid)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.configure_continue_learning_pilot_cohort(
  text, text, uuid[], uuid, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.get_continue_learning_pilot_readiness()
  from public, anon, authenticated;
revoke all on function public.get_continue_learning_pilot_eligibility(uuid)
  from public, anon, authenticated;
revoke all on function public.configure_continue_learning_pilot_cohort(
  text, text, uuid[], uuid, text, timestamptz, timestamptz
) from public, anon, authenticated;

grant execute on function catalog_private.continue_learning_pilot_readiness()
  to service_role;
grant execute on function catalog_private.continue_learning_pilot_eligibility(uuid)
  to service_role;
grant execute on function catalog_private.configure_continue_learning_pilot_cohort(
  text, text, uuid[], uuid, text, timestamptz, timestamptz
) to service_role;

grant execute on function public.get_continue_learning_pilot_readiness()
  to service_role;
grant execute on function public.get_continue_learning_pilot_eligibility(uuid)
  to service_role;
grant execute on function public.configure_continue_learning_pilot_cohort(
  text, text, uuid[], uuid, text, timestamptz, timestamptz
) to service_role;

notify pgrst, 'reload schema';
