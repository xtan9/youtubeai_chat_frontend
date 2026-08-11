-- Real multi-session proof for Issue #351 Assessment and Set idempotency.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

delete from catalog_private.recommendation_ready_read_events
where recommendation_set_id in (
  select id from catalog_private.recommendation_sets
  where source_profile_id in (
    select id from catalog_private.semantic_profile_versions
    where video_id in (
      '39000000-0000-4000-8000-000000000001',
      '39000000-0000-4000-8000-000000000002'
    )
  )
);
delete from catalog_private.recommendation_reviews
where recommendation_set_id in (
  select id from catalog_private.recommendation_sets
  where source_profile_id in (
    select id from catalog_private.semantic_profile_versions
    where video_id in (
      '39000000-0000-4000-8000-000000000001',
      '39000000-0000-4000-8000-000000000002'
    )
  )
);
delete from auth.users
where id = '39000000-0000-4000-8000-0000000000f1'::uuid;
delete from catalog_private.recommendations
where recommendation_set_id in (
  select id from catalog_private.recommendation_sets
  where source_profile_id in (
    select id from catalog_private.semantic_profile_versions
    where video_id in (
      '39000000-0000-4000-8000-000000000001',
      '39000000-0000-4000-8000-000000000002'
    )
  )
);
delete from catalog_private.recommendation_sets
where source_profile_id in (
  select id from catalog_private.semantic_profile_versions
  where video_id in (
    '39000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000002'
  )
);
delete from catalog_private.recommendation_assessments
where source_profile_id in (
  select id from catalog_private.semantic_profile_versions
  where video_id in (
    '39000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000002'
  )
);
delete from catalog_private.recommendation_candidate_pair_evidence
where source_profile_id in (
  select id from catalog_private.semantic_profile_versions
  where video_id in (
    '39000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000002'
  )
);
delete from catalog_private.discovery_demand
where topic_key = 'assessment-race' and language_bucket = 'en';
delete from catalog_private.semantic_profile_versions
where video_id in (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002'
);
delete from catalog_private.semantic_profile_model_registry
where model_identifier = 'fixture-assessment-race-model';
delete from catalog_private.semantic_profile_human_approvals
where approval_ref = 'issue-351-concurrency-approval';
delete from catalog_private.semantic_profile_evaluations
where evaluation_fingerprint = repeat('b', 64);
delete from catalog_private.catalog_admissions
where video_id in (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002'
);
delete from catalog_private.youtube_provider_evidence
where video_id in (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002'
);
delete from catalog_private.catalog_nominations
where video_id in (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002'
);
delete from public.videos
where id in (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002'
);

do $guard$
begin
  if exists (
    select 1 from catalog_private.semantic_profile_model_registry
    where status = 'active'
  ) then
    raise exception 'Assessment concurrency fixture requires no active model';
  end if;
end;
$guard$;

insert into public.videos (
  id, youtube_url, youtube_video_id, url_hash, title, language,
  default_language, catalog_state, privacy_status, embeddable, live_status,
  age_restricted
) values (
  '39000000-0000-4000-8000-000000000001',
  'https://www.youtube.com/watch?v=assessrace1', 'assessrace1',
  'assess-race-source-hash', 'Concurrent Assessment source', 'en', 'en',
  'active', 'public', true, 'none', false
), (
  '39000000-0000-4000-8000-000000000002',
  'https://www.youtube.com/watch?v=assessrace2', 'assessrace2',
  'assess-race-candidate-hash', 'Concurrent Assessment candidate', 'en', 'es',
  'active', 'public', true, 'none', false
);

insert into catalog_private.catalog_nominations (video_id, status, decided_at)
select id, 'admitted', statement_timestamp()
from public.videos
where id in (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002'
);

insert into catalog_private.youtube_provider_evidence (
  nomination_id, video_id, idempotency_key, provider_outcome, provider_path,
  youtube_video_id, title, channel_id, channel_name, default_language,
  duration_seconds, published_at, privacy_status, embeddable, live_status,
  age_restricted, provider_verified_at, evidence_expires_at
)
select
  nomination.id, video.id, 'issue-351-race:' || video.youtube_video_id,
  'verified', 'youtube_data_api_v3_videos_list', video.youtube_video_id,
  video.title, 'fixture-channel', 'Fixture Channel', video.default_language,
  600, statement_timestamp() - interval '30 days', 'public', true, 'none',
  false, statement_timestamp() - interval '1 hour',
  statement_timestamp() + interval '1 day'
