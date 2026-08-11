-- Content-free Project activation and cost accounting contract.
-- Run after representative legacy and independent fresh migration replays.

begin;

insert into auth.users (id, is_anonymous)
values
  ('e1000000-0000-4000-8000-000000000001', false),
  ('e2000000-0000-4000-8000-000000000002', false),
  ('e3000000-0000-4000-8000-000000000003', false);

insert into public.projects (id, workspace_id, name, created_at)
select fixture.project_id, workspaces.id, fixture.name, clock_timestamp() - interval '10 minutes'
from public.workspaces
join (values
  ('ea000000-0000-4000-8000-000000000001'::uuid, 'e1000000-0000-4000-8000-000000000001'::uuid, 'Delayed activation'),
  ('ea000000-0000-4000-8000-000000000002'::uuid, 'e2000000-0000-4000-8000-000000000002'::uuid, 'Immediate activation'),
  ('ea000000-0000-4000-8000-000000000003'::uuid, 'e3000000-0000-4000-8000-000000000003'::uuid, 'Readiness only')
) as fixture(project_id, owner_id, name)
  on fixture.owner_id = workspaces.owner_id;

insert into public.project_source_sets (project_id, revision)
values
  ('ea000000-0000-4000-8000-000000000001', 1),
  ('ea000000-0000-4000-8000-000000000002', 1),
  ('ea000000-0000-4000-8000-000000000003', 1)
on conflict (project_id) do update set revision = excluded.revision;

insert into public.videos (
  id, youtube_url, url_hash, title, channel_name, language
) values
  ('eb000000-0000-4000-8000-000000000001', 'https://www.youtube.com/watch?v=analyt00001', 'analytics-video-1', 'Private fixture one', null, 'en'),
  ('eb000000-0000-4000-8000-000000000002', 'https://www.youtube.com/watch?v=analyt00002', 'analytics-video-2', 'Private fixture two', null, 'en'),
  ('eb000000-0000-4000-8000-000000000003', 'https://www.youtube.com/watch?v=analyt00003', 'analytics-video-3', 'Private fixture three', null, 'en'),
  ('eb000000-0000-4000-8000-000000000004', 'https://www.youtube.com/watch?v=analyt00004', 'analytics-video-4', 'Private fixture four', null, 'en'),
  ('eb000000-0000-4000-8000-000000000005', 'https://www.youtube.com/watch?v=analyt00005', 'analytics-video-5', 'Private fixture five', null, 'en'),
  ('eb000000-0000-4000-8000-000000000006', 'https://www.youtube.com/watch?v=analyt00006', 'analytics-video-6', 'Private fixture six', null, 'en');

insert into public.video_transcripts (video_id, transcript_source, language, segments)
select id, 'manual_captions', 'en', '[{"text":"Private fixture evidence","start":0,"duration":2}]'::jsonb
from public.videos
where id between 'eb000000-0000-4000-8000-000000000001'::uuid
  and 'eb000000-0000-4000-8000-000000000006'::uuid;

insert into public.summaries (video_id, summary, transcript_source, output_language)
select id, 'Private fixture summary', 'manual_captions', null
from public.videos
where id between 'eb000000-0000-4000-8000-000000000001'::uuid
  and 'eb000000-0000-4000-8000-000000000006'::uuid;

insert into public.project_videos (
  project_id, video_id, position, status, processing_attempt_id
)
values
  ('ea000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000001', 1, 'ready', null),
  ('ea000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000002', 2, 'processing', 'ed000000-0000-4000-8000-000000000001'),
  ('ea000000-0000-4000-8000-000000000002', 'eb000000-0000-4000-8000-000000000003', 1, 'ready', null),
  ('ea000000-0000-4000-8000-000000000002', 'eb000000-0000-4000-8000-000000000004', 2, 'ready', null),
  ('ea000000-0000-4000-8000-000000000003', 'eb000000-0000-4000-8000-000000000005', 1, 'ready', null),
  ('ea000000-0000-4000-8000-000000000003', 'eb000000-0000-4000-8000-000000000006', 2, 'ready', null);

do $$
begin
  if has_table_privilege('authenticated', 'public.project_analytics_state', 'select')
    or has_table_privilege('authenticated', 'public.project_activation_outbox', 'select')
    or has_table_privilege('authenticated', 'public.project_generation_usage', 'select')
    or has_table_privilege(
      'authenticated',
      'public.project_message_analytics_ordinals',
      'select'
    )
    or has_function_privilege(
      'authenticated',
      'public.record_project_analytics_transition(uuid,uuid,text,timestamptz)',
      'execute'
    )
    or not has_function_privilege(
      'service_role',
      'public.record_project_analytics_transition(uuid,uuid,text,timestamptz)',
      'execute'
    ) then
    raise exception 'REGRESSION: Project analytics access is not service-only';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'project_analytics_state',
        'project_activation_outbox',
        'project_generation_usage',
        'project_message_analytics_ordinals',
        'project_answer_feedback'
      )
      and column_name in (
        'project_name', 'project_goal', 'video_title', 'youtube_url', 'query',
        'prompt', 'answer', 'transcript', 'artifact_content', 'content'
      )
  ) then
    raise exception 'REGRESSION: Project analytics tables contain prohibited content columns';
  end if;
