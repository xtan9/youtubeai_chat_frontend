-- Semantic Profile activation gate (Issue #349).
--
-- Generation and retrieval remain dormant until an operator records the
-- versioned Gateway evaluation and human approval that authorize one model /
-- schema / prompt tuple.  The registry is private and empty after migration.

create table catalog_private.semantic_profile_evaluations (
  evaluation_fingerprint text primary key check (
    evaluation_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  model_identifier text not null check (
    btrim(model_identifier) <> '' and model_identifier = btrim(model_identifier)
  ),
  profile_schema_version text not null check (
    profile_schema_version = 'semantic-profile-v1'
  ),
  prompt_version text not null check (
    prompt_version = 'semantic-profile-prompt-v1'
  ),
  gateway_provider text not null check (
    btrim(gateway_provider) <> '' and gateway_provider = btrim(gateway_provider)
  ),
  metrics jsonb not null check (
    jsonb_typeof(metrics) = 'object'
    and metrics ?& array[
      'schema_validity_rate',
      'multilingual_concept_normalization',
      'useful_neighbor_recall',
      'false_neighbor_rejection',
      'latency_ms_p95',
      'token_cost_totals',
      'retry_dead_letter_behavior',
      'representative_source_coverage'
    ]
    and jsonb_typeof(metrics -> 'schema_validity_rate') = 'number'
    and (metrics ->> 'schema_validity_rate')::numeric between 0 and 1
    and jsonb_typeof(metrics -> 'multilingual_concept_normalization') = 'number'
    and (metrics ->> 'multilingual_concept_normalization')::numeric between 0 and 1
    and jsonb_typeof(metrics -> 'useful_neighbor_recall') = 'number'
    and (metrics ->> 'useful_neighbor_recall')::numeric between 0 and 1
    and jsonb_typeof(metrics -> 'false_neighbor_rejection') = 'number'
    and (metrics ->> 'false_neighbor_rejection')::numeric between 0 and 1
    and jsonb_typeof(metrics -> 'latency_ms_p95') = 'number'
    and (metrics ->> 'latency_ms_p95')::numeric >= 0
    and jsonb_typeof(metrics -> 'token_cost_totals') = 'object'
    and jsonb_typeof(metrics -> 'retry_dead_letter_behavior') in ('string', 'object')
    and jsonb_typeof(metrics -> 'representative_source_coverage') = 'number'
    and (metrics ->> 'representative_source_coverage')::numeric between 0 and 1
  ),
  status text not null check (status in ('passed', 'revoked')),
  evaluated_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

create table catalog_private.semantic_profile_human_approvals (
  approval_ref text primary key check (
    approval_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
  ),
  evaluation_fingerprint text not null references
    catalog_private.semantic_profile_evaluations(evaluation_fingerprint),
  model_identifier text not null check (
    btrim(model_identifier) <> '' and model_identifier = btrim(model_identifier)
  ),
  profile_schema_version text not null check (
    profile_schema_version = 'semantic-profile-v1'
  ),
  prompt_version text not null check (
    prompt_version = 'semantic-profile-prompt-v1'
  ),
  approved_by text not null check (
    btrim(approved_by) <> '' and approved_by = btrim(approved_by)
  ),
  decision text not null check (decision in ('approved', 'revoked')),
  approved_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

alter table catalog_private.semantic_profile_evaluations enable row level security;
alter table catalog_private.semantic_profile_human_approvals enable row level security;
revoke all on table catalog_private.semantic_profile_evaluations
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.semantic_profile_human_approvals
  from public, anon, authenticated, service_role;

create table catalog_private.semantic_profile_model_registry (
  id uuid primary key default gen_random_uuid(),
  model_identifier text not null check (
    btrim(model_identifier) <> '' and model_identifier = btrim(model_identifier)
  ),
  profile_schema_version text not null check (
    profile_schema_version = 'semantic-profile-v1'
  ),
  prompt_version text not null check (
    prompt_version = 'semantic-profile-prompt-v1'
  ),
  evaluation_fingerprint text not null check (
    evaluation_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  human_approval_ref text not null check (
    human_approval_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
  ),
  status text not null check (status in ('active', 'retired')),
  activated_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (
    model_identifier,
    profile_schema_version,
    prompt_version,
    evaluation_fingerprint,
    human_approval_ref
  )
);

alter table catalog_private.semantic_profile_requests
  add column generator_model text,
  add column prompt_version text,
  add column evaluation_fingerprint text;
alter table catalog_private.semantic_profile_requests
  add constraint semantic_profile_request_generator_model_check check (
    generator_model is null
    or (btrim(generator_model) <> '' and generator_model = btrim(generator_model))
  ),
  add constraint semantic_profile_request_prompt_version_check check (
    prompt_version is null or prompt_version = 'semantic-profile-prompt-v1'
  ),
  add constraint semantic_profile_request_evaluation_fingerprint_check check (
    evaluation_fingerprint is null
    or evaluation_fingerprint ~ '^[a-f0-9]{64}$'
  );
alter table catalog_private.semantic_profile_versions
  add column evaluation_fingerprint text;
alter table catalog_private.semantic_profile_versions
  add constraint semantic_profile_version_evaluation_fingerprint_check check (
    evaluation_fingerprint is null
    or evaluation_fingerprint ~ '^[a-f0-9]{64}$'
  );

create unique index semantic_profile_one_active_model_idx
  on catalog_private.semantic_profile_model_registry (
    profile_schema_version,
    prompt_version
  )
  where status = 'active';

alter table catalog_private.semantic_profile_model_registry enable row level security;
revoke all on table catalog_private.semantic_profile_model_registry
  from public, anon, authenticated, service_role;

create or replace function catalog_private.semantic_profile_activation_is_available(
  p_model_identifier text,
  p_profile_schema_version text,
  p_prompt_version text,
  p_evaluation_fingerprint text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
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
    where registry.model_identifier = btrim(p_model_identifier)
      and registry.profile_schema_version = p_profile_schema_version
      and registry.prompt_version = p_prompt_version
      and registry.evaluation_fingerprint = p_evaluation_fingerprint
      and registry.status = 'active'
  );
$$;

create or replace function public.activate_semantic_profile_model(
  p_model_identifier text,
  p_profile_schema_version text,
  p_prompt_version text,
  p_evaluation_fingerprint text,
  p_human_approval_ref text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  activation_id uuid;
begin
  if btrim(coalesce(p_model_identifier, '')) = ''
    or coalesce(p_profile_schema_version, '') <> 'semantic-profile-v1'
    or coalesce(p_prompt_version, '') <> 'semantic-profile-prompt-v1'
    or coalesce(p_evaluation_fingerprint, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_human_approval_ref, '') !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'
  then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'activation_contract');
  end if;
  if not exists (
    select 1
    from catalog_private.semantic_profile_evaluations as evaluation
    join catalog_private.semantic_profile_human_approvals as approval
      on approval.evaluation_fingerprint = evaluation.evaluation_fingerprint
     and approval.model_identifier = evaluation.model_identifier
     and approval.profile_schema_version = evaluation.profile_schema_version
     and approval.prompt_version = evaluation.prompt_version
     and approval.decision = 'approved'
     and approval.approval_ref = p_human_approval_ref
    where evaluation.evaluation_fingerprint = p_evaluation_fingerprint
      and evaluation.model_identifier = btrim(p_model_identifier)
      and evaluation.profile_schema_version = p_profile_schema_version
      and evaluation.prompt_version = p_prompt_version
      and evaluation.status = 'passed'
  ) then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'evaluation_or_approval_missing');
  end if;

  perform pg_advisory_xact_lock(hashtext('semantic-profile-activation'));

  update catalog_private.semantic_profile_model_registry
  set status = 'retired', retired_at = clock_timestamp()
  where profile_schema_version = p_profile_schema_version
    and prompt_version = p_prompt_version
    and status = 'active';

  insert into catalog_private.semantic_profile_model_registry (
    model_identifier,
    profile_schema_version,
    prompt_version,
    evaluation_fingerprint,
    human_approval_ref,
    status,
    activated_at,
    retired_at
  ) values (
    btrim(p_model_identifier),
    p_profile_schema_version,
    p_prompt_version,
    p_evaluation_fingerprint,
    p_human_approval_ref,
    'active',
    clock_timestamp(),
    null
  )
  on conflict (
    model_identifier,
    profile_schema_version,
    prompt_version,
    evaluation_fingerprint,
    human_approval_ref
  ) do update set
    status = 'active',
    activated_at = clock_timestamp(),
    retired_at = null
  returning id into activation_id;

  update catalog_private.semantic_profile_requests
  set generator_model = btrim(p_model_identifier),
      prompt_version = p_prompt_version,
      evaluation_fingerprint = p_evaluation_fingerprint
  where status = 'pending';

  return jsonb_build_object(
    'outcome', 'active',
    'activationId', activation_id,
    'modelIdentifier', btrim(p_model_identifier),
    'profileSchemaVersion', p_profile_schema_version,
    'promptVersion', p_prompt_version
  );
end;
$$;

create or replace function public.retire_semantic_profile_model(
  p_model_identifier text,
  p_profile_schema_version text default 'semantic-profile-v1',
  p_prompt_version text default 'semantic-profile-prompt-v1'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  retired_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('semantic-profile-activation'));
  update catalog_private.semantic_profile_model_registry
  set status = 'retired', retired_at = clock_timestamp()
  where model_identifier = btrim(p_model_identifier)
    and profile_schema_version = p_profile_schema_version
    and prompt_version = p_prompt_version
    and status = 'active';
  get diagnostics retired_count = row_count;
  return jsonb_build_object(
    'outcome', case when retired_count = 1 then 'retired' else 'already_retired' end,
    'retiredCount', retired_count
  );
end;
$$;

create or replace function catalog_private.enqueue_semantic_profile_request(
  p_video_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  video_row record;
  active_registry record;
  transcript_text text;
  fingerprint text;
  request_id uuid;
  stale_request_id uuid;
  enqueued_message_id bigint;
  existing_request record;
begin
  perform pg_advisory_xact_lock(hashtext('semantic-profile-activation'));
  select semantic_profile_model_registry.model_identifier,
         semantic_profile_model_registry.profile_schema_version,
         semantic_profile_model_registry.prompt_version,
         semantic_profile_model_registry.evaluation_fingerprint
  into active_registry
  from catalog_private.semantic_profile_model_registry
  join catalog_private.semantic_profile_evaluations as evaluation
    on evaluation.evaluation_fingerprint = semantic_profile_model_registry.evaluation_fingerprint
   and evaluation.model_identifier = semantic_profile_model_registry.model_identifier
   and evaluation.profile_schema_version = semantic_profile_model_registry.profile_schema_version
   and evaluation.prompt_version = semantic_profile_model_registry.prompt_version
   and evaluation.status = 'passed'
  join catalog_private.semantic_profile_human_approvals as approval
    on approval.approval_ref = semantic_profile_model_registry.human_approval_ref
   and approval.evaluation_fingerprint = semantic_profile_model_registry.evaluation_fingerprint
   and approval.model_identifier = semantic_profile_model_registry.model_identifier
   and approval.profile_schema_version = semantic_profile_model_registry.profile_schema_version
   and approval.prompt_version = semantic_profile_model_registry.prompt_version
   and approval.decision = 'approved'
  where semantic_profile_model_registry.status = 'active'
    and semantic_profile_model_registry.profile_schema_version = 'semantic-profile-v1'
    and semantic_profile_model_registry.prompt_version = 'semantic-profile-prompt-v1'
  limit 1;
  if active_registry.model_identifier is null then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'model_inactive');
  end if;

  select
    video.id,
    video.title,
    coalesce(nullif(video.default_language, ''), nullif(video.language, ''), 'en') as source_language,
    video.catalog_state,
    transcript.segments
  into video_row
  from public.videos as video
  left join public.video_transcripts as transcript on transcript.video_id = video.id
  where video.id = p_video_id;

  if video_row.id is null or video_row.catalog_state is distinct from 'active'
    or video_row.segments is null or jsonb_typeof(video_row.segments) <> 'array'
  then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'profile_evidence_unavailable');
  end if;

  select coalesce(string_agg(nullif(segment.value ->> 'text', ''), ' ' order by segment.ordinality), '')
  into transcript_text
  from jsonb_array_elements(video_row.segments) with ordinality as segment(value, ordinality);
  if btrim(coalesce(transcript_text, '')) = '' then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'profile_evidence_unavailable');
  end if;

  fingerprint := catalog_private.semantic_profile_fingerprint(
    video_row.title, video_row.source_language, transcript_text
  );

  select request.* into existing_request
  from catalog_private.semantic_profile_requests as request
  where request.video_id = p_video_id
    and request.profile_schema_version = 'semantic-profile-v1'
    and request.content_fingerprint = fingerprint;
  if existing_request.id is not null then
    if existing_request.status in ('pending', 'completed')
      and existing_request.generator_model = active_registry.model_identifier
      and existing_request.prompt_version = active_registry.prompt_version
      and existing_request.evaluation_fingerprint = active_registry.evaluation_fingerprint
    then
      return jsonb_build_object('outcome', 'already_recorded', 'status', existing_request.status);
    end if;
    if existing_request.status = 'pending' then
      update catalog_private.semantic_profile_requests
      set generator_model = active_registry.model_identifier,
          prompt_version = active_registry.prompt_version,
          evaluation_fingerprint = active_registry.evaluation_fingerprint
      where id = existing_request.id;
      return jsonb_build_object('outcome', 'already_recorded', 'status', 'pending');
    end if;
    if existing_request.status = 'processing' then
      update catalog_private.semantic_profile_requests
      set status = 'obsolete'
      where id = existing_request.id;
    end if;
    update catalog_private.semantic_profile_requests
    set status = 'pending',
        attempts = 0,
        last_failure_code = null,
        claimed_at = null,
        completed_at = null,
        generator_model = active_registry.model_identifier,
        prompt_version = active_registry.prompt_version,
        evaluation_fingerprint = active_registry.evaluation_fingerprint
    where id = existing_request.id;
    request_id := existing_request.id;
  end if;

  for stale_request_id in
    select request.id
    from catalog_private.semantic_profile_requests as request
    where request.video_id = p_video_id
      and request.profile_schema_version = 'semantic-profile-v1'
      and request.content_fingerprint <> fingerprint
      and request.status in ('pending', 'processing')
    for update
  loop
    update catalog_private.semantic_profile_requests
    set status = 'obsolete'
    where id = stale_request_id;
  end loop;

  if request_id is null then
    begin
      insert into catalog_private.semantic_profile_requests (
        video_id, profile_schema_version, source_language, content_fingerprint,
        generator_model, prompt_version, evaluation_fingerprint
      ) values (
        p_video_id, 'semantic-profile-v1', video_row.source_language, fingerprint,
        active_registry.model_identifier, active_registry.prompt_version,
        active_registry.evaluation_fingerprint
      ) returning id into request_id;
    exception when unique_violation then
      return jsonb_build_object('outcome', 'already_queued');
    end;
  end if;

  select send into enqueued_message_id
  from pgmq.send(
    'semantic_profile',
    jsonb_build_object(
      'request_id', request_id,
      'video_id', video_row.id,
      'title', left(coalesce(video_row.title, ''), 300),
      'source_language', left(video_row.source_language, 35),
      'transcript', left(transcript_text, 32000),
      'content_fingerprint', fingerprint,
      'profile_schema_version', 'semantic-profile-v1'
    ),
    0
  );

  update catalog_private.semantic_profile_requests
  set queue_message_id = enqueued_message_id
  where id = request_id;
  return jsonb_build_object(
    'outcome', 'enqueued', 'requestId', request_id, 'queueMessageId', enqueued_message_id
  );
end;
$$;

-- Replace the old two-argument bridge.  A worker must name the configured
-- model, so a stale caller cannot reserve budget or invoke the Gateway after
-- the approved tuple has changed.
drop function public.begin_semantic_profile_generation(uuid, bigint);
drop function catalog_private.begin_semantic_profile_generation(uuid, bigint);

create or replace function catalog_private.begin_semantic_profile_generation(
  p_request_id uuid,
  p_estimated_micro_usd bigint,
  p_generator_model text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_row record;
  budget_row catalog_private.semantic_profile_processing_budget%rowtype;
begin
  select * into request_row
  from catalog_private.semantic_profile_requests
  where id = p_request_id
  for update;
  if request_row.id is null then
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'request_missing');
  end if;
  if request_row.status <> 'pending' then
    return jsonb_build_object('outcome', request_row.status);
  end if;
  if request_row.generator_model is distinct from btrim(p_generator_model)
    or request_row.prompt_version is distinct from 'semantic-profile-prompt-v1'
  then
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'activation_superseded');
  end if;
  if not catalog_private.semantic_profile_activation_is_available(
    p_generator_model,
    request_row.profile_schema_version,
    'semantic-profile-prompt-v1',
    request_row.evaluation_fingerprint
  ) then
    return jsonb_build_object('outcome', 'model_inactive');
  end if;
  if not exists (
    select 1 from public.videos
    where id = request_row.video_id and catalog_state = 'active'
  ) then
    update catalog_private.semantic_profile_requests
    set status = 'obsolete'
    where id = p_request_id;
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'video_inactive');
  end if;

  insert into catalog_private.semantic_profile_processing_budget (budget_day)
  values (current_date)
  on conflict (budget_day) do nothing;
  select * into budget_row
  from catalog_private.semantic_profile_processing_budget
  where budget_day = current_date
  for update;

  if budget_row.starts >= budget_row.max_starts
    or budget_row.reserved_micro_usd + greatest(coalesce(p_estimated_micro_usd, 0), 0)
      > budget_row.max_micro_usd
  then
    return jsonb_build_object('outcome', 'budget_exhausted');
  end if;

  update catalog_private.semantic_profile_processing_budget
  set starts = starts + 1,
      reserved_micro_usd = reserved_micro_usd + greatest(coalesce(p_estimated_micro_usd, 0), 0),
      updated_at = clock_timestamp()
  where budget_day = current_date;
  update catalog_private.semantic_profile_requests
  set status = 'processing', attempts = attempts + 1, claimed_at = clock_timestamp()
  where id = p_request_id;
  return jsonb_build_object(
    'outcome', 'started',
    'modelIdentifier', btrim(p_generator_model)
  );
