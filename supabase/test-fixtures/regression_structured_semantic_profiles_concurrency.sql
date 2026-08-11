-- Real two-session proof for the Issue #349 activation lock.
--
-- Activation, retirement, and enqueue all use one transaction-scoped advisory
-- lock.  Each first session intentionally leaves the transaction open after
-- the function returns, so the second operation must wait for that exact lock
-- before it can observe or change the registry.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

-- Remove only artifacts from an interrupted run, then require the dormant
-- semantic-profile state to be empty. That keeps activation from retiring or
-- rebinding any unrelated production-like request while this fixture runs.
delete from pgmq.q_semantic_profile
where message ->> 'video_id' = '35000000-0000-4000-8000-000000000001';
delete from pgmq.a_semantic_profile
where message ->> 'video_id' = '35000000-0000-4000-8000-000000000001';
delete from catalog_private.semantic_profile_versions
where video_id = '35000000-0000-4000-8000-000000000001';
delete from catalog_private.semantic_profile_requests
where video_id = '35000000-0000-4000-8000-000000000001';
delete from public.video_transcripts
where video_id = '35000000-0000-4000-8000-000000000001';
delete from public.videos
where id = '35000000-0000-4000-8000-000000000001';
delete from catalog_private.semantic_profile_model_registry
where model_identifier in (
  'fixture-semantic-race-a',
  'fixture-semantic-race-b'
);
delete from catalog_private.semantic_profile_human_approvals
where approval_ref in (
  'fixture-semantic-race-approval-a',
  'fixture-semantic-race-approval-b'
);
delete from catalog_private.semantic_profile_evaluations
where evaluation_fingerprint in (repeat('c', 64), repeat('d', 64));

do $guard$
begin
  if exists (select 1 from pgmq.q_semantic_profile)
    or exists (select 1 from pgmq.a_semantic_profile)
    or exists (select 1 from catalog_private.semantic_profile_requests)
    or exists (select 1 from catalog_private.semantic_profile_processing_budget)
    or exists (select 1 from catalog_private.semantic_profile_versions)
    or exists (select 1 from catalog_private.semantic_profile_model_registry)
    or exists (select 1 from catalog_private.semantic_profile_evaluations)
    or exists (select 1 from catalog_private.semantic_profile_human_approvals)
  then
    raise exception
      'REGRESSION: semantic-profile concurrency fixture requires an empty dormant state';
  end if;
end;
$guard$;

insert into public.videos (
  id, youtube_url, youtube_video_id, url_hash, title, language,
  default_language, catalog_state, privacy_status, embeddable, live_status,
  age_restricted
)
values (
  '35000000-0000-4000-8000-000000000001',
  'https://www.youtube.com/watch?v=semrace4901', 'semrace4901',
  'semrace4901-hash', 'Semantic profile activation race', 'en', 'en',
  'active', 'public', true, 'none', false
);

insert into public.video_transcripts (video_id, segments, transcript_source, language)
values (
  '35000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object(
    'text', 'A durable transcript for the activation lock regression.',
    'start', 0, 'duration', 10
  )),
  'manual_captions', 'en'
);

set role postgres;
insert into catalog_private.semantic_profile_evaluations (
  evaluation_fingerprint, model_identifier, profile_schema_version,
  prompt_version, gateway_provider, metrics, status, evaluated_at
)
values
(
  repeat('c', 64), 'fixture-semantic-race-a', 'semantic-profile-v1',
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
  ), 'passed', clock_timestamp()
),
(
  repeat('d', 64), 'fixture-semantic-race-b', 'semantic-profile-v1',
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
  ), 'passed', clock_timestamp()
);
insert into catalog_private.semantic_profile_human_approvals (
  approval_ref, evaluation_fingerprint, model_identifier,
  profile_schema_version, prompt_version, approved_by, decision, approved_at
)
values
(
  'fixture-semantic-race-approval-a', repeat('c', 64),
  'fixture-semantic-race-a', 'semantic-profile-v1',
  'semantic-profile-prompt-v1', 'fixture-human-reviewer', 'approved',
  clock_timestamp()
),
(
  'fixture-semantic-race-approval-b', repeat('d', 64),
  'fixture-semantic-race-b', 'semantic-profile-v1',
  'semantic-profile-prompt-v1', 'fixture-human-reviewer', 'approved',
  clock_timestamp()
);
reset role;

set role service_role;
select public.activate_semantic_profile_model(
  'fixture-semantic-race-a', 'semantic-profile-v1',
  'semantic-profile-prompt-v1', repeat('c', 64),
  'fixture-semantic-race-approval-a'
);
reset role;

do $fixture$
declare
  connection_string text := format(
    'host=127.0.0.1 port=5432 dbname=%I user=%I password=postgres',
    current_database(), current_user
  );
  first_result jsonb;
  second_result jsonb;
  active_count integer;
  active_model text;
  request_model text;
  request_fingerprint text;
  request_status text;