end;
$$;

insert into public.project_conversations (id, project_id, kind, name)
values
  ('ee000000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000001', 'named', 'Ordinal thread one'),
  ('ee000000-0000-4000-8000-000000000002', 'ea000000-0000-4000-8000-000000000001', 'named', 'Ordinal thread two');

insert into public.project_conversation_messages (
  id, conversation_id, role, content, completion_attempt_token,
  completion_state, created_at
) values (
  'ef000000-0000-4000-8000-000000000001',
  'ee000000-0000-4000-8000-000000000001',
  'user', 'Fixture turn one', 'f1000000-0000-4000-8000-000000000001',
  'cancelled', clock_timestamp()
);
insert into public.project_conversation_messages (
  id, conversation_id, role, content, completion_attempt_token,
  completion_state, created_at
) values (
  'ef000000-0000-4000-8000-000000000002',
  'ee000000-0000-4000-8000-000000000002',
  'user', 'Fixture turn two', 'f1000000-0000-4000-8000-000000000002',
  'reserved', clock_timestamp()
);
insert into public.project_conversation_messages (
  id, conversation_id, role, content, completion_attempt_token,
  completion_state, created_at
) values (
  'ef000000-0000-4000-8000-000000000003',
  'ee000000-0000-4000-8000-000000000001',
  'user', 'Fixture turn three', 'f1000000-0000-4000-8000-000000000003',
  'completed', clock_timestamp()
);
insert into public.project_conversation_messages (
  id, conversation_id, in_reply_to_message_id, role, content,
  answer_classification, source_set_revision, source_manifest,
  source_coverage, evidence_snapshot, citation_diagnostics,
  completed_at, created_at
) values (
  'ef000000-0000-4000-8000-000000000010',
  'ee000000-0000-4000-8000-000000000001',
  'ef000000-0000-4000-8000-000000000003',
  'assistant', 'Fixture grounded answer', 'supported', 1,
  '{"projectId":"ea000000-0000-4000-8000-000000000001","sourceSetRevision":1,"sources":[]}'::jsonb,
  '{"totalVideos":1,"readyVideos":1,"usedVideos":0,"unavailableVideos":[],"passagesExamined":0,"passagesUsed":0}'::jsonb,
  '{"projectId":"ea000000-0000-4000-8000-000000000001","sourceSetRevision":1,"passages":[]}'::jsonb,
  '[]'::jsonb, clock_timestamp(), clock_timestamp()
);

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  'e1000000-0000-4000-8000-000000000001',
  true
);
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"e1000000-0000-4000-8000-000000000001","is_anonymous":false,"app_metadata":{"project_beta_access":"internal"}}',
  true
);

do $$
declare
  reservation jsonb;
begin
  reservation := public.start_project_grounded_question_v2(
    'ea000000-0000-4000-8000-000000000001',
    'ef000000-0000-4000-8000-000000000004',
    'Exact route ordinal identity',
    'ee000000-0000-4000-8000-000000000002',
    'question'
  );
  if reservation ->> 'outcome' <> 'started'
    or reservation ->> 'userMessageId'
      <> 'ef000000-0000-4000-8000-000000000004'
    or reservation ->> 'messageOrdinal' <> '4' then
    raise exception
      'REGRESSION: route did not return the trusted durable ordinal identity: %',
      reservation;
  end if;
end;
$$;

reset role;

update public.project_conversations
set cleared_at = clock_timestamp()
where id = 'ee000000-0000-4000-8000-000000000001';

do $$
declare
  ordinals bigint[];
  decorated_assistant jsonb;
begin
  select array_agg(message_ordinal order by user_message_id)
  into ordinals
  from public.project_message_analytics_ordinals
  where project_id = 'ea000000-0000-4000-8000-000000000001';
  if ordinals <> array[1, 2, 3, 4]::bigint[] then
    raise exception
      'REGRESSION: canonical ordinals did not span threads/incomplete turns: %',
      ordinals;
  end if;

  decorated_assistant :=
    project_private.with_project_message_analytics_ordinal(
      jsonb_build_object(
        'id', 'ef000000-0000-4000-8000-000000000099',
        'role', 'assistant',
        'inReplyToMessageId', 'ef000000-0000-4000-8000-000000000002'
      )
    );
  if decorated_assistant ->> 'messageOrdinal' <> '2' then
    raise exception 'REGRESSION: assistant did not inherit canonical user ordinal';
  end if;
  if project_private.with_project_message_analytics_ordinal(
      jsonb_build_object('id', 'not-a-uuid', 'role', 'assistant')
    ) <> jsonb_build_object('id', 'not-a-uuid', 'role', 'assistant') then
    raise exception 'REGRESSION: missing ordinal did not fail soft';
  end if;
