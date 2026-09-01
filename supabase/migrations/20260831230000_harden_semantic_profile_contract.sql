-- Harden the structured Semantic Profile boundary.
--
-- The worker validates Gateway JSON before calling the completion RPC.  These
-- database-side checks are deliberately duplicated at the persistence seam so
-- a service caller cannot store an unsorted, duplicated, or provider-shaped
-- object by bypassing the worker.

create table if not exists catalog_private.semantic_profile_dead_letters (
  queue_message_id bigint primary key,
  request_id uuid,
  failure_code text not null check (
    failure_code in ('invalid_message', 'gateway_or_schema', 'worker_error')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  quarantined_at timestamptz not null default clock_timestamp()
);

alter table catalog_private.semantic_profile_dead_letters enable row level security;
revoke all on table catalog_private.semantic_profile_dead_letters
  from public, anon, authenticated, service_role;

create or replace function catalog_private.record_semantic_profile_dead_letter(
  p_msg_id bigint,
  p_request_id uuid,
  p_failure_code text,
  p_attempts integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_msg_id is null or p_msg_id <= 0 then
    return;
  end if;

  insert into catalog_private.semantic_profile_dead_letters (
    queue_message_id, request_id, failure_code, attempts
  ) values (
    p_msg_id,
    p_request_id,
    case
      when p_failure_code in ('invalid_message', 'gateway_or_schema', 'worker_error')
        then p_failure_code
      else 'worker_error'
    end,
    greatest(coalesce(p_attempts, 0), 0)
  )
  on conflict (queue_message_id) do update
  set request_id = excluded.request_id,
      failure_code = excluded.failure_code,
      attempts = greatest(
        catalog_private.semantic_profile_dead_letters.attempts,
        excluded.attempts
      ),
      quarantined_at = least(
        catalog_private.semantic_profile_dead_letters.quarantined_at,
        excluded.quarantined_at
      );
end;
$$;

revoke all on function catalog_private.record_semantic_profile_dead_letter(
  bigint, uuid, text, integer
) from public, anon, authenticated, service_role;

create or replace function catalog_private.semantic_profile_source_language_is_valid(
  p_language text
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  parts text[];
  part text;
  part_count integer;
  part_index integer := 2;
  extlang_count integer := 0;
  extension_subtag_count integer;
  extension_singletons text[] := '{}'::text[];
begin
  if char_length(p_language) not between 2 and 35
    or p_language !~ '^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$'
  then
    return false;
  end if;

  parts := regexp_split_to_array(p_language, '-');
  part_count := array_length(parts, 1);
  if parts[1] !~ '^[A-Za-z]{2,3}$' then
    return false;
  end if;

  -- BCP-47 permits up to three three-letter extlang subtags immediately
  -- after the primary language subtag.
  while part_index <= part_count
    and parts[part_index] ~ '^[A-Za-z]{3}$'
    and extlang_count < 3
  loop
    extlang_count := extlang_count + 1;
    part_index := part_index + 1;
  end loop;

  if part_index <= part_count and parts[part_index] ~ '^[A-Za-z]{4}$' then
    part_index := part_index + 1;
  end if;

  if part_index <= part_count
    and (parts[part_index] ~ '^[A-Za-z]{2}$'
      or parts[part_index] ~ '^[0-9]{3}$')
  then
    part_index := part_index + 1;
  end if;

  -- Variants are five to eight alphanumeric characters, or four characters
  -- beginning with a digit.
  while part_index <= part_count loop
    part := parts[part_index];
    exit when not (
      part ~ '^[A-Za-z0-9]{5,8}$'
      or part ~ '^[0-9][A-Za-z0-9]{3}$'
    );
    part_index := part_index + 1;
  end loop;

  -- Each extension singleton is unique and must be followed by one or more
  -- two-to-eight-character extension subtags.
  while part_index <= part_count loop
    part := parts[part_index];
    exit when char_length(part) <> 1
      or part !~ '^[A-Za-z0-9]$'
      or lower(part) = 'x';
    if lower(part) = any(extension_singletons) then
      return false;
    end if;
    extension_singletons := extension_singletons || lower(part);
    part_index := part_index + 1;
    extension_subtag_count := 0;
    while part_index <= part_count
      and parts[part_index] ~ '^[A-Za-z0-9]{2,8}$'
    loop
      extension_subtag_count := extension_subtag_count + 1;
      part_index := part_index + 1;
    end loop;
    if extension_subtag_count = 0 then
      return false;
    end if;
  end loop;

  -- Private-use subtags are one to eight characters and must be final.
  if part_index <= part_count and lower(parts[part_index]) = 'x' then
    part_index := part_index + 1;
    if part_index > part_count then
      return false;
    end if;
    while part_index <= part_count loop
      if parts[part_index] !~ '^[A-Za-z0-9]{1,8}$' then
        return false;
      end if;
      part_index := part_index + 1;
    end loop;
  end if;

  return part_index > part_count;
end;
$$;

revoke all on function catalog_private.semantic_profile_source_language_is_valid(text)
  from public, anon, authenticated, service_role;

create or replace function catalog_private.semantic_profile_canonical_payload(
  p_schema_version text,
  p_source_language text,
  p_topics jsonb,
  p_core_concepts jsonb,
  p_prerequisite_concept_keys text[],
  p_application_concept_keys text[],
  p_counterpoint_concept_keys text[],
  p_difficulty text
)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $$
  select jsonb_build_object(
    'schemaVersion', p_schema_version,
    'sourceLanguage', p_source_language,
    'topics', p_topics,
    'coreConcepts', p_core_concepts,
    'difficulty', p_difficulty,
    'prerequisiteConceptKeys', to_jsonb(p_prerequisite_concept_keys),
    'applicationConceptKeys', to_jsonb(p_application_concept_keys),
    'counterpointConceptKeys', to_jsonb(p_counterpoint_concept_keys)
  );
$$;

create or replace function catalog_private.semantic_profile_payload_is_valid(
  p_schema_version text,
  p_source_language text,
  p_topics jsonb,
  p_core_concepts jsonb,
  p_topic_keys text[],
  p_core_concept_keys text[],
  p_prerequisite_concept_keys text[],
  p_application_concept_keys text[],
  p_counterpoint_concept_keys text[],
  p_difficulty text,
  p_profile jsonb
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  item jsonb;
  ordered_topics jsonb;
  ordered_core_concepts jsonb;
  derived_topic_keys text[];
  derived_core_concept_keys text[];
  sorted_keys text[];
  all_keys text[];
begin
  if p_schema_version is null
    or p_schema_version <> 'semantic-profile-v1'
    or p_source_language is null
    or not catalog_private.semantic_profile_source_language_is_valid(p_source_language)
    or p_difficulty is null
    or p_difficulty not in ('beginner', 'intermediate', 'advanced', 'mixed')
    or p_profile is null
    or jsonb_typeof(p_profile) <> 'object'
    or p_topics is null
    or jsonb_typeof(p_topics) <> 'array'
    or jsonb_array_length(p_topics) not between 1 and 8
    or p_core_concepts is null
    or jsonb_typeof(p_core_concepts) <> 'array'
    or jsonb_array_length(p_core_concepts) not between 2 and 16
    or p_topic_keys is null
    or cardinality(p_topic_keys) not between 1 and 8
    or p_core_concept_keys is null
    or cardinality(p_core_concept_keys) not between 2 and 16
    or p_prerequisite_concept_keys is null
    or cardinality(p_prerequisite_concept_keys) > 12
    or p_application_concept_keys is null
    or cardinality(p_application_concept_keys) > 12
    or p_counterpoint_concept_keys is null
    or cardinality(p_counterpoint_concept_keys) > 12
  then
    return false;
  end if;

  for item in select value from jsonb_array_elements(p_topics) as element(value)
  loop
    if jsonb_typeof(item) <> 'object'
      or not (item ? 'key')
      or not (item ? 'label')
      or item - 'key' - 'label' <> '{}'::jsonb
      or jsonb_typeof(item -> 'key') <> 'string'
      or jsonb_typeof(item -> 'label') <> 'string'
      or item ->> 'key' !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      or char_length(item ->> 'key') > 64
      or btrim(item ->> 'label') <> item ->> 'label'
      or char_length(item ->> 'label') < 1
      or char_length(item ->> 'label') > 80
    then
      return false;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(p_core_concepts) as element(value)
  loop
    if jsonb_typeof(item) <> 'object'
      or not (item ? 'key')
      or not (item ? 'label')
      or item - 'key' - 'label' <> '{}'::jsonb
      or jsonb_typeof(item -> 'key') <> 'string'
      or jsonb_typeof(item -> 'label') <> 'string'
      or item ->> 'key' !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      or char_length(item ->> 'key') > 64
      or btrim(item ->> 'label') <> item ->> 'label'
      or char_length(item ->> 'label') < 1
      or char_length(item ->> 'label') > 80
    then
      return false;
    end if;
  end loop;

  all_keys := p_topic_keys
    || p_core_concept_keys
    || p_prerequisite_concept_keys
    || p_application_concept_keys
    || p_counterpoint_concept_keys;

  if exists (
    select 1
    from unnest(all_keys) as key_list(key)
    where key_list.key is null
      or key_list.key !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      or char_length(key_list.key) > 64
  )
  or (
    select count(*) from unnest(all_keys)
  ) <> (
    select count(distinct key_list.key) from unnest(all_keys) as key_list(key)
  )
  then
    return false;
  end if;

  select array_agg(key_list.key order by key_list.key collate "C")
  into sorted_keys
  from unnest(p_topic_keys) as key_list(key);
  if p_topic_keys is distinct from sorted_keys then
    return false;
  end if;
  select array_agg(key_list.key order by key_list.key collate "C")
  into sorted_keys
  from unnest(p_core_concept_keys) as key_list(key);
  if p_core_concept_keys is distinct from sorted_keys then
    return false;
  end if;
  if p_prerequisite_concept_keys is distinct from (
       select coalesce(array_agg(key_list.key order by key_list.key collate "C"), '{}'::text[])
       from unnest(p_prerequisite_concept_keys) as key_list(key)
     )
    or p_application_concept_keys is distinct from (
       select coalesce(array_agg(key_list.key order by key_list.key collate "C"), '{}'::text[])
       from unnest(p_application_concept_keys) as key_list(key)
     )
    or p_counterpoint_concept_keys is distinct from (
       select coalesce(array_agg(key_list.key order by key_list.key collate "C"), '{}'::text[])
       from unnest(p_counterpoint_concept_keys) as key_list(key)
     )
  then
    return false;
  end if;

  select coalesce(jsonb_agg(element.value order by (element.value ->> 'key') collate "C"), '[]'::jsonb)
  into ordered_topics
  from jsonb_array_elements(p_topics) as element(value);
  select coalesce(jsonb_agg(element.value order by (element.value ->> 'key') collate "C"), '[]'::jsonb)
  into ordered_core_concepts
  from jsonb_array_elements(p_core_concepts) as element(value);
  if p_topics <> ordered_topics or p_core_concepts <> ordered_core_concepts then
    return false;
  end if;

  select array_agg(element.value ->> 'key' order by element.ordinality)
  into derived_topic_keys
  from jsonb_array_elements(p_topics) with ordinality as element(value, ordinality);
  select array_agg(element.value ->> 'key' order by element.ordinality)
  into derived_core_concept_keys
  from jsonb_array_elements(p_core_concepts) with ordinality as element(value, ordinality);
  if p_topic_keys is distinct from derived_topic_keys
    or p_core_concept_keys is distinct from derived_core_concept_keys
  then
    return false;
  end if;

  if p_profile <> catalog_private.semantic_profile_canonical_payload(
    p_schema_version,
    p_source_language,
    p_topics,
    p_core_concepts,
    p_prerequisite_concept_keys,
    p_application_concept_keys,
    p_counterpoint_concept_keys,
    p_difficulty
  ) then
    return false;
  end if;

  return true;
end;
$$;

alter table catalog_private.semantic_profile_requests
  drop constraint semantic_profile_requests_source_language_check;
alter table catalog_private.semantic_profile_requests
  add constraint semantic_profile_requests_source_language_check
  check (catalog_private.semantic_profile_source_language_is_valid(source_language));
alter table catalog_private.semantic_profile_versions
  drop constraint semantic_profile_versions_source_language_check;
alter table catalog_private.semantic_profile_versions
  add constraint semantic_profile_versions_source_language_check
  check (catalog_private.semantic_profile_source_language_is_valid(source_language));

alter table catalog_private.semantic_profile_versions
  add constraint semantic_profile_prerequisite_keys_bounded_chk
  check (cardinality(prerequisite_concept_keys) between 0 and 12);
alter table catalog_private.semantic_profile_versions
  add constraint semantic_profile_application_keys_bounded_chk
  check (cardinality(application_concept_keys) between 0 and 12);
alter table catalog_private.semantic_profile_versions
  add constraint semantic_profile_counterpoint_keys_bounded_chk
  check (cardinality(counterpoint_concept_keys) between 0 and 12);

-- Older internal fixtures used the schema version as a shorthand for the
-- already-normalized scalar columns. Expand that shorthand before installing
-- the strict trigger; no provider response is recovered or retained.
update catalog_private.semantic_profile_versions as profile
set profile = catalog_private.semantic_profile_canonical_payload(
  profile.profile_schema_version,
  profile.source_language,
  profile.topics,
  profile.core_concepts,
  profile.prerequisite_concept_keys,
  profile.application_concept_keys,
  profile.counterpoint_concept_keys,
  profile.difficulty
)
where profile.profile = jsonb_build_object('schemaVersion', profile.profile_schema_version);

do $$
begin
  if exists (
    select 1
    from catalog_private.semantic_profile_versions as profile
    where not catalog_private.semantic_profile_payload_is_valid(
      profile.profile_schema_version,
      profile.source_language,
      profile.topics,
      profile.core_concepts,
      profile.topic_keys,
      profile.core_concept_keys,
      profile.prerequisite_concept_keys,
      profile.application_concept_keys,
      profile.counterpoint_concept_keys,
      profile.difficulty,
      profile.profile
    )
  ) then
    raise exception 'Existing Semantic Profile row failed the structured contract';
  end if;
end;
$$;

create or replace function catalog_private.validate_semantic_profile_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.profile = jsonb_build_object('schemaVersion', new.profile_schema_version) then
    new.profile := catalog_private.semantic_profile_canonical_payload(
      new.profile_schema_version,
      new.source_language,
      new.topics,
      new.core_concepts,
      new.prerequisite_concept_keys,
      new.application_concept_keys,
      new.counterpoint_concept_keys,
      new.difficulty
    );
  end if;

  if not catalog_private.semantic_profile_payload_is_valid(
    new.profile_schema_version,
    new.source_language,
    new.topics,
    new.core_concepts,
    new.topic_keys,
    new.core_concept_keys,
    new.prerequisite_concept_keys,
    new.application_concept_keys,
    new.counterpoint_concept_keys,
    new.difficulty,
    new.profile
  ) then
    raise exception using
      errcode = '22023',
      message = 'Semantic Profile payload failed the structured contract';
  end if;
  return new;
end;
$$;

drop trigger if exists semantic_profile_versions_contract_trg
  on catalog_private.semantic_profile_versions;
create trigger semantic_profile_versions_contract_trg
before insert or update on catalog_private.semantic_profile_versions
for each row execute function catalog_private.validate_semantic_profile_version();

revoke all on function catalog_private.semantic_profile_payload_is_valid(
  text, text, jsonb, jsonb, text[], text[], text[], text[], text[], text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function catalog_private.semantic_profile_source_language_is_valid(text)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.semantic_profile_canonical_payload(
  text, text, jsonb, jsonb, text[], text[], text[], text
) from public, anon, authenticated, service_role;
revoke all on function catalog_private.validate_semantic_profile_version()
  from public, anon, authenticated, service_role;

-- PGMQ exposes queue tables in its own schema.  Keep this profile queue
-- private as well; the security-definer catalog functions are the only path.
alter table pgmq.q_semantic_profile enable row level security;
alter table pgmq.a_semantic_profile enable row level security;
revoke all on table pgmq.q_semantic_profile
  from public, anon, authenticated, service_role;
revoke all on table pgmq.a_semantic_profile
  from public, anon, authenticated, service_role;

create or replace function catalog_private.semantic_profile_current_evidence_fingerprint(
  p_video_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with evidence as (
    select
      video.catalog_state,
      video.title,
      coalesce(nullif(video.default_language, ''), nullif(video.language, ''), 'en')
        as source_language,
      coalesce(
        string_agg(nullif(segment.value ->> 'text', ''), ' ' order by segment.ordinality),
        ''
      ) as transcript
    from public.videos as video
    left join public.video_transcripts as transcript
      on transcript.video_id = video.id
    left join lateral jsonb_array_elements(transcript.segments)
      with ordinality as segment(value, ordinality)
      on true
    where video.id = p_video_id
    group by video.id, video.catalog_state, video.title,
      video.default_language, video.language
  )
  select catalog_private.semantic_profile_fingerprint(
    evidence.title, evidence.source_language, evidence.transcript
  )
  from evidence
  where evidence.catalog_state = 'active'
    and btrim(evidence.transcript) <> '';
$$;

create or replace function catalog_private.retire_stale_semantic_profiles_for_video(
  p_video_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_fingerprint text;
begin
  current_fingerprint := catalog_private.semantic_profile_current_evidence_fingerprint(p_video_id);
  if current_fingerprint is null then
    if exists (
      select 1
      from public.videos
      where id = p_video_id and catalog_state = 'active'
    ) then
      update catalog_private.semantic_profile_versions
      set status = 'superseded', superseded_at = clock_timestamp()
      where video_id = p_video_id and status = 'active';
    end if;
    return;
  end if;

  update catalog_private.semantic_profile_versions
  set status = 'superseded', superseded_at = clock_timestamp()
  where video_id = p_video_id
    and status = 'active'
    and content_fingerprint <> current_fingerprint;
end;
$$;

create or replace function catalog_private.retire_stale_semantic_profiles_for_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update catalog_private.semantic_profile_versions
  set status = 'superseded', superseded_at = clock_timestamp()
  where video_id = new.video_id
    and profile_schema_version = new.profile_schema_version
    and status = 'active'
    and content_fingerprint <> new.content_fingerprint;
  return new;
end;
$$;

drop trigger if exists semantic_profile_requests_retire_stale_profile_trg
  on catalog_private.semantic_profile_requests;
create trigger semantic_profile_requests_retire_stale_profile_trg
after insert or update of content_fingerprint
on catalog_private.semantic_profile_requests
for each row execute function catalog_private.retire_stale_semantic_profiles_for_request();

create or replace function catalog_private.queue_semantic_profile_on_catalog_admission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.catalog_state = 'active' and old.catalog_state is distinct from 'active' then
    perform catalog_private.retire_stale_semantic_profiles_for_video(new.id);
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
declare
  video_id uuid;
begin
  video_id := case when tg_op = 'DELETE' then old.video_id else new.video_id end;
  perform catalog_private.retire_stale_semantic_profiles_for_video(video_id);
  if tg_op <> 'DELETE' and exists (
    select 1
    from catalog_private.semantic_profile_model_registry
    where profile_schema_version = 'semantic-profile-v1'
      and prompt_version = 'semantic-profile-prompt-v1'
      and status = 'active'
  ) then
    perform catalog_private.enqueue_semantic_profile_request(video_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists transcripts_queue_semantic_profile_after_write
  on public.video_transcripts;
create or replace function catalog_private.queue_semantic_profile_on_video_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.catalog_state = 'active' then
    perform catalog_private.retire_stale_semantic_profiles_for_video(new.id);
    if exists (
      select 1
      from catalog_private.semantic_profile_model_registry
      where profile_schema_version = 'semantic-profile-v1'
        and prompt_version = 'semantic-profile-prompt-v1'
        and status = 'active'
    ) then
      perform catalog_private.enqueue_semantic_profile_request(new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists videos_queue_semantic_profile_after_evidence on public.videos;
create trigger videos_queue_semantic_profile_after_evidence
after update of title, default_language, language on public.videos
for each row execute function catalog_private.queue_semantic_profile_on_video_evidence();

create trigger transcripts_queue_semantic_profile_after_write
after insert or update of segments or delete on public.video_transcripts
for each row execute function catalog_private.queue_semantic_profile_on_transcript();

revoke all on function catalog_private.semantic_profile_current_evidence_fingerprint(uuid)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.retire_stale_semantic_profiles_for_video(uuid)
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.retire_stale_semantic_profiles_for_request()
  from public, anon, authenticated, service_role;
revoke all on function catalog_private.queue_semantic_profile_on_video_evidence()
  from public, anon, authenticated, service_role;

-- Require the retrieval seam to use the current approved evidence, even if a
-- caller changed evidence through a path that did not fire the queue trigger.
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
    select registry.model_identifier,
           registry.profile_schema_version,
           registry.prompt_version,
           registry.evaluation_fingerprint
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
    limit 1
  ),
  source_profile as (
    select profile.profile_schema_version as source_profile_schema_version,
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
    join public.videos as source_video
      on source_video.id = profile.video_id
    where profile.video_id = p_source_video_id
      and profile.status = 'active'
      and source_video.catalog_state = 'active'
    order by profile.created_at desc
    limit 1
  ),
  eligible as (
    select profile.id as candidate_profile_id,
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
    select candidate.*,
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
  select candidate_video_id,
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

revoke all on function catalog_private.retrieve_semantic_profile_candidates(uuid, integer)
  from public, anon, authenticated, service_role;

-- Bind the worker's lifecycle calls to the queue message it actually claimed.
-- The legacy service-only overload remains for existing administrative
-- fixtures, while the cron worker uses the message-bound overload below.
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
begin
  return catalog_private.begin_semantic_profile_generation(
    null::bigint,
    p_request_id,
    p_estimated_micro_usd,
    p_generator_model
  );
end;
$$;

create or replace function catalog_private.begin_semantic_profile_generation(
  p_msg_id bigint,
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
    if p_msg_id is not null then
      perform catalog_private.record_semantic_profile_dead_letter(
        p_msg_id, p_request_id, 'invalid_message', 0
      );
      perform pgmq.archive('semantic_profile', p_msg_id);
    end if;
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'request_missing');
  end if;
  if p_msg_id is not null and request_row.queue_message_id is distinct from p_msg_id then
    perform catalog_private.record_semantic_profile_dead_letter(
      p_msg_id, p_request_id, 'invalid_message', request_row.attempts
    );
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'message_mismatch');
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
  p_msg_id bigint,
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
    p_msg_id, p_request_id, p_estimated_micro_usd, p_generator_model
  );
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
  failure_code text := case
    when p_failure_code in ('invalid_message', 'gateway_or_schema', 'worker_error')
      then p_failure_code
    else 'worker_error'
  end;
  max_attempts integer := least(
    4,
    greatest(coalesce(p_max_attempts, 4), 1)
  );
  next_attempt integer;
begin
  if p_request_id is null then
    perform catalog_private.record_semantic_profile_dead_letter(
      p_msg_id, null, 'invalid_message', 1
    );
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', 'exhausted', 'reason', 'invalid_message');
  end if;

  select * into request_row
  from catalog_private.semantic_profile_requests
  where id = p_request_id
  for update;
  if request_row.id is null then
    perform catalog_private.record_semantic_profile_dead_letter(
      p_msg_id, p_request_id, 'invalid_message', 1
    );
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', 'exhausted', 'reason', 'request_missing');
  end if;
  if request_row.queue_message_id is distinct from p_msg_id then
    perform catalog_private.record_semantic_profile_dead_letter(
      p_msg_id, p_request_id, 'invalid_message', request_row.attempts
    );
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', 'exhausted', 'reason', 'message_mismatch');
  end if;
  if request_row.status in ('obsolete', 'completed', 'exhausted') then
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', request_row.status);
  end if;

  if request_row.status = 'pending' then
    next_attempt := request_row.attempts + 1;
    if next_attempt >= max_attempts then
      update catalog_private.semantic_profile_requests
      set status = 'exhausted', attempts = next_attempt, last_failure_code = failure_code
      where id = p_request_id;
      perform catalog_private.record_semantic_profile_dead_letter(
        p_msg_id, p_request_id, failure_code, next_attempt
      );
      perform pgmq.archive('semantic_profile', p_msg_id);
      return jsonb_build_object('outcome', 'exhausted');
    end if;
    update catalog_private.semantic_profile_requests
    set attempts = next_attempt, last_failure_code = failure_code
    where id = p_request_id;
    delay_seconds := least(
      greatest(coalesce(p_base_delay_seconds, 30), 1) * (2 ^ greatest(next_attempt - 1, 0)),
      3600
    );
    perform pgmq.set_vt('semantic_profile', p_msg_id, delay_seconds);
    return jsonb_build_object('outcome', 'retry', 'delaySeconds', delay_seconds);
  end if;

  if request_row.status <> 'processing' then
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', request_row.status);
  end if;
  if request_row.attempts >= max_attempts then
    update catalog_private.semantic_profile_requests
    set status = 'exhausted', last_failure_code = failure_code
    where id = p_request_id;
    perform catalog_private.record_semantic_profile_dead_letter(
      p_msg_id, p_request_id, failure_code, request_row.attempts
    );
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', 'exhausted');
  end if;

  update catalog_private.semantic_profile_requests
  set status = 'pending', last_failure_code = failure_code
  where id = p_request_id;
  delay_seconds := least(
    greatest(coalesce(p_base_delay_seconds, 30), 1)
      * (2 ^ greatest(request_row.attempts - 1, 0)),
    3600
  );
  perform pgmq.set_vt('semantic_profile', p_msg_id, delay_seconds);
  return jsonb_build_object('outcome', 'retry', 'delaySeconds', delay_seconds);
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
begin
  select * into request_row
  from catalog_private.semantic_profile_requests
  where id = p_request_id
  for update;
  if request_row.id is null then
    perform catalog_private.record_semantic_profile_dead_letter(
      p_msg_id, p_request_id, 'invalid_message', 0
    );
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'request_missing');
  end if;
  if request_row.queue_message_id is distinct from p_msg_id then
    perform catalog_private.record_semantic_profile_dead_letter(
      p_msg_id, p_request_id, 'invalid_message', request_row.attempts
    );
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'message_mismatch');
  end if;
  if request_row.status in ('obsolete', 'exhausted') then
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', request_row.status);
  end if;
  if request_row.status = 'completed' then
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', 'already_completed');
  end if;
  if request_row.generator_model is distinct from btrim(p_generator_model)
    or request_row.prompt_version is distinct from p_prompt_version
  then
    perform pgmq.archive('semantic_profile', p_msg_id);
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
    perform pgmq.archive('semantic_profile', p_msg_id);
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
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'video_inactive');
  end if;
  if request_row.status <> 'processing'
    or request_row.content_fingerprint <> p_content_fingerprint
    or p_profile is null
    or not catalog_private.semantic_profile_payload_is_valid(
      request_row.profile_schema_version,
      request_row.source_language,
      p_profile -> 'topics',
      p_profile -> 'coreConcepts',
      p_topic_keys,
      p_core_concept_keys,
      p_prerequisite_concept_keys,
      p_application_concept_keys,
      p_counterpoint_concept_keys,
      p_difficulty,
      p_profile
    )
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
    p_topic_keys,
    p_core_concept_keys,
    p_prerequisite_concept_keys,
    p_application_concept_keys,
    p_counterpoint_concept_keys,
    p_difficulty,
    p_profile;

  update catalog_private.semantic_profile_requests
  set status = 'completed', completed_at = clock_timestamp()
  where id = p_request_id;
  perform pgmq.archive('semantic_profile', p_msg_id);
  return jsonb_build_object('outcome', 'completed');
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
  request_row record;
begin
  select * into request_row
  from catalog_private.semantic_profile_requests
  where id = p_request_id
  for update;
  if request_row.id is null then
    perform catalog_private.record_semantic_profile_dead_letter(
      p_msg_id, p_request_id, 'invalid_message', 0
    );
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'request_missing');
  end if;
  if request_row.queue_message_id is distinct from p_msg_id then
    perform catalog_private.record_semantic_profile_dead_letter(
      p_msg_id, p_request_id, 'invalid_message', request_row.attempts
    );
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'message_mismatch');
  end if;
  if request_row.status <> 'pending' then
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', 'obsolete');
  end if;

  perform pgmq.set_vt(
    'semantic_profile', p_msg_id,
    least(greatest(coalesce(p_delay_seconds, 900), 60), 3600)
  );
  return jsonb_build_object('outcome', 'deferred');
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
  request_row record;
begin
  select * into request_row
  from catalog_private.semantic_profile_requests
  where id = p_request_id
  for update;
  if request_row.id is null then
    perform catalog_private.record_semantic_profile_dead_letter(
      p_msg_id, p_request_id, 'invalid_message', 0
    );
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'request_missing');
  end if;
  if request_row.queue_message_id is distinct from p_msg_id then
    perform catalog_private.record_semantic_profile_dead_letter(
      p_msg_id, p_request_id, 'invalid_message', request_row.attempts
    );
    perform pgmq.archive('semantic_profile', p_msg_id);
    return jsonb_build_object('outcome', 'obsolete', 'reason', 'message_mismatch');
  end if;

  update catalog_private.semantic_profile_requests
  set status = 'obsolete'
  where id = p_request_id and status in ('pending', 'processing');
  perform pgmq.archive('semantic_profile', p_msg_id);
  return jsonb_build_object('outcome', 'acknowledged');
end;
$$;

create or replace function public.begin_semantic_profile_generation(
  p_msg_id bigint,
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
    p_msg_id, p_request_id, p_estimated_micro_usd, p_generator_model
  );
end;
$$;

revoke all on function catalog_private.begin_semantic_profile_generation(
  uuid, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function catalog_private.begin_semantic_profile_generation(
  bigint, uuid, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function public.begin_semantic_profile_generation(
  bigint, uuid, bigint, text
) from public, anon, authenticated;
grant execute on function public.begin_semantic_profile_generation(
  bigint, uuid, bigint, text
) to service_role;

notify pgrst, 'reload schema';