end;
$$;

create or replace function public.begin_semantic_profile_generation(
  p_request_id uuid,
  p_estimated_micro_usd bigint,
  p_generator_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return catalog_private.begin_semantic_profile_generation(
    p_request_id, p_estimated_micro_usd, p_generator_model
  );
end;
$$;

-- Recheck the approved tuple immediately before persistence.  A retirement or
-- kill switch during a Gateway call therefore produces no active Profile.
create or replace function catalog_private.complete_semantic_profile_work(
  p_msg_id bigint,
  p_request_id uuid,
  p_content_fingerprint text,
  p_profile jsonb,
  p_topic_keys text[],
  p_core_concept_keys text[],
  p_prerequisite_concept_keys text[],
  p_application_concept_keys text[],
  p_counterpoint_concept_keys text[],
  p_difficulty text,
  p_generator_model text,
  p_prompt_version text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_row record;
  archived boolean;
begin
  select * into request_row
  from catalog_private.semantic_profile_requests
  where id = p_request_id
  for update;
  if request_row.id is null then
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'request_missing');
  end if;
  if request_row.status in ('obsolete', 'exhausted') then
    select pgmq.archive('semantic_profile', p_msg_id) into archived;
    return jsonb_build_object('outcome', request_row.status);
  end if;
  if request_row.status = 'completed' then
    return jsonb_build_object('outcome', 'already_completed');
  end if;
  if request_row.generator_model is distinct from btrim(p_generator_model)
    or request_row.prompt_version is distinct from p_prompt_version
  then
    select pgmq.archive('semantic_profile', p_msg_id) into archived;
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'activation_superseded');
  end if;
  if not catalog_private.semantic_profile_activation_is_available(
    p_generator_model,
    request_row.profile_schema_version,
    p_prompt_version,
    request_row.evaluation_fingerprint
  ) then
    update catalog_private.semantic_profile_requests
    set status = 'obsolete'
    where id = p_request_id;
    select pgmq.archive('semantic_profile', p_msg_id) into archived;
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'model_inactive');
  end if;
  if not exists (
    select 1
    from public.videos
    where id = request_row.video_id
      and catalog_state = 'active'
  ) then
    update catalog_private.semantic_profile_requests
    set status = 'obsolete'
    where id = p_request_id;
    select pgmq.archive('semantic_profile', p_msg_id) into archived;
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'video_inactive');
  end if;
  if request_row.status <> 'processing'
    or request_row.content_fingerprint <> p_content_fingerprint
    or (p_profile ->> 'sourceLanguage') <> request_row.source_language
    or p_profile is null
    or jsonb_typeof(p_profile) <> 'object'
    or coalesce(array_length(p_topic_keys, 1), 0) < 1
    or coalesce(array_length(p_core_concept_keys, 1), 0) < 2
    or p_difficulty not in ('beginner', 'intermediate', 'advanced', 'mixed')
  then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'profile_contract');
  end if;

  update catalog_private.semantic_profile_versions
  set status = 'superseded', superseded_at = clock_timestamp()
  where video_id = request_row.video_id
    and profile_schema_version = request_row.profile_schema_version
    and status = 'active';

  insert into catalog_private.semantic_profile_versions (
    video_id, profile_schema_version, content_fingerprint, generator_model,
    prompt_version, evaluation_fingerprint, source_language, topics, core_concepts,
    topic_keys, core_concept_keys,
    prerequisite_concept_keys, application_concept_keys, counterpoint_concept_keys,
    difficulty, profile
  )
  select
    request_row.video_id,
    request_row.profile_schema_version,
    p_content_fingerprint,
    p_generator_model,
    p_prompt_version,
    request_row.evaluation_fingerprint,
    request_row.source_language,
    p_profile -> 'topics',
    p_profile -> 'coreConcepts',
    coalesce(p_topic_keys, '{}'),
    coalesce(p_core_concept_keys, '{}'),
    coalesce(p_prerequisite_concept_keys, '{}'),
    coalesce(p_application_concept_keys, '{}'),
    coalesce(p_counterpoint_concept_keys, '{}'),
    p_difficulty,
    p_profile;

  update catalog_private.semantic_profile_requests
  set status = 'completed', completed_at = clock_timestamp()
  where id = p_request_id;
  select pgmq.archive('semantic_profile', p_msg_id) into archived;
  return jsonb_build_object('outcome', 'completed');