end;
$$;

-- Feedback is a public user RPC. Exercise it as the trusted authenticated
-- caller whose JWT was established above, not as the fixture superuser.
set local role authenticated;

do $$
declare
  feedback_result jsonb;
begin

  feedback_result := public.record_project_answer_feedback(
    'ea000000-0000-4000-8000-000000000001',
    'ef000000-0000-4000-8000-000000000010',
    'helpful'
  );
  if feedback_result ->> 'outcome' <> 'recorded'
    or feedback_result ->> 'messageOrdinal' <> '3'
    or feedback_result ->> 'rating' <> 'helpful' then
    raise exception 'REGRESSION: first feedback decision was not recorded: %',
      feedback_result;
  end if;

  feedback_result := public.record_project_answer_feedback(
    'ea000000-0000-4000-8000-000000000001',
    'ef000000-0000-4000-8000-000000000010',
    'helpful'
  );
  if feedback_result ->> 'outcome' <> 'deduplicated' then
    raise exception 'REGRESSION: repeated feedback was not deduplicated: %',
      feedback_result;
  end if;

  feedback_result := public.record_project_answer_feedback(
    'ea000000-0000-4000-8000-000000000001',
    'ef000000-0000-4000-8000-000000000010',
    'not_helpful'
  );
  if feedback_result ->> 'outcome' <> 'conflict'
    or feedback_result ->> 'rating' <> 'helpful' then
    raise exception 'REGRESSION: immutable feedback decision was overwritten: %',
      feedback_result;
  end if;
end;
$$;

reset role;

do $$
declare
  decorated_assistant jsonb;
begin

  decorated_assistant :=
    project_private.with_project_message_analytics_ordinal(
      jsonb_build_object(
        'id', 'ef000000-0000-4000-8000-000000000010',
        'role', 'assistant',
        'inReplyToMessageId', 'ef000000-0000-4000-8000-000000000003'
      )
    );
  if decorated_assistant ->> 'messageOrdinal' <> '3'
    or decorated_assistant ->> 'feedbackRating' <> 'helpful' then
    raise exception 'REGRESSION: feedback did not reload on its durable answer';
  end if;
end;
$$;

set local role service_role;

do $$
declare
  delayed jsonb;
  immediate jsonb;
  reordered jsonb;
  readiness_only jsonb;
  inactive_usage jsonb;
  message_occurred_at timestamptz := clock_timestamp();
begin
  delayed := public.record_project_analytics_transition(
    'ea000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'search',
    clock_timestamp()
  );
  if delayed ->> 'outcome' <> 'recorded'
    or (delayed ->> 'readyVideos')::integer <> 1 then
    raise exception 'REGRESSION: qualifying action activated before two ready Videos';
  end if;

  immediate := public.record_project_analytics_transition(
    'ea000000-0000-4000-8000-000000000002',
    'e2000000-0000-4000-8000-000000000002',
    'message',
    message_occurred_at
  );
  if immediate ->> 'outcome' <> 'activated'
    or immediate ->> 'activationKind' <> 'message' then
    raise exception 'REGRESSION: two-ready Project did not activate on a message';
  end if;

  -- Callback arrival order is not action order: a Search that happened first
  -- may reach this service-only RPC after a later Message callback.
  reordered := public.record_project_analytics_transition(
    'ea000000-0000-4000-8000-000000000002',
    'e2000000-0000-4000-8000-000000000002',
    'search',
    message_occurred_at - interval '1 second'
  );
  if reordered ->> 'outcome' <> 'already_activated'
    or reordered ->> 'activationKind' <> 'search' then
    raise exception
      'REGRESSION: callback arrival order overrode action order (result %)',
      reordered;
  end if;

  readiness_only := public.record_project_analytics_transition(
    'ea000000-0000-4000-8000-000000000003',
    'e3000000-0000-4000-8000-000000000003',
    'source_ready',
    clock_timestamp()
  );
  if readiness_only ->> 'outcome' <> 'recorded' then
    raise exception 'REGRESSION: readiness without a qualifying action activated';
  end if;

  inactive_usage := public.record_project_generation_usage(
    'ea000000-0000-4000-8000-000000000003',
    'e3000000-0000-4000-8000-000000000003',
    'ec000000-0000-4000-8000-000000000003',
    'grounded_answer', 'gpt-5.3-codex-spark', 'cliproxyapi',
    'unavailable', null, null, null, null, 125,
    null, null, null, 'usage_unavailable'
  );
  if inactive_usage ->> 'outcome' <> 'inactive' then
    raise exception
      'REGRESSION: inactive Project generation usage was persisted: %',
      inactive_usage;
  end if;