from catalog_private.catalog_nominations as nomination
join public.videos as video on video.id = nomination.video_id
where video.id in (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002'
);

insert into catalog_private.catalog_admissions (
  nomination_id, video_id, provider_evidence_id, idempotency_key,
  policy_version, decision, decided_at
)
select
  nomination.id, video.id, evidence.id,
  'issue-351-race:' || video.youtube_video_id,
  'catalog-admission-policy-v1', 'admitted', statement_timestamp()
from catalog_private.catalog_nominations as nomination
join public.videos as video on video.id = nomination.video_id
join catalog_private.youtube_provider_evidence as evidence
  on evidence.nomination_id = nomination.id
where video.id in (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002'
);

update public.videos as video
set provider_evidence_path = evidence.provider_path,
    provider_verified_at = evidence.provider_verified_at,
    provider_evidence_expires_at = evidence.evidence_expires_at
from catalog_private.youtube_provider_evidence as evidence
where evidence.video_id = video.id
  and video.id in (
    '39000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000002'
  );

insert into catalog_private.semantic_profile_versions (
  video_id, profile_schema_version, content_fingerprint, generator_model,
  prompt_version, evaluation_fingerprint, source_language, topics,
  core_concepts, topic_keys, core_concept_keys, prerequisite_concept_keys,
  application_concept_keys, counterpoint_concept_keys, difficulty, profile
)
select
  video.id, 'semantic-profile-v1',
  md5(video.id::text) || md5('issue-351-race:' || video.id::text),
  'fixture-assessment-race-model', 'semantic-profile-prompt-v1', repeat('b', 64),
  video.default_language,
  jsonb_build_array(
    jsonb_build_object('key', 'assessment-race', 'label', 'Assessment race')
  ),
  jsonb_build_array(
    jsonb_build_object('key', 'race-core-a', 'label', 'Race core A'),
    jsonb_build_object('key', 'race-core-b', 'label', 'Race core B')
  ),
  array['assessment-race']::text[],
  array['race-core-a', 'race-core-b']::text[],
  array[]::text[], array[]::text[], array[]::text[], 'intermediate',
  jsonb_build_object('schemaVersion', 'semantic-profile-v1')
from public.videos as video
where video.id in (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002'
);

insert into catalog_private.semantic_profile_evaluations (
  evaluation_fingerprint, model_identifier, profile_schema_version,
  prompt_version, gateway_provider, metrics, status, evaluated_at
) values (
  repeat('b', 64), 'fixture-assessment-race-model', 'semantic-profile-v1',
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
  ), 'passed', statement_timestamp()
);

insert into catalog_private.semantic_profile_human_approvals (
  approval_ref, evaluation_fingerprint, model_identifier,
  profile_schema_version, prompt_version, approved_by, decision, approved_at
) values (
  'issue-351-concurrency-approval', repeat('b', 64),
  'fixture-assessment-race-model', 'semantic-profile-v1',
  'semantic-profile-prompt-v1', 'fixture-human-reviewer', 'approved',
  statement_timestamp()
);

set role service_role;
select public.activate_semantic_profile_model(
  'fixture-assessment-race-model', 'semantic-profile-v1',
  'semantic-profile-prompt-v1', repeat('b', 64),
  'issue-351-concurrency-approval'
);
select public.prepare_recommendation_candidate_pairs(
  '39000000-0000-4000-8000-000000000001'
);
reset role;

do $fixture$
declare
  connection_string text := format(
    'host=127.0.0.1 port=5432 dbname=%I user=%I password=postgres',
    current_database(), current_user
  );
  connection_names text[] := array[
    'recommendation_assessment_race_1',
    'recommendation_assessment_race_2',
    'recommendation_assessment_race_3',
    'recommendation_assessment_race_4'
  ];
  connection_name text;
  pair_evidence_id uuid;
  remembered jsonb;
  assessment_ids text[] := array[]::text[];
  distinct_id_count integer;
  stored_count integer;