end;
$$;

-- The private function above is the implementation; preserve the existing
-- service-role bridge while replacing its dependency with the gated body.
create or replace function public.complete_semantic_profile_work(
  p_msg_id bigint,
  p_request_id uuid,
  p_content_fingerprint text,
  p_profile jsonb,
  p_topic_keys text[],
  p_core_concept_keys text[],
  p_prerequisite_concept_keys text[],
  p_application_concept_keys text[],
  p_counterpoint_concept_keys text[],
  p_difficulty text,
  p_generator_model text,
  p_prompt_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return catalog_private.complete_semantic_profile_work(
    p_msg_id, p_request_id, p_content_fingerprint, p_profile, p_topic_keys,
    p_core_concept_keys, p_prerequisite_concept_keys, p_application_concept_keys,
    p_counterpoint_concept_keys, p_difficulty, p_generator_model, p_prompt_version
  );
end;
$$;

-- Existing triggers and the manual service bridge must not enqueue work while
-- the registry is empty.  Pending rows from an older deployment are still
-- safe: the gated begin function defers them until an approved tuple exists.
create or replace function catalog_private.queue_semantic_profile_on_catalog_admission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.catalog_state = 'active'
    and old.catalog_state is distinct from 'active'
    and exists (
      select 1 from catalog_private.semantic_profile_model_registry
      where profile_schema_version = 'semantic-profile-v1'
        and prompt_version = 'semantic-profile-prompt-v1'
        and status = 'active'
    )
  then
    perform catalog_private.enqueue_semantic_profile_request(new.id);
  end if;
  return new;
end;
$$;

create or replace function catalog_private.queue_semantic_profile_on_transcript()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from catalog_private.semantic_profile_model_registry
    where profile_schema_version = 'semantic-profile-v1'
      and prompt_version = 'semantic-profile-prompt-v1'
      and status = 'active'
  ) then
    perform catalog_private.enqueue_semantic_profile_request(new.video_id);
  end if;
  return new;