end;
$$;

reset role;

do $$
begin
  if exists (
    select 1
    from public.project_generation_usage
    where project_id = 'ea000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'REGRESSION: inactive Project generation usage row exists';
  end if;
  if (
    select (rating, message_ordinal)
    from public.project_answer_feedback
    where answer_id = 'ef000000-0000-4000-8000-000000000010'
  ) is distinct from row('helpful'::text, 3::bigint) then
    raise exception 'REGRESSION: durable Project feedback identity drifted';
  end if;
end;
$$;

update public.project_videos
set status = 'ready',
  status_updated_at = clock_timestamp(),
  processing_attempt_id = null
where project_id = 'ea000000-0000-4000-8000-000000000001'
  and video_id = 'eb000000-0000-4000-8000-000000000002';
set local role service_role;

do $$
declare
  activation jsonb;
begin
  activation := public.record_project_analytics_transition(
    'ea000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'source_ready',
    clock_timestamp()
  );
  if activation ->> 'outcome' <> 'activated'
    or activation ->> 'activationKind' <> 'search' then
    raise exception 'REGRESSION: second ready Video did not activate delayed Project';
  end if;
end;
$$;

reset role;
create temporary table analytics_activation_snapshot on commit drop as
select activated_at
from public.project_analytics_state
where project_id = 'ea000000-0000-4000-8000-000000000001';

set local role service_role;

do $$
declare
  duplicate jsonb;
  usage_result jsonb;
begin

  duplicate := public.record_project_analytics_transition(
    'ea000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'artifact',
    clock_timestamp()
  );
  if duplicate ->> 'outcome' <> 'already_activated'
    or duplicate ->> 'activationKind' <> 'search' then
    raise exception 'REGRESSION: activation was not idempotent and first-kind stable';
  end if;

  usage_result := public.record_project_generation_usage(
    'ea000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'ec000000-0000-4000-8000-000000000001',
    'grounded_answer', 'gpt-5.3-codex-spark', 'cliproxyapi',
    'unavailable', null, null, null, null, 125,
    null, null, null, 'usage_unavailable'
  );
  if usage_result ->> 'outcome' <> 'inserted' then
    raise exception 'REGRESSION: unavailable usage was not recorded explicitly';
  end if;
  usage_result := public.record_project_generation_usage(
    'ea000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'ec000000-0000-4000-8000-000000000001',
    'grounded_answer', 'gpt-5.3-codex-spark', 'cliproxyapi',
    'unavailable', null, null, null, null, 125,
    null, null, null, 'usage_unavailable'
  );
  if usage_result ->> 'outcome' <> 'deduplicated' then
    raise exception 'REGRESSION: generation operation was not idempotent';
  end if;

  usage_result := public.record_project_generation_usage(
    'ea000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'ec000000-0000-4000-8000-000000000002',
    'study_guide', 'gpt-5.3-codex-spark', 'cliproxyapi',
    'measured', 100, 25, 50, 563, 250,
    'gateway-2026-08', 'provider_contract', '2026-08-01', null
  );
  if usage_result ->> 'outcome' <> 'inserted' then
    raise exception 'REGRESSION: measured cost was not recorded';
  end if;
end;
$$;

reset role;

do $$
declare
  activated_count integer;
  usage_count integer;
begin
  if (select activated_at
      from public.project_analytics_state
      where project_id = 'ea000000-0000-4000-8000-000000000001')
    is distinct from (select activated_at from analytics_activation_snapshot) then
    raise exception 'REGRESSION: duplicate transition changed activation timestamp';
  end if;
  select count(*) into activated_count
  from public.project_analytics_state
  where activated_at is not null;
  select count(*) into usage_count
  from public.project_generation_usage;
  if activated_count <> 2 or usage_count <> 2 then
    raise exception
      'REGRESSION: Project analytics durable counts are incoherent (activated %, usage %)',
      activated_count, usage_count;
  end if;
  if exists (
    select 1
    from public.project_analytics_state
    where project_id = 'ea000000-0000-4000-8000-000000000002'
      and (
        first_qualifying_activity_kind <> 'search'
        or activation_kind <> 'search'
        or first_qualifying_activity_at > activated_at
      )
  ) then
    raise exception 'REGRESSION: durable activation did not retain action order';
  end if;
end;
$$;

rollback;