begin
  select id into pair_evidence_id
  from catalog_private.recommendation_candidate_pair_evidence
  where source_profile_id in (
    select id from catalog_private.semantic_profile_versions
    where video_id = '39000000-0000-4000-8000-000000000001'
  );
  if pair_evidence_id is null then
    raise exception 'concurrency fixture pair evidence is missing';
  end if;

  foreach connection_name in array connection_names loop
    perform extensions.dblink_connect(connection_name, connection_string);
    perform extensions.dblink_exec(connection_name, 'set role service_role');
    perform extensions.dblink_send_query(
      connection_name,
      format(
        $query$
          select public.remember_recommendation_assessment(
            %L::uuid,
            'fixture-concurrent-assessor-v1',
            'recommendation-assessment-prompt-v1',
            'continuation-relationship-policy-v1',
            '{
              "schemaVersion": "recommendation-assessment-v1",
              "supported": true,
              "continuationRelationship": "deeper_explanation",
              "explanation": "A deeper treatment of the shared race concepts.",
              "evidenceReferences": [
                {
                  "kind": "matchedCoreConceptKeys",
                  "conceptKey": "race-core-a"
                }
              ]
            }'::jsonb
          )
        $query$,
        pair_evidence_id
      )
    );
  end loop;

  foreach connection_name in array connection_names loop
    select result into remembered
    from extensions.dblink_get_result(connection_name) as result(result jsonb);
    perform result
    from extensions.dblink_get_result(connection_name) as cleared(result jsonb);
    if remembered ->> 'outcome' not in ('stored', 'reused')
      or (remembered ->> 'supported')::boolean is not true
      or remembered ->> 'assessmentId' is null
    then
      raise exception 'concurrent Assessment remember failed: %', remembered;
    end if;
    assessment_ids := array_append(
      assessment_ids,
      remembered ->> 'assessmentId'
    );
    perform extensions.dblink_disconnect(connection_name);
  end loop;

  select count(distinct assessment_id) into distinct_id_count
  from unnest(assessment_ids) as ids(assessment_id);
  select count(*) into stored_count
  from catalog_private.recommendation_assessments
  where candidate_pair_evidence_id = pair_evidence_id
    and assessment_model_identifier = 'fixture-concurrent-assessor-v1';
  if distinct_id_count <> 1 or stored_count <> 1 then
    raise exception 'concurrent Assessment storage diverged: %, %, %',
      assessment_ids, distinct_id_count, stored_count;
  end if;
end;
$fixture$;

do $replacement_assessment$
declare
  pair_evidence_id uuid;
  remembered jsonb;
begin
  select id into pair_evidence_id
  from catalog_private.recommendation_candidate_pair_evidence
  where source_profile_id in (
    select id from catalog_private.semantic_profile_versions
    where video_id = '39000000-0000-4000-8000-000000000001'
  )
  limit 1;
  set local role service_role;
  select public.remember_recommendation_assessment(
    pair_evidence_id,
    'fixture-concurrent-set-replacement-assessor-v1',
    'recommendation-assessment-prompt-v1',
    'continuation-relationship-policy-v1',
    '{
      "schemaVersion": "recommendation-assessment-v1",
      "supported": true,
      "continuationRelationship": "deeper_explanation",
      "explanation": "A replacement treatment of the shared race concepts.",
      "evidenceReferences": [
        {
          "kind": "matchedCoreConceptKeys",
          "conceptKey": "race-core-b"
        }
      ]
    }'::jsonb
  ) into remembered;
  if remembered ->> 'outcome' not in ('stored', 'reused')
    or remembered ->> 'assessmentId' is null
  then
    raise exception 'replacement Set Assessment failed: %', remembered;
  end if;
end;
$replacement_assessment$;

do $set_concurrency$
declare
  connection_string text := format(
    'host=127.0.0.1 port=5432 dbname=%I user=%I password=postgres',
    current_database(), current_user
  );
  connection_names text[] := array[
    'shadow_recommendation_set_race_1',
    'shadow_recommendation_set_race_2',
    'shadow_recommendation_set_race_3',
    'shadow_recommendation_set_race_4'
  ];
  connection_name text;
  replacement_connection text := 'shadow_recommendation_set_replacement';
  fixture_source_profile_id uuid;
  first_assessment_id uuid;
  replacement_assessment_id uuid;
  set_policy_fingerprint text;
  published jsonb;
  replacement jsonb;
  set_ids text[] := array[]::text[];
  distinct_set_id_count integer;
  stored_set_count integer;
  stored_item_count integer;
  first_set_id uuid;
  replacement_set_id uuid;
  visible_current_set_id uuid;
  old_set record;