end;
$$;

create or replace function public.request_semantic_profile_generation(p_video_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from catalog_private.semantic_profile_model_registry
    where profile_schema_version = 'semantic-profile-v1'
      and prompt_version = 'semantic-profile-prompt-v1'
      and status = 'active'
  ) then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'model_inactive');
  end if;
  return catalog_private.enqueue_semantic_profile_request(p_video_id);
end;
$$;

-- Candidate retrieval is also gated independently, protecting against a
-- manually inserted or pre-approval Profile row.
create or replace function catalog_private.retrieve_semantic_profile_candidates(
  p_source_video_id uuid,
  p_limit integer default 12
)
returns table (
  candidate_video_id uuid,
  candidate_profile_id uuid,
  relationship_score integer,
  matched_topic_keys text[],
  matched_core_concept_keys text[],
  candidate_difficulty text,
  profile_schema_version text
)
language sql
stable
security definer
set search_path = ''
as $$
  with active_model as (
    select semantic_profile_model_registry.model_identifier,
           semantic_profile_model_registry.profile_schema_version,
           semantic_profile_model_registry.prompt_version,
           semantic_profile_model_registry.evaluation_fingerprint
    from catalog_private.semantic_profile_model_registry
    join catalog_private.semantic_profile_evaluations as evaluation
      on evaluation.evaluation_fingerprint = semantic_profile_model_registry.evaluation_fingerprint
     and evaluation.model_identifier = semantic_profile_model_registry.model_identifier
     and evaluation.profile_schema_version = semantic_profile_model_registry.profile_schema_version
     and evaluation.prompt_version = semantic_profile_model_registry.prompt_version
     and evaluation.status = 'passed'
    join catalog_private.semantic_profile_human_approvals as approval
      on approval.approval_ref = semantic_profile_model_registry.human_approval_ref
     and approval.evaluation_fingerprint = semantic_profile_model_registry.evaluation_fingerprint
     and approval.model_identifier = semantic_profile_model_registry.model_identifier
     and approval.profile_schema_version = semantic_profile_model_registry.profile_schema_version
     and approval.prompt_version = semantic_profile_model_registry.prompt_version
     and approval.decision = 'approved'
    where semantic_profile_model_registry.status = 'active'
      and semantic_profile_model_registry.profile_schema_version = 'semantic-profile-v1'
      and semantic_profile_model_registry.prompt_version = 'semantic-profile-prompt-v1'
    limit 1
  ),
  source_profile as (
    select
      profile.profile_schema_version as source_profile_schema_version,
      profile.generator_model as source_generator_model,
      profile.topic_keys,
      profile.core_concept_keys as core_keys,
      profile.prerequisite_concept_keys,
      profile.application_concept_keys,
      profile.counterpoint_concept_keys
    from catalog_private.semantic_profile_versions as profile
    join active_model
     on active_model.model_identifier = profile.generator_model
     and active_model.profile_schema_version = profile.profile_schema_version
     and active_model.prompt_version = profile.prompt_version
     and active_model.evaluation_fingerprint = profile.evaluation_fingerprint
    where profile.video_id = p_source_video_id and profile.status = 'active'
    order by profile.created_at desc
    limit 1
  ),
  eligible as (
    select
      profile.id as candidate_profile_id,
      profile.video_id as candidate_video_id,
      profile.profile_schema_version as candidate_profile_schema_version,
      profile.generator_model as candidate_generator_model,
      profile.difficulty as candidate_difficulty,
      profile.topic_keys,
      profile.core_concept_keys as core_keys,
      profile.prerequisite_concept_keys,
      profile.application_concept_keys,
      profile.counterpoint_concept_keys
    from catalog_private.semantic_profile_versions as profile
    join active_model
     on active_model.model_identifier = profile.generator_model
     and active_model.profile_schema_version = profile.profile_schema_version
     and active_model.prompt_version = profile.prompt_version
     and active_model.evaluation_fingerprint = profile.evaluation_fingerprint
    join public.videos as video on video.id = profile.video_id
    where profile.status = 'active'
      and profile.video_id <> p_source_video_id
      and video.catalog_state = 'active'
  ),
  scored as (
    select
      candidate.*,
      source.*,
      (
        cardinality(array(select unnest(source.topic_keys) intersect select unnest(candidate.topic_keys))) * 3
        + cardinality(array(select unnest(source.core_keys) intersect select unnest(candidate.core_keys))) * 5
        + cardinality(array(select unnest(source.application_concept_keys) intersect select unnest(candidate.prerequisite_concept_keys))) * 2
        + cardinality(array(select unnest(source.prerequisite_concept_keys) intersect select unnest(candidate.application_concept_keys))) * 2
        + cardinality(array(select unnest(source.counterpoint_concept_keys) intersect select unnest(candidate.core_keys)))
      )::integer as score,
      array(select unnest(source.topic_keys) intersect select unnest(candidate.topic_keys)) as matched_topics,
      array(select unnest(source.core_keys) intersect select unnest(candidate.core_keys)) as matched_core
    from eligible as candidate
    cross join source_profile as source
    where candidate.topic_keys && source.topic_keys
       or candidate.core_keys && source.core_keys
       or candidate.prerequisite_concept_keys && source.application_concept_keys
       or candidate.application_concept_keys && source.prerequisite_concept_keys
       or candidate.core_keys && source.counterpoint_concept_keys
  )
  select
    candidate_video_id,
    candidate_profile_id,
    score,
    matched_topics,
    matched_core,
    candidate_difficulty,
    candidate_profile_schema_version
  from scored
  where score > 0
    and candidate_profile_schema_version = (select source_profile_schema_version from source_profile)
    and candidate_generator_model = (select source_generator_model from source_profile)
  order by score desc, candidate_video_id asc
  limit least(greatest(coalesce(p_limit, 12), 1), 50);
