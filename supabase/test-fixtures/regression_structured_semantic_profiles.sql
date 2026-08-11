-- Regression fixture for Issue #349 structured-profile MVP.
-- The whole fixture rolls back; it proves the real service-role bridges and
-- never leaves catalog or queue data in the local database.

begin;

insert into public.videos (
  id, youtube_url, youtube_video_id, url_hash, title, language,
  default_language, catalog_state, privacy_status, embeddable, live_status,
  age_restricted
) values (
  '31000000-0000-4000-8000-000000000001',
  'https://www.youtube.com/watch?v=semfix0001x', 'semfix0001x', 'semfix0001x-hash',
  'Gradient descent', 'en', 'en', 'active', 'public', true, 'none', false
), (
  '31000000-0000-4000-8000-000000000002',
  'https://www.youtube.com/watch?v=semfix0002x', 'semfix0002x', 'semfix0002x-hash',
  'Loss functions', 'en', 'en', 'active', 'public', true, 'none', false
), (
  '31000000-0000-4000-8000-000000000003',
  'https://www.youtube.com/watch?v=deactfix001', 'deactfix001', 'deactfix001-hash',
  'Deactivation race', 'en', 'en', 'active', 'public', true, 'none', false
);

insert into public.video_transcripts (video_id, segments, transcript_source, language)
values (
  '31000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object(
    'text', 'Gradient descent updates parameters using a loss gradient.',
    'start', 0, 'duration', 10
  )),
  'manual_captions', 'en'
);

insert into public.video_transcripts (video_id, segments, transcript_source, language)
values (
  '31000000-0000-4000-8000-000000000003',
  jsonb_build_array(jsonb_build_object(
    'text', 'This request must not persist after deactivation.',
    'start', 0, 'duration', 10
  )),
  'manual_captions', 'en'
);

insert into catalog_private.semantic_profile_versions (
  video_id, profile_schema_version, content_fingerprint, generator_model,
  prompt_version, source_language, topics, core_concepts, topic_keys,
  core_concept_keys, prerequisite_concept_keys, application_concept_keys,
  counterpoint_concept_keys, difficulty, profile
)
values (
  '31000000-0000-4000-8000-000000000002', 'semantic-profile-v1', repeat('b', 64),
  'gpt-5.3-codex-spark', 'semantic-profile-prompt-v1', 'en',
  jsonb_build_array(jsonb_build_object('key', 'machine-learning', 'label', 'Machine learning')),
  jsonb_build_array(
    jsonb_build_object('key', 'loss-function', 'label', 'Loss function'),
    jsonb_build_object('key', 'optimization', 'label', 'Optimization')
  ),
  array['machine-learning']::text[], array['loss-function', 'optimization']::text[],
  array['calculus']::text[], array['model-training']::text[], array[]::text[],
  'intermediate', jsonb_build_object('schemaVersion', 'semantic-profile-v1')
);

do $$
declare
  request_id uuid;
  inactive_request_id uuid;
  claimed record;
  inactive_claimed record;
  started jsonb;
  completed jsonb;
  inactive_started jsonb;
  inactive_completed jsonb;
  candidate record;