begin
  select id into fixture_source_profile_id
  from catalog_private.semantic_profile_versions
  where video_id = '39000000-0000-4000-8000-000000000001';
  select id into first_assessment_id
  from catalog_private.recommendation_assessments
  where recommendation_assessments.source_profile_id =
    fixture_source_profile_id
    and assessment_model_identifier = 'fixture-concurrent-assessor-v1';
  select id into replacement_assessment_id
  from catalog_private.recommendation_assessments
  where recommendation_assessments.source_profile_id =
    fixture_source_profile_id
    and assessment_model_identifier =
      'fixture-concurrent-set-replacement-assessor-v1';
  select policy.set_policy_fingerprint into set_policy_fingerprint
  from catalog_private.recommendation_set_policies as policy
  where policy.status = 'active';
  if fixture_source_profile_id is null
    or first_assessment_id is null
    or replacement_assessment_id is null
    or set_policy_fingerprint is null
  then
    raise exception 'Set concurrency fixture inputs are missing';
  end if;

  foreach connection_name in array connection_names loop
    perform extensions.dblink_connect(connection_name, connection_string);
    perform extensions.dblink_exec(connection_name, 'set role service_role');
    perform extensions.dblink_send_query(
      connection_name,
      format(
        $query$
          select public.publish_shadow_recommendation_set(
            %L::uuid,
            %L,
            array[%L::uuid]
          )
        $query$,
        fixture_source_profile_id,
        set_policy_fingerprint,
        first_assessment_id
      )
    );
  end loop;

  foreach connection_name in array connection_names loop
    select result into published
    from extensions.dblink_get_result(connection_name) as result(result jsonb);
    perform result
    from extensions.dblink_get_result(connection_name) as cleared(result jsonb);
    if published ->> 'outcome' not in ('published', 'reused')
      or published ->> 'status' <> 'current'
      or published ->> 'recommendationSetId' is null
    then
      raise exception 'concurrent Set publication failed: %', published;
    end if;
    set_ids := array_append(
      set_ids,
      published ->> 'recommendationSetId'
    );
    perform extensions.dblink_disconnect(connection_name);
  end loop;

  select count(distinct set_id) into distinct_set_id_count
  from unnest(set_ids) as ids(set_id);
  select count(*) into stored_set_count
  from catalog_private.recommendation_sets
  where recommendation_sets.source_profile_id = fixture_source_profile_id;
  select id into first_set_id
  from catalog_private.recommendation_sets
  where recommendation_sets.source_profile_id = fixture_source_profile_id;
  select count(*) into stored_item_count
  from catalog_private.recommendations
  where recommendation_set_id = first_set_id;
  if distinct_set_id_count <> 1
    or stored_set_count <> 1
    or stored_item_count <> 1
  then
    raise exception 'concurrent Set publication diverged: %, %, %, %',
      set_ids, distinct_set_id_count, stored_set_count, stored_item_count;
  end if;

  perform extensions.dblink_connect(
    replacement_connection,
    connection_string
  );
  perform extensions.dblink_exec(replacement_connection, 'begin');
  perform extensions.dblink_exec(
    replacement_connection,
    'set local role service_role'
  );
  select result into replacement
  from extensions.dblink(
    replacement_connection,
    format(
      $query$
        select public.publish_shadow_recommendation_set(
          %L::uuid,
          %L,
          array[%L::uuid]
        )
      $query$,
      fixture_source_profile_id,
      set_policy_fingerprint,
      replacement_assessment_id
    )
  ) as result(result jsonb);
  replacement_set_id := (replacement ->> 'recommendationSetId')::uuid;
  if replacement ->> 'outcome' <> 'published'
    or replacement_set_id is null
    or replacement_set_id = first_set_id
  then
    raise exception 'replacement Set transaction failed: %', replacement;
  end if;

  -- The replacement transaction is still uncommitted. A separate reader sees
  -- the prior complete Set, never a building or partially inserted Set.
  select id into visible_current_set_id
  from catalog_private.recommendation_sets
  where recommendation_sets.source_profile_id = fixture_source_profile_id
    and status = 'current';
  if visible_current_set_id <> first_set_id then
    raise exception 'uncommitted replacement hid the prior current Set: %, %',
      visible_current_set_id, first_set_id;
  end if;

  perform extensions.dblink_exec(replacement_connection, 'commit');
  perform extensions.dblink_disconnect(replacement_connection);

  select id into visible_current_set_id
  from catalog_private.recommendation_sets
  where recommendation_sets.source_profile_id = fixture_source_profile_id
    and status = 'current';
  select * into old_set
  from catalog_private.recommendation_sets
  where id = first_set_id;
  select count(*) into stored_set_count
  from catalog_private.recommendation_sets
  where recommendation_sets.source_profile_id = fixture_source_profile_id;
  select count(*) into stored_item_count
  from catalog_private.recommendations
  where recommendation_set_id in (first_set_id, replacement_set_id);
  if visible_current_set_id <> replacement_set_id
    or old_set.status <> 'superseded'
    or old_set.superseded_by_set_id <> replacement_set_id
    or stored_set_count <> 2
    or stored_item_count <> 2
  then
    raise exception 'committed Set replacement was incoherent: %, %, %, %, %',
      visible_current_set_id,
      replacement_set_id,
      to_jsonb(old_set),
      stored_set_count,
      stored_item_count;
  end if;