begin
  -- Activation vs activation: the second activation must wait for the first
  -- function's transaction, then become the sole active tuple.
  perform extensions.dblink_connect('semantic_activation_first', connection_string);
  perform extensions.dblink_connect('semantic_activation_second', connection_string);
  perform extensions.dblink_exec('semantic_activation_first', 'begin');
  perform extensions.dblink_exec('semantic_activation_first', 'set local role service_role');
  perform extensions.dblink_send_query(
    'semantic_activation_first',
    $$select public.activate_semantic_profile_model(
      'fixture-semantic-race-a', 'semantic-profile-v1',
      'semantic-profile-prompt-v1', repeat('c', 64),
      'fixture-semantic-race-approval-a'
    )$$
  );
  select result into first_result
  from extensions.dblink_get_result('semantic_activation_first') as result(result jsonb);
  perform result
  from extensions.dblink_get_result('semantic_activation_first') as cleared(result jsonb);
  if first_result ->> 'outcome' <> 'active' then
    raise exception 'first activation did not start the race: %', first_result;
  end if;
  perform extensions.dblink_exec('semantic_activation_second', 'set role service_role');
  perform extensions.dblink_send_query(
    'semantic_activation_second',
    $$select public.activate_semantic_profile_model(
      'fixture-semantic-race-b', 'semantic-profile-v1',
      'semantic-profile-prompt-v1', repeat('d', 64),
      'fixture-semantic-race-approval-b'
    )$$
  );
  perform pg_sleep(0.1);
  if extensions.dblink_is_busy('semantic_activation_second') <> 1 then
    raise exception 'REGRESSION: concurrent activation did not wait for the activation lock';
  end if;
  perform extensions.dblink_exec('semantic_activation_first', 'commit');
  select result into second_result
  from extensions.dblink_get_result('semantic_activation_second') as result(result jsonb);
  perform result
  from extensions.dblink_get_result('semantic_activation_second') as cleared(result jsonb);
  if second_result ->> 'outcome' <> 'active' then
    raise exception 'second activation failed after lock release: %', second_result;
  end if;
  select count(*), max(model_identifier)
  into active_count, active_model
  from catalog_private.semantic_profile_model_registry
  where profile_schema_version = 'semantic-profile-v1'
    and prompt_version = 'semantic-profile-prompt-v1'
    and status = 'active';
  if active_count <> 1 or active_model <> 'fixture-semantic-race-b' then
    raise exception 'REGRESSION: concurrent activations left an invalid registry state: %, %',
      active_count, active_model;
  end if;
  perform extensions.dblink_disconnect('semantic_activation_first');
  perform extensions.dblink_disconnect('semantic_activation_second');

  -- Activation vs retirement: retirement must not observe a half-written
  -- activation and must run only after the activation transaction releases it.
  perform extensions.dblink_connect('semantic_retire_first', connection_string);
  perform extensions.dblink_connect('semantic_retire_second', connection_string);
  perform extensions.dblink_exec('semantic_retire_first', 'begin');
  perform extensions.dblink_exec('semantic_retire_first', 'set local role service_role');
  perform extensions.dblink_send_query(
    'semantic_retire_first',
    $$select public.activate_semantic_profile_model(
      'fixture-semantic-race-a', 'semantic-profile-v1',
      'semantic-profile-prompt-v1', repeat('c', 64),
      'fixture-semantic-race-approval-a'
    )$$
  );
  select result into first_result
  from extensions.dblink_get_result('semantic_retire_first') as result(result jsonb);
  perform result
  from extensions.dblink_get_result('semantic_retire_first') as cleared(result jsonb);
  if first_result ->> 'outcome' <> 'active' then
    raise exception 'activation before retirement did not start: %', first_result;
  end if;
  perform extensions.dblink_exec('semantic_retire_second', 'set role service_role');
  perform extensions.dblink_send_query(
    'semantic_retire_second',
    $$select public.retire_semantic_profile_model(
      'fixture-semantic-race-a', 'semantic-profile-v1',
      'semantic-profile-prompt-v1'
    )$$
  );
  perform pg_sleep(0.1);
  if extensions.dblink_is_busy('semantic_retire_second') <> 1 then
    raise exception 'REGRESSION: concurrent retirement did not wait for activation';
  end if;
  perform extensions.dblink_exec('semantic_retire_first', 'commit');
  select result into second_result
  from extensions.dblink_get_result('semantic_retire_second') as result(result jsonb);
  perform result
  from extensions.dblink_get_result('semantic_retire_second') as cleared(result jsonb);
  if second_result ->> 'outcome' <> 'retired' then
    raise exception 'retirement failed after activation lock release: %', second_result;
  end if;
  select count(*) into active_count
  from catalog_private.semantic_profile_model_registry
  where profile_schema_version = 'semantic-profile-v1'
    and prompt_version = 'semantic-profile-prompt-v1'
    and status = 'active';
  if active_count <> 0 then
    raise exception 'REGRESSION: activation-vs-retirement left an active model: %', active_count;
  end if;
  perform extensions.dblink_disconnect('semantic_retire_first');
  perform extensions.dblink_disconnect('semantic_retire_second');

  -- Enqueue vs retirement: a request must bind one complete active tuple
  -- before retirement can take the lock; it must not bind a torn/null tuple.
  -- Commit the activation in a separate transaction first. The transaction
  -- below must be held open by enqueue alone, otherwise this test could pass
  -- merely because activation retained the same advisory lock.
  perform extensions.dblink_connect('semantic_enqueue_bootstrap', connection_string);
  perform extensions.dblink_exec('semantic_enqueue_bootstrap', 'set role service_role');
  perform extensions.dblink_send_query(
    'semantic_enqueue_bootstrap',
    $$select public.activate_semantic_profile_model(
      'fixture-semantic-race-a', 'semantic-profile-v1',
      'semantic-profile-prompt-v1', repeat('c', 64),
      'fixture-semantic-race-approval-a'
    )$$
  );
  select result into first_result
  from extensions.dblink_get_result('semantic_enqueue_bootstrap') as result(result jsonb);
  perform result
  from extensions.dblink_get_result('semantic_enqueue_bootstrap') as cleared(result jsonb);
  if first_result ->> 'outcome' <> 'active' then
    raise exception 'activation before enqueue did not commit: %', first_result;
  end if;
  perform extensions.dblink_disconnect('semantic_enqueue_bootstrap');

  perform extensions.dblink_connect('semantic_enqueue_first', connection_string);
  perform extensions.dblink_connect('semantic_enqueue_second', connection_string);
  perform extensions.dblink_exec('semantic_enqueue_first', 'begin');
  perform extensions.dblink_exec('semantic_enqueue_first', 'set local role service_role');
  perform extensions.dblink_send_query(
    'semantic_enqueue_first',
    $$select public.request_semantic_profile_generation(
      '35000000-0000-4000-8000-000000000001'
    )$$
  );
  select result into first_result
  from extensions.dblink_get_result('semantic_enqueue_first') as result(result jsonb);
  perform result
  from extensions.dblink_get_result('semantic_enqueue_first') as cleared(result jsonb);
  if first_result ->> 'outcome' <> 'enqueued' then
    raise exception 'enqueue before retirement did not start: %', first_result;
  end if;
  perform extensions.dblink_exec('semantic_enqueue_second', 'set role service_role');
  perform extensions.dblink_send_query(
    'semantic_enqueue_second',
    $$select public.retire_semantic_profile_model(
      'fixture-semantic-race-a', 'semantic-profile-v1',
      'semantic-profile-prompt-v1'
    )$$
  );
  perform pg_sleep(0.1);
  if extensions.dblink_is_busy('semantic_enqueue_second') <> 1 then
    raise exception 'REGRESSION: concurrent retirement did not wait for enqueue';
  end if;
  perform extensions.dblink_exec('semantic_enqueue_first', 'commit');
  select result into second_result
  from extensions.dblink_get_result('semantic_enqueue_second') as result(result jsonb);
  perform result
  from extensions.dblink_get_result('semantic_enqueue_second') as cleared(result jsonb);
  if second_result ->> 'outcome' <> 'retired' then
    raise exception 'retirement after enqueue failed: %', second_result;
  end if;
  select generator_model, evaluation_fingerprint, status
  into request_model, request_fingerprint, request_status
  from catalog_private.semantic_profile_requests
  where video_id = '35000000-0000-4000-8000-000000000001';
  if request_model <> 'fixture-semantic-race-a'
    or request_fingerprint <> repeat('c', 64)
    or request_status <> 'pending'
  then
    raise exception 'REGRESSION: enqueue bound a torn activation tuple: %, %, %',
      request_model, request_fingerprint, request_status;
  end if;
  perform extensions.dblink_disconnect('semantic_enqueue_first');
  perform extensions.dblink_disconnect('semantic_enqueue_second');
end;
$fixture$;

-- The fixture owns these deterministic rows and leaves unrelated database
-- state untouched, including unrelated pgmq queue messages.
delete from pgmq.q_semantic_profile
where message ->> 'video_id' = '35000000-0000-4000-8000-000000000001';
delete from pgmq.a_semantic_profile
where message ->> 'video_id' = '35000000-0000-4000-8000-000000000001';
delete from catalog_private.semantic_profile_versions
where video_id = '35000000-0000-4000-8000-000000000001';
delete from catalog_private.semantic_profile_requests
where video_id = '35000000-0000-4000-8000-000000000001';
delete from catalog_private.semantic_profile_model_registry
where model_identifier in (
  'fixture-semantic-race-a',
  'fixture-semantic-race-b'
);
delete from catalog_private.semantic_profile_human_approvals
where approval_ref in (
  'fixture-semantic-race-approval-a',
  'fixture-semantic-race-approval-b'
);
delete from catalog_private.semantic_profile_evaluations
where evaluation_fingerprint in (repeat('c', 64), repeat('d', 64));
delete from public.video_transcripts
where video_id = '35000000-0000-4000-8000-000000000001';
delete from public.videos
where id = '35000000-0000-4000-8000-000000000001';

reset search_path;