begin
  select id into request_id
  from catalog_private.semantic_profile_requests
  where video_id = '31000000-0000-4000-8000-000000000001';
  if request_id is null then
    raise exception 'structured profile trigger did not enqueue';
  end if;
  select id into inactive_request_id
  from catalog_private.semantic_profile_requests
  where video_id = '31000000-0000-4000-8000-000000000003'
    and status = 'pending';

  set local role service_role;
  select * into claimed from public.claim_semantic_profile_work(1, 120) limit 1;
  if claimed.request_id <> request_id then
    raise exception 'service-role claim returned the wrong request';
  end if;
  select public.begin_semantic_profile_generation(request_id, 5000) into started;
  if started ->> 'outcome' <> 'started' then
    raise exception 'budget admission did not start: %', started;
  end if;
  select public.complete_semantic_profile_work(
    claimed.msg_id,
    request_id,
    claimed.content_fingerprint,
    jsonb_build_object(
      'schemaVersion', 'semantic-profile-v1',
      'sourceLanguage', 'en',
      'topics', jsonb_build_array(jsonb_build_object('key', 'machine-learning', 'label', 'Machine learning')),
      'coreConcepts', jsonb_build_array(
        jsonb_build_object('key', 'gradient-descent', 'label', 'Gradient descent'),
        jsonb_build_object('key', 'loss-function', 'label', 'Loss function')
      ),
      'difficulty', 'intermediate',
      'prerequisiteConceptKeys', jsonb_build_array('calculus'),
      'applicationConceptKeys', jsonb_build_array('model-training'),
      'counterpointConceptKeys', jsonb_build_array('gradient-free-optimization')
    ),
    array['machine-learning']::text[],
    array['gradient-descent', 'loss-function']::text[],
    array['calculus']::text[], array['model-training']::text[],
    array['gradient-free-optimization']::text[], 'intermediate',
    'gpt-5.3-codex-spark', 'semantic-profile-prompt-v1'
  ) into completed;
  if completed ->> 'outcome' <> 'completed' then
    raise exception 'profile completion failed: %', completed;
  end if;

  select * into candidate
  from public.retrieve_semantic_profile_candidates(
    '31000000-0000-4000-8000-000000000001', 12
  ) limit 1;
  if candidate.candidate_video_id <> '31000000-0000-4000-8000-000000000002'
    or candidate.relationship_score <= 0
  then
    raise exception 'deterministic retrieval did not return the compatible candidate';
  end if;

  -- A Video can be deactivated while its Gateway call is in flight. The
  -- completion boundary must observe that change and archive without creating
  -- an active Profile.
  select work.* into inactive_claimed
  from public.claim_semantic_profile_work(1, 120) as work
  where work.request_id = inactive_request_id
  limit 1;
  select public.begin_semantic_profile_generation(inactive_request_id, 5000)
    into inactive_started;
  if inactive_started ->> 'outcome' <> 'started' then
    raise exception 'deactivation-race request did not start: %', inactive_started;
  end if;
  set local role postgres;
  update public.videos
  set catalog_state = 'inactive'
  where id = '31000000-0000-4000-8000-000000000003';
  set local role service_role;
  select public.complete_semantic_profile_work(
    inactive_claimed.msg_id,
    inactive_request_id,
    inactive_claimed.content_fingerprint,
    jsonb_build_object(
      'schemaVersion', 'semantic-profile-v1',
      'sourceLanguage', 'en',
      'topics', jsonb_build_array(jsonb_build_object('key', 'topic', 'label', 'Topic')),
      'coreConcepts', jsonb_build_array(
        jsonb_build_object('key', 'concept-a', 'label', 'Concept A'),
        jsonb_build_object('key', 'concept-b', 'label', 'Concept B')
      ),
      'difficulty', 'beginner',
      'prerequisiteConceptKeys', jsonb_build_array(),
      'applicationConceptKeys', jsonb_build_array(),
      'counterpointConceptKeys', jsonb_build_array()
    ),
    array['topic']::text[], array['concept-a', 'concept-b']::text[],
    array[]::text[], array[]::text[], array[]::text[], 'beginner',
    'gpt-5.3-codex-spark', 'semantic-profile-prompt-v1'
  ) into inactive_completed;
  if inactive_completed ->> 'outcome' <> 'obsolete' then
    raise exception 'deactivation race persisted a profile: %', inactive_completed;
  end if;

  begin
    perform 1 from catalog_private.semantic_profile_versions;
    raise exception 'service role could bypass the semantic profile bridge';
  exception when insufficient_privilege then
    null;
  end;

  set local role anon;
  begin
    perform public.retrieve_semantic_profile_candidates(
      '31000000-0000-4000-8000-000000000001', 12
    );
    raise exception 'browser role could read private semantic candidates';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

rollback;