end;
$set_concurrency$;

insert into auth.users (
  id,
  email,
  raw_app_meta_data,
  is_anonymous
) values (
  '39000000-0000-4000-8000-0000000000f1'::uuid,
  'race-reviewer@example.com',
  jsonb_build_object('is_admin', true),
  false
) on conflict (id) do update
set email = excluded.email,
    raw_app_meta_data = excluded.raw_app_meta_data,
    is_anonymous = excluded.is_anonymous;

do $review_concurrency$
declare
  connection_string text := format(
    'host=127.0.0.1 port=5432 dbname=%I user=%I password=postgres',
    current_database(), current_user
  );
  connection_names text[] := array[
    'recommendation_review_race_1',
    'recommendation_review_race_2',
    'recommendation_review_race_3',
    'recommendation_review_race_4'
  ];
  connection_name text;
  current_set_id uuid;
  v_reviewer_id uuid := '39000000-0000-4000-8000-0000000000f1'::uuid;
  review_result jsonb;
  review_results jsonb[] := array[]::jsonb[];
  ready_result jsonb;
  ready_results jsonb[] := array[]::jsonb[];
  review_count integer;
  ready_read_count integer;
begin
  update catalog_private.recommendation_review_policies
  set minimum_review_corpus = 1
  where review_policy_version = 'recommendation-review-policy-v1';
  select id into current_set_id
  from catalog_private.recommendation_sets
  where source_video_id =
    '39000000-0000-4000-8000-000000000001'::uuid
    and status = 'current';
  if current_set_id is null then
    raise exception 'Review concurrency current Set is missing';
  end if;

  foreach connection_name in array connection_names loop
    perform extensions.dblink_connect(connection_name, connection_string);
    perform extensions.dblink_exec(connection_name, 'set role service_role');
    perform extensions.dblink_send_query(
      connection_name,
      format(
        $query$
          select public.submit_recommendation_review(
            %L::uuid, 1, %L::uuid, 'race-reviewer@example.com',
            true, true, true, true, true, null
          )
        $query$,
        current_set_id, v_reviewer_id
      )
    );
  end loop;

  foreach connection_name in array connection_names loop
    select result into review_result
    from extensions.dblink_get_result(connection_name) as result(result jsonb);
    if review_result ->> 'outcome' not in ('stored', 'reused') then
      raise exception 'concurrent Review submission failed: %', review_result;
    end if;
    review_results := array_append(review_results, review_result);
    perform result
    from extensions.dblink_get_result(connection_name) as cleared(result jsonb);
    perform extensions.dblink_disconnect(connection_name);
  end loop;

  select count(*) into review_count
  from catalog_private.recommendation_reviews as review
  where review.recommendation_set_id = current_set_id
    and review.recommendation_ordinal = 1
    and review.reviewer_id = v_reviewer_id;
  if review_count <> 1
    or (select count(*) from unnest(review_results) where value ->> 'outcome' = 'stored') <> 1
  then
    raise exception 'concurrent Review submission diverged: %, %',
      review_count, review_results;
  end if;

  foreach connection_name in array connection_names loop
    perform extensions.dblink_connect(connection_name, connection_string);
    perform extensions.dblink_exec(connection_name, 'set role service_role');
    perform extensions.dblink_send_query(
      connection_name,
      format(
        $query$
          select public.record_recommendation_ready_read(%L::uuid, 1)
        $query$,
        current_set_id
      )
    );
  end loop;

  foreach connection_name in array connection_names loop
    select result into ready_result
    from extensions.dblink_get_result(connection_name) as result(result jsonb);
    if ready_result ->> 'outcome' <> 'recorded' then
      raise exception 'concurrent ready-read observation failed: %', ready_result;
    end if;
    ready_results := array_append(ready_results, ready_result);
    perform result
    from extensions.dblink_get_result(connection_name) as cleared(result jsonb);
    perform extensions.dblink_disconnect(connection_name);
  end loop;

  select count(*) into ready_read_count
  from catalog_private.recommendation_ready_read_events
  where recommendation_set_id = current_set_id
    and recommendation_ordinal = 1;
  if ready_read_count <> 4 then
    raise exception 'concurrent ready-read observations diverged: %, %',
      ready_read_count, ready_results;
  end if;