$$;

revoke all on table catalog_private.semantic_profile_model_registry
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.semantic_profile_activation_is_available(text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.activate_semantic_profile_model(text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.retire_semantic_profile_model(text, text, text)
  from public, anon, authenticated;
revoke all on function public.begin_semantic_profile_generation(uuid, bigint, text)
  from public, anon, authenticated;
revoke all on function public.complete_semantic_profile_work(
  bigint, uuid, text, jsonb, text[], text[], text[], text[], text[], text, text, text
) from public, anon, authenticated;
revoke all on function public.request_semantic_profile_generation(uuid)
  from public, anon, authenticated;
revoke all on function catalog_private.begin_semantic_profile_generation(uuid, bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.complete_semantic_profile_work(
  bigint, uuid, text, jsonb, text[], text[], text[], text[], text[], text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.activate_semantic_profile_model(text, text, text, text, text)
  to service_role;
grant execute on function public.retire_semantic_profile_model(text, text, text)
  to service_role;
grant execute on function public.begin_semantic_profile_generation(uuid, bigint, text)
  to service_role;
grant execute on function public.complete_semantic_profile_work(
  bigint, uuid, text, jsonb, text[], text[], text[], text[], text[], text, text, text
) to service_role;
grant execute on function public.request_semantic_profile_generation(uuid)
  to service_role;

notify pgrst, 'reload schema';
