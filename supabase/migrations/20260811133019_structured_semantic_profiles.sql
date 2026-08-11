-- Structured Semantic Profiles (Issue #349, backend LLM MVP).
--
-- This migration deliberately does not install pgvector or store embeddings.
-- A server-only LLM produces a bounded, language-independent JSON profile;
-- Postgres stores the validated arrays and performs deterministic overlap
-- retrieval.  The queue, budget, retry and RLS boundaries remain durable.

create extension if not exists pgcrypto;

create schema if not exists catalog_private;
revoke all on schema catalog_private from public, anon, authenticated;
grant usage on schema catalog_private to service_role;

do $$
begin
  if to_regclass('pgmq.q_semantic_profile') is null then
    perform pgmq.create('semantic_profile');
  end if;
end;
$$;

create table catalog_private.semantic_profile_requests (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete restrict,
  profile_schema_version text not null check (profile_schema_version = 'semantic-profile-v1'),
  source_language text not null check (source_language ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
  content_fingerprint text not null check (content_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'obsolete', 'exhausted')),
  queue_message_id bigint,
  attempts integer not null default 0 check (attempts >= 0),
  last_failure_code text check (
    last_failure_code is null or last_failure_code in (
      'invalid_message', 'gateway_or_schema', 'worker_error'
    )
  ),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (video_id, profile_schema_version, content_fingerprint)
);

create unique index semantic_profile_one_active_request_idx
  on catalog_private.semantic_profile_requests (video_id, profile_schema_version)
  where status = 'pending';

create table catalog_private.semantic_profile_processing_budget (
  budget_day date primary key,
  max_starts integer not null default 100 check (max_starts > 0),
  max_micro_usd bigint not null default 500000 check (max_micro_usd > 0),
  starts integer not null default 0 check (starts >= 0),
  reserved_micro_usd bigint not null default 0 check (reserved_micro_usd >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table catalog_private.semantic_profile_versions (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete restrict,
  profile_schema_version text not null check (profile_schema_version = 'semantic-profile-v1'),
  content_fingerprint text not null check (content_fingerprint ~ '^[a-f0-9]{64}$'),
  generator_model text not null check (btrim(generator_model) <> ''),
  prompt_version text not null check (prompt_version = 'semantic-profile-prompt-v1'),
  source_language text not null check (source_language ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
  topics jsonb not null check (jsonb_typeof(topics) = 'array' and jsonb_array_length(topics) between 1 and 8),
  core_concepts jsonb not null check (jsonb_typeof(core_concepts) = 'array' and jsonb_array_length(core_concepts) between 2 and 16),
  topic_keys text[] not null check (cardinality(topic_keys) between 1 and 8),
  core_concept_keys text[] not null check (cardinality(core_concept_keys) between 2 and 16),
  prerequisite_concept_keys text[] not null default '{}',
  application_concept_keys text[] not null default '{}',
  counterpoint_concept_keys text[] not null default '{}',
  difficulty text not null check (difficulty in ('beginner', 'intermediate', 'advanced', 'mixed')),
  profile jsonb not null check (jsonb_typeof(profile) = 'object'),
  status text not null default 'active' check (status in ('active', 'superseded')),
  created_at timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  unique (video_id, profile_schema_version, content_fingerprint)
);

create unique index semantic_profile_one_active_idx
  on catalog_private.semantic_profile_versions (video_id, profile_schema_version)
  where status = 'active';

create index semantic_profile_video_status_idx
  on catalog_private.semantic_profile_versions (video_id, status, created_at desc);
create index semantic_profile_topics_gin_idx
  on catalog_private.semantic_profile_versions using gin (topic_keys);
create index semantic_profile_core_concepts_gin_idx
  on catalog_private.semantic_profile_versions using gin (core_concept_keys);
create index semantic_profile_prerequisites_gin_idx
  on catalog_private.semantic_profile_versions using gin (prerequisite_concept_keys);
create index semantic_profile_applications_gin_idx
  on catalog_private.semantic_profile_versions using gin (application_concept_keys);
create index semantic_profile_counterpoints_gin_idx
  on catalog_private.semantic_profile_versions using gin (counterpoint_concept_keys);

alter table catalog_private.semantic_profile_requests enable row level security;
alter table catalog_private.semantic_profile_processing_budget enable row level security;
alter table catalog_private.semantic_profile_versions enable row level security;
revoke all on table catalog_private.semantic_profile_requests
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.semantic_profile_processing_budget
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.semantic_profile_versions
  from public, anon, authenticated, service_role;

create or replace function catalog_private.semantic_profile_fingerprint(
  p_title text,
  p_source_language text,
  p_transcript text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  -- Two domain-separated md5 values provide a stable 64-hex content key
  -- without making the internal identity depend on an optional extension
  -- schema. This is an idempotency key, never a security credential.
  select md5(coalesce(p_title, '') || E'\n' || coalesce(p_source_language, '') || E'\n' || coalesce(p_transcript, ''))
    || md5('semantic-profile-v1\n' || coalesce(p_title, '') || E'\n' || coalesce(p_source_language, '') || E'\n' || coalesce(p_transcript, ''));
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
  transcript_text text;
  fingerprint text;
  request_id uuid;
  stale_request_id uuid;
  enqueued_message_id bigint;
  existing_request_id uuid;
  existing_status text;
begin
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

  select request.id, request.status into existing_request_id, existing_status
  from catalog_private.semantic_profile_requests as request
  where request.video_id = p_video_id
    and request.profile_schema_version = 'semantic-profile-v1'
    and request.content_fingerprint = fingerprint;
  if existing_status is not null then
    if existing_status not in ('obsolete', 'exhausted') then
      return jsonb_build_object('outcome', 'already_recorded', 'status', existing_status);
    end if;
    update catalog_private.semantic_profile_requests
    set status = 'pending',
        attempts = 0,
        last_failure_code = null,
        claimed_at = null,
        completed_at = null
    where id = existing_request_id;
    request_id := existing_request_id;
  end if;

  -- A changed transcript/source language is a successor request, even when
  -- an older request is still pending or inside the Gateway. Marking the old
  -- request obsolete prevents stale output from becoming the current profile;
  -- the worker's completion path archives the old queue message if it races.
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
        video_id, profile_schema_version, source_language, content_fingerprint
      ) values (
        p_video_id, 'semantic-profile-v1', video_row.source_language, fingerprint
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

create or replace function catalog_private.claim_semantic_profile_work(
  p_batch_size integer,
  p_visibility_timeout_seconds integer
)
returns table (
  msg_id bigint,
  read_count integer,
  request_id uuid,
  video_id uuid,
  title text,
  source_language text,
  transcript text,
  content_fingerprint text,
  profile_schema_version text
)
language sql
volatile
security definer
set search_path = ''
as $$
  select
    message.msg_id,
    message.read_ct,
    case
      when message.message ->> 'request_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (message.message ->> 'request_id')::uuid
      else null
    end,
    case
      when message.message ->> 'video_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (message.message ->> 'video_id')::uuid
      else null
    end,
    message.message ->> 'title',
    message.message ->> 'source_language',
    message.message ->> 'transcript',
    message.message ->> 'content_fingerprint',
    message.message ->> 'profile_schema_version'
  from pgmq.read(
    'semantic_profile',
    least(greatest(coalesce(p_visibility_timeout_seconds, 120), 30), 900),
    least(greatest(coalesce(p_batch_size, 4), 1), 20)
  ) as message
  order by message.msg_id;
$$;

create or replace function catalog_private.begin_semantic_profile_generation(
  p_request_id uuid,
  p_estimated_micro_usd bigint
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
  return jsonb_build_object('outcome', 'started');
end;
$$;

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
    prompt_version, source_language, topics, core_concepts, topic_keys, core_concept_keys,
    prerequisite_concept_keys, application_concept_keys, counterpoint_concept_keys,
    difficulty, profile
  )
  select
    request_row.video_id,
    request_row.profile_schema_version,
    p_content_fingerprint,
    p_generator_model,
    p_prompt_version,
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

create or replace function catalog_private.fail_semantic_profile_work(
  p_msg_id bigint,
  p_request_id uuid,
  p_failure_code text,
  p_max_attempts integer,
  p_base_delay_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_row record;
  delay_seconds integer;
  archived boolean;
begin
  if p_request_id is null then
    -- An envelope without a trustworthy request identity cannot be retried
    -- against a database row. Quarantine it immediately rather than allowing
    -- an unbounded malformed-message loop.
    select pgmq.archive('semantic_profile', p_msg_id) into archived;
    return jsonb_build_object('outcome', 'exhausted', 'reason', 'invalid_message');
  end if;
  select * into request_row
  from catalog_private.semantic_profile_requests
  where id = p_request_id
  for update;
  if request_row.id is null then
    return jsonb_build_object('outcome', 'obsolete');
  end if;
  if request_row.status in ('obsolete', 'completed', 'exhausted') then
    select pgmq.archive('semantic_profile', p_msg_id) into archived;
    return jsonb_build_object('outcome', request_row.status);
  end if;
  if p_failure_code = 'invalid_message' and request_row.status = 'pending' then
    if request_row.attempts + 1 >= least(greatest(coalesce(p_max_attempts, 4), 1), 8) then
      update catalog_private.semantic_profile_requests
      set status = 'exhausted', attempts = attempts + 1, last_failure_code = p_failure_code
      where id = p_request_id;
      select pgmq.archive('semantic_profile', p_msg_id) into archived;
      return jsonb_build_object('outcome', 'exhausted');
    end if;
    update catalog_private.semantic_profile_requests
    set attempts = attempts + 1, last_failure_code = p_failure_code
    where id = p_request_id;
    delay_seconds := least(
      greatest(coalesce(p_base_delay_seconds, 30), 1)
        * (2 ^ greatest(request_row.attempts, 0)),
      3600
    );
    perform pgmq.set_vt('semantic_profile', p_msg_id, delay_seconds);
    return jsonb_build_object('outcome', 'retry');
  end if;
  if request_row.status <> 'processing' then
    select pgmq.archive('semantic_profile', p_msg_id) into archived;
    return jsonb_build_object('outcome', request_row.status);
  end if;
  if request_row.attempts >= least(greatest(coalesce(p_max_attempts, 4), 1), 8) then
    update catalog_private.semantic_profile_requests
    set status = 'exhausted', last_failure_code = p_failure_code
    where id = p_request_id;
    select pgmq.archive('semantic_profile', p_msg_id) into archived;
    return jsonb_build_object('outcome', 'exhausted');
  end if;
  update catalog_private.semantic_profile_requests
  set status = 'pending', last_failure_code = p_failure_code
  where id = p_request_id;
  delay_seconds := least(
    greatest(coalesce(p_base_delay_seconds, 30), 1) * (2 ^ greatest(request_row.attempts - 1, 0)),
    3600
  );
  perform pgmq.set_vt('semantic_profile', p_msg_id, delay_seconds);
  return jsonb_build_object('outcome', 'retry', 'delaySeconds', delay_seconds);
end;
$$;

create or replace function catalog_private.defer_semantic_profile_work(
  p_msg_id bigint,
  p_request_id uuid,
  p_delay_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update catalog_private.semantic_profile_requests
  set status = 'pending'
  where id = p_request_id and status = 'pending';
  get diagnostics changed = row_count;
  perform pgmq.set_vt('semantic_profile', p_msg_id, least(greatest(coalesce(p_delay_seconds, 900), 60), 3600));
  return jsonb_build_object('outcome', case when changed = 1 then 'deferred' else 'obsolete' end);
end;
$$;

create or replace function catalog_private.ack_semantic_profile_work(
  p_msg_id bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  archived boolean;
begin
  update catalog_private.semantic_profile_requests
  set status = 'obsolete'
  where id = p_request_id and status in ('pending', 'processing');
  select pgmq.archive('semantic_profile', p_msg_id) into archived;
  return jsonb_build_object('outcome', 'acknowledged');
end;
$$;

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
  with source_profile as (
    select
      profile_schema_version as source_profile_schema_version,
      topic_keys,
      core_concept_keys as core_keys,
      prerequisite_concept_keys,
      application_concept_keys,
      counterpoint_concept_keys
    from catalog_private.semantic_profile_versions
    where video_id = p_source_video_id and status = 'active'
    order by created_at desc
    limit 1
  ),
  eligible as (
    select
      profile.id as candidate_profile_id,
      profile.video_id as candidate_video_id,
      profile.profile_schema_version as candidate_profile_schema_version,
      profile.difficulty as candidate_difficulty,
      profile.topic_keys,
      profile.core_concept_keys as core_keys,
      profile.prerequisite_concept_keys,
      profile.application_concept_keys,
      profile.counterpoint_concept_keys
    from catalog_private.semantic_profile_versions as profile
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
  order by score desc, candidate_video_id asc
  limit least(greatest(coalesce(p_limit, 12), 1), 50);
$$;

create or replace function catalog_private.queue_semantic_profile_on_catalog_admission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.catalog_state = 'active' and old.catalog_state is distinct from 'active' then
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
  perform catalog_private.enqueue_semantic_profile_request(new.video_id);
  return new;
end;
$$;

create trigger videos_queue_semantic_profile_after_admission
after update of catalog_state on public.videos
for each row execute function catalog_private.queue_semantic_profile_on_catalog_admission();

create trigger transcripts_queue_semantic_profile_after_write
after insert or update of segments on public.video_transcripts
for each row execute function catalog_private.queue_semantic_profile_on_transcript();

create or replace function public.request_semantic_profile_generation(p_video_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return catalog_private.enqueue_semantic_profile_request(p_video_id);
end;
$$;

create or replace function public.claim_semantic_profile_work(
  p_batch_size integer,
  p_visibility_timeout_seconds integer
)
returns table (
  msg_id bigint,
  read_count integer,
  request_id uuid,
  video_id uuid,
  title text,
  source_language text,
  transcript text,
  content_fingerprint text,
  profile_schema_version text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query select * from catalog_private.claim_semantic_profile_work(
    p_batch_size, p_visibility_timeout_seconds
  );
end;
$$;

create or replace function public.begin_semantic_profile_generation(
  p_request_id uuid,
  p_estimated_micro_usd bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return catalog_private.begin_semantic_profile_generation(p_request_id, p_estimated_micro_usd);
end;
$$;

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

create or replace function public.fail_semantic_profile_work(
  p_msg_id bigint,
  p_request_id uuid,
  p_failure_code text,
  p_max_attempts integer,
  p_base_delay_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return catalog_private.fail_semantic_profile_work(
    p_msg_id, p_request_id, p_failure_code, p_max_attempts, p_base_delay_seconds
  );
end;
$$;

create or replace function public.defer_semantic_profile_work(
  p_msg_id bigint,
  p_request_id uuid,
  p_delay_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return catalog_private.defer_semantic_profile_work(
    p_msg_id, p_request_id, p_delay_seconds
  );
end;
$$;

create or replace function public.ack_semantic_profile_work(
  p_msg_id bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return catalog_private.ack_semantic_profile_work(p_msg_id, p_request_id);
end;
$$;

create or replace function public.retrieve_semantic_profile_candidates(
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
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query select * from catalog_private.retrieve_semantic_profile_candidates(
    p_source_video_id, p_limit
  );
end;
$$;

revoke all on function catalog_private.semantic_profile_fingerprint(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.enqueue_semantic_profile_request(uuid)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.claim_semantic_profile_work(integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.begin_semantic_profile_generation(uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.complete_semantic_profile_work(
  bigint, uuid, text, jsonb, text[], text[], text[], text[], text[], text, text, text
) from public, anon, authenticated, service_role;
revoke all on function catalog_private.fail_semantic_profile_work(bigint, uuid, text, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.defer_semantic_profile_work(bigint, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.ack_semantic_profile_work(bigint, uuid)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.retrieve_semantic_profile_candidates(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.queue_semantic_profile_on_catalog_admission()
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.queue_semantic_profile_on_transcript()
  from public, anon, authenticated, service_role;
revoke all on function public.request_semantic_profile_generation(uuid) from public, anon, authenticated;
revoke all on function public.claim_semantic_profile_work(integer, integer) from public, anon, authenticated;
revoke all on function public.begin_semantic_profile_generation(uuid, bigint) from public, anon, authenticated;
revoke all on function public.complete_semantic_profile_work(bigint, uuid, text, jsonb, text[], text[], text[], text[], text[], text, text, text) from public, anon, authenticated;
revoke all on function public.fail_semantic_profile_work(bigint, uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.defer_semantic_profile_work(bigint, uuid, integer) from public, anon, authenticated;
revoke all on function public.ack_semantic_profile_work(bigint, uuid) from public, anon, authenticated;
revoke all on function public.retrieve_semantic_profile_candidates(uuid, integer) from public, anon, authenticated;
grant execute on function public.request_semantic_profile_generation(uuid) to service_role;
grant execute on function public.claim_semantic_profile_work(integer, integer) to service_role;
grant execute on function public.begin_semantic_profile_generation(uuid, bigint) to service_role;
grant execute on function public.complete_semantic_profile_work(bigint, uuid, text, jsonb, text[], text[], text[], text[], text[], text, text, text) to service_role;
grant execute on function public.fail_semantic_profile_work(bigint, uuid, text, integer, integer) to service_role;
grant execute on function public.defer_semantic_profile_work(bigint, uuid, integer) to service_role;
grant execute on function public.ack_semantic_profile_work(bigint, uuid) to service_role;
grant execute on function public.retrieve_semantic_profile_candidates(uuid, integer) to service_role;

notify pgrst, 'reload schema';