end;
$review_concurrency$;

delete from catalog_private.recommendation_ready_read_events
where recommendation_set_id in (
  select id from catalog_private.recommendation_sets
  where source_profile_id in (
    select id from catalog_private.semantic_profile_versions
    where video_id in (
      '39000000-0000-4000-8000-000000000001',
      '39000000-0000-4000-8000-000000000002'
    )
  )
);
delete from catalog_private.recommendation_reviews
where recommendation_set_id in (
  select id from catalog_private.recommendation_sets
  where source_profile_id in (
    select id from catalog_private.semantic_profile_versions
    where video_id in (
      '39000000-0000-4000-8000-000000000001',
      '39000000-0000-4000-8000-000000000002'
    )
  )
);
delete from auth.users
where id = '39000000-0000-4000-8000-0000000000f1'::uuid;

delete from catalog_private.recommendations
where recommendation_set_id in (
  select id from catalog_private.recommendation_sets
  where source_profile_id in (
    select id from catalog_private.semantic_profile_versions
    where video_id in (
      '39000000-0000-4000-8000-000000000001',
      '39000000-0000-4000-8000-000000000002'
    )
  )
);
delete from catalog_private.recommendation_sets
where source_profile_id in (
  select id from catalog_private.semantic_profile_versions
  where video_id in (
    '39000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000002'
  )
);
delete from catalog_private.recommendation_assessments
where source_profile_id in (
  select id from catalog_private.semantic_profile_versions
  where video_id in (
    '39000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000002'
  )
);
delete from catalog_private.recommendation_candidate_pair_evidence
where source_profile_id in (
  select id from catalog_private.semantic_profile_versions
  where video_id in (
    '39000000-0000-4000-8000-000000000001',
    '39000000-0000-4000-8000-000000000002'
  )
);
delete from catalog_private.discovery_demand
where topic_key = 'assessment-race' and language_bucket = 'en';
delete from catalog_private.semantic_profile_versions
where video_id in (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002'
);
delete from catalog_private.semantic_profile_model_registry
where model_identifier = 'fixture-assessment-race-model';
delete from catalog_private.semantic_profile_human_approvals
where approval_ref = 'issue-351-concurrency-approval';
delete from catalog_private.semantic_profile_evaluations
where evaluation_fingerprint = repeat('b', 64);
delete from catalog_private.catalog_admissions
where video_id in (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002'
);
delete from catalog_private.youtube_provider_evidence
where video_id in (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002'
);
delete from catalog_private.catalog_nominations
where video_id in (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002'
);
delete from public.videos
where id in (
  '39000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002'
);

reset search_path;
