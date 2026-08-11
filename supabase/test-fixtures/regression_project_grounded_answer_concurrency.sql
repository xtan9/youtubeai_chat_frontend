-- Exercise two real PostgreSQL sessions racing from four to the Free
-- per-Project five-message cap. Exactly one reservation may commit.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

insert into auth.users (id, is_anonymous)
values ('96000000-0000-4000-8000-000000000006', false);

insert into public.projects (id, workspace_id, name)
select
  'a6000000-0000-4000-8000-000000000006',
  id,
  'Concurrent Grounded Answer Project'
from public.workspaces
where owner_id = '96000000-0000-4000-8000-000000000006';

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '96000000-0000-4000-8000-000000000006',
  false
);
select public.start_project_grounded_question(
  'a6000000-0000-4000-8000-000000000006',
  'Existing question one'
);
select public.start_project_grounded_question(
  'a6000000-0000-4000-8000-000000000006',
  'Existing question two'
);
select public.start_project_grounded_question(
  'a6000000-0000-4000-8000-000000000006',
  'Existing question three'
);
select public.start_project_grounded_question(
  'a6000000-0000-4000-8000-000000000006',
  'Existing question four'
);
reset role;

do $$
declare
  connection_string text := pg_catalog.format('dbname=%L', current_database());
  result_a jsonb;
  result_b jsonb;
  outcomes text[];
begin
  perform dblink_connect('grounded_cap_a', connection_string);
  perform dblink_connect('grounded_cap_b', connection_string);
  perform dblink_exec('grounded_cap_a', 'set role authenticated');
  perform dblink_exec('grounded_cap_b', 'set role authenticated');
  perform dblink_exec(
    'grounded_cap_a',
    'set request.jwt.claim.sub = ''96000000-0000-4000-8000-000000000006'''
  );
  perform dblink_exec(
    'grounded_cap_b',
    'set request.jwt.claim.sub = ''96000000-0000-4000-8000-000000000006'''
  );

  perform dblink_send_query(
    'grounded_cap_a',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      select public.start_project_grounded_question(
        'a6000000-0000-4000-8000-000000000006',
        'Racing fifth question A'
      ) from pause
    $query$
  );
  perform dblink_send_query(
    'grounded_cap_b',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      select public.start_project_grounded_question_v2(
        'a6000000-0000-4000-8000-000000000006',
        'b6000000-0000-4000-8000-000000000006',
        'Racing fifth question B',
        null
      ) from pause
    $query$
  );

  select result into result_a
  from dblink_get_result('grounded_cap_a') as raced(result jsonb);
  select result into result_b
  from dblink_get_result('grounded_cap_b') as raced(result jsonb);
  perform result
  from dblink_get_result('grounded_cap_a') as cleared(result jsonb);
  perform result
  from dblink_get_result('grounded_cap_b') as cleared(result jsonb);

  outcomes := array[result_a ->> 'outcome', result_b ->> 'outcome'];
  if not (outcomes @> array['started', 'limit_reached'])
    or (select count(*)
        from public.project_conversation_messages
        join public.project_conversations
          on project_conversations.id = project_conversation_messages.conversation_id
        where project_conversations.project_id
          = 'a6000000-0000-4000-8000-000000000006'
          and project_conversation_messages.role = 'user') <> 5
    or (select count(*)
        from public.project_conversations
        where project_id = 'a6000000-0000-4000-8000-000000000006'
          and kind = 'default') <> 1
  then
    raise exception 'REGRESSION: concurrent fifth/sixth question violated cap: %, %',
      result_a, result_b;
  end if;

  perform dblink_disconnect('grounded_cap_a');
  perform dblink_disconnect('grounded_cap_b');
end;
$$;

-- Race a Transcript mutation against terminal completion. The Transcript
-- trigger holds the evidence-version row until its mutation commits;
-- completion must then observe the cheap version mismatch.
insert into auth.users (id, is_anonymous)
values ('95000000-0000-4000-8000-000000000005', false);
insert into public.projects (id, workspace_id, name)
select
  'a5000000-0000-4000-8000-000000000005',
  id,
  'Evidence mutation race Project'
from public.workspaces
where owner_id = '95000000-0000-4000-8000-000000000005';
insert into public.project_source_sets (project_id, revision)
values ('a5000000-0000-4000-8000-000000000005', 3);
insert into public.videos (
  id, youtube_url, url_hash, title, channel_name, language
) values (
  '75000000-0000-4000-8000-000000000005',
  'https://www.youtube.com/watch?v=eeeeeee0005',
  'eeeeeee0005', 'Race evidence', 'Race channel', 'en'
);
insert into public.video_transcripts (
  video_id, transcript_source, language, segments
) values (
  '75000000-0000-4000-8000-000000000005',
  'manual_captions', 'en',
  '[{"text":"Race evidence remains coherent.","start":5,"duration":3}]'
);
insert into public.summaries (
  video_id, summary, transcript_source, output_language
) values (
  '75000000-0000-4000-8000-000000000005',
  'Race ready evidence', 'manual_captions', null
);
insert into public.user_video_history (user_id, video_id)
values (
  '95000000-0000-4000-8000-000000000005',
  '75000000-0000-4000-8000-000000000005'
);
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '95000000-0000-4000-8000-000000000005',
  false
);
select public.start_project_grounded_question_v2(
  'a5000000-0000-4000-8000-000000000005',
  'c5000000-0000-4000-8000-000000000006',
  'What does the mutable evidence say?',
  null,
  'question'
);
reset role;

do $$
declare
  connection_string text := pg_catalog.format('dbname=%L', current_database());
  conversation_id uuid;
  attempt_token uuid;
  initial_evidence_version bigint;
  attach_result jsonb;
  mutation_result text;
  completion_result jsonb;
  manifest jsonb := '{
    "projectId":"a5000000-0000-4000-8000-000000000005",
    "sourceSetRevision":4,
    "sources":[{
      "sourceId":"S1",
      "videoId":"75000000-0000-4000-8000-000000000005",
      "youtubeVideoId":"eeeeeee0005",
      "title":"Race evidence",
      "channelName":"Race channel",
      "passages":[{
        "passageId":"75000000-0000-4000-8000-000000000005:1:0:31",
        "startSeconds":5,"endSeconds":8
      }]
    }]
  }'::jsonb;
  coverage jsonb := '{
    "totalVideos":1,"readyVideos":1,"usedVideos":1,
    "unavailableVideos":[],"passagesExamined":1,"passagesUsed":1
  }'::jsonb;
  snapshot jsonb := '{
    "projectId":"a5000000-0000-4000-8000-000000000005",
    "sourceSetRevision":4,
    "passages":[{
      "passageId":"75000000-0000-4000-8000-000000000005:1:0:31",
      "videoId":"75000000-0000-4000-8000-000000000005",
      "youtubeVideoId":"eeeeeee0005",
      "title":"Race evidence","channelName":"Race channel",
      "text":"Race evidence remains coherent.",
      "segmentOrdinal":1,"excerptStartCharacter":0,
      "excerptEndCharacter":31,"startSeconds":5,"endSeconds":8,
      "language":"en","truncatedStart":false,"truncatedEnd":false
    }]
  }'::jsonb;
begin
  select messages.conversation_id, messages.completion_attempt_token
  into conversation_id, attempt_token
  from public.project_conversation_messages as messages
  where messages.id = 'c5000000-0000-4000-8000-000000000006';
  select evidence_version into initial_evidence_version
  from public.videos
  where id = '75000000-0000-4000-8000-000000000005';

  perform dblink_connect('grounded_evidence_mutation', connection_string);
  perform dblink_connect('grounded_evidence_attach', connection_string);
  perform dblink_connect('grounded_evidence_completion', connection_string);
  perform dblink_exec('grounded_evidence_attach', 'set role authenticated');
  perform dblink_exec(
    'grounded_evidence_attach',
    'set request.jwt.claim.sub = ''95000000-0000-4000-8000-000000000005'''
  );
  perform dblink_exec('grounded_evidence_completion', 'set role service_role');

  perform dblink_exec('grounded_evidence_mutation', 'begin');
  mutation_result := dblink_exec(
    'grounded_evidence_mutation',
    $query$
      update public.video_transcripts
      set segments = '[{
        "text":"Race evidence changed concurrently.",
        "start":5,"duration":3
      }]'::jsonb
      where video_id = '75000000-0000-4000-8000-000000000005'
    $query$
  );
  -- The evidence mutation has bumped the Video version but remains
  -- uncommitted. Membership attaches against the old visible version; a
  -- completion starting now must wait for and then reject the changed Video.
  select result into attach_result
  from dblink(
    'grounded_evidence_attach',
    $attach$select public.add_project_history_video(
      'a5000000-0000-4000-8000-000000000005',
      '75000000-0000-4000-8000-000000000005',
      3
    )$attach$
  ) as attached(result jsonb);
  perform dblink_send_query(
    'grounded_evidence_completion',
    pg_catalog.format(
      'select public.complete_project_grounded_answer_v2(%L,%L,%L,%L,%L,%L,%L,%s,%L::jsonb,%L::jsonb,%L::jsonb,%L)',
      '95000000-0000-4000-8000-000000000005',
      'a5000000-0000-4000-8000-000000000005',
      conversation_id,
      'c5000000-0000-4000-8000-000000000006',
      attempt_token,
      'Race answer [S1 @ 00:05].',
      'supported',
      4,
      manifest::text,
      coverage::text,
      snapshot::text,
      'question'
    )
  );
  perform pg_sleep(0.1);
  perform dblink_exec('grounded_evidence_mutation', 'commit');

  select result into completion_result
  from dblink_get_result('grounded_evidence_completion') as raced(result jsonb);
  perform result
  from dblink_get_result('grounded_evidence_completion') as clear(result jsonb);

  if mutation_result <> 'UPDATE 1'
    or attach_result <> '{"outcome":"added","revision":4}'::jsonb
    or completion_result <> '{"outcome":"stale"}'::jsonb
    or (select evidence_version from public.videos
        where id = '75000000-0000-4000-8000-000000000005')
      <> initial_evidence_version + 1
    or exists (
      select 1
      from public.project_conversation_messages
      where in_reply_to_message_id =
        'c5000000-0000-4000-8000-000000000006'
        and role = 'assistant'
    )
  then
    raise exception 'REGRESSION: completion/evidence mutation race mixed states: %, %',
      mutation_result, completion_result;
  end if;

  perform dblink_disconnect('grounded_evidence_mutation');
  perform dblink_disconnect('grounded_evidence_attach');
  perform dblink_disconnect('grounded_evidence_completion');
end;
$$;

delete from auth.users
where id = '95000000-0000-4000-8000-000000000005';
delete from public.videos
where id = '75000000-0000-4000-8000-000000000005';

delete from auth.users
where id = '96000000-0000-4000-8000-000000000006';

-- Hold the same Project lock used by Source Set mutation while terminal
-- completion begins on another session. Completion must observe revision 2
-- and return stale; it may never persist revision-1 evidence after removal.
insert into auth.users (id, is_anonymous)
values ('95000000-0000-4000-8000-000000000005', false);

insert into public.projects (id, workspace_id, name)
select
  'a5000000-0000-4000-8000-000000000005',
  id,
  'Completion revision race Project'
from public.workspaces
where owner_id = '95000000-0000-4000-8000-000000000005';

insert into public.project_source_sets (project_id, revision)
values ('a5000000-0000-4000-8000-000000000005', 1);

insert into public.videos (
  id, youtube_url, url_hash, title, channel_name, language
) values (
  '75000000-0000-4000-8000-000000000005',
  'https://www.youtube.com/watch?v=eeeeeee0005',
  'eeeeeee0005', 'Race evidence', 'Race channel', 'en'
);
insert into public.video_transcripts (
  video_id, transcript_source, language, segments
) values (
  '75000000-0000-4000-8000-000000000005',
  'manual_captions', 'en',
  '[{"text":"Race evidence remains coherent.","start":5,"duration":3}]'
);
insert into public.summaries (
  video_id, summary, transcript_source, output_language
)
values (
  '75000000-0000-4000-8000-000000000005',
  'Race ready evidence', 'manual_captions', null
);
insert into public.project_videos (project_id, video_id, position, status)
values (
  'a5000000-0000-4000-8000-000000000005',
  '75000000-0000-4000-8000-000000000005', 1, 'ready'
);

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '95000000-0000-4000-8000-000000000005',
  false
);
select public.start_project_grounded_question(
  'a5000000-0000-4000-8000-000000000005',
  'What does the race evidence say?'
);
reset role;

insert into public.project_conversation_messages (
  id,
  conversation_id,
  role,
  content,
  completion_attempt_token,
  completion_state,
  source_set_revision,
  analysis_mode,
  created_at,
  lease_expires_at
)
select
  'd5000000-0000-4000-8000-000000000006',
  conversations.id,
  'user',
  'Slow persistence reload race',
  'e5000000-0000-4000-8000-000000000006',
  'reserved',
  1,
  'question',
  pg_catalog.now() - interval '300 seconds',
  pg_catalog.now() - interval '1 second'
from public.project_conversations as conversations
where conversations.project_id = 'a5000000-0000-4000-8000-000000000005'
  and conversations.kind = 'default';

do $$
declare
  connection_string text := pg_catalog.format('dbname=%L', current_database());
  conversation_id uuid;
  user_message_id uuid;
  attempt_token uuid;
  mutation_result jsonb;
  completion_result jsonb;
  slow_persistence_result jsonb;
  slow_reload_result jsonb;
  slow_persistence_barrier_observed boolean := false;
  slow_user_message_id uuid := 'd5000000-0000-4000-8000-000000000006';
  slow_attempt_token uuid := 'e5000000-0000-4000-8000-000000000006';
  manifest jsonb := '{
    "projectId":"a5000000-0000-4000-8000-000000000005",
    "sourceSetRevision":1,
    "sources":[{
      "sourceId":"S1",
      "videoId":"75000000-0000-4000-8000-000000000005",
      "youtubeVideoId":"eeeeeee0005",
      "title":"Race evidence",
      "channelName":"Race channel",
      "passages":[{
        "passageId":"75000000-0000-4000-8000-000000000005:1:0:31",
        "startSeconds":5,"endSeconds":8
      }]
    }]
  }'::jsonb;
  coverage jsonb := '{
    "totalVideos":1,"readyVideos":1,"usedVideos":1,
    "unavailableVideos":[],"passagesExamined":1,"passagesUsed":1
  }'::jsonb;
  snapshot jsonb := '{
    "projectId":"a5000000-0000-4000-8000-000000000005",
    "sourceSetRevision":1,
    "passages":[{
      "passageId":"75000000-0000-4000-8000-000000000005:1:0:31",
      "videoId":"75000000-0000-4000-8000-000000000005",
      "youtubeVideoId":"eeeeeee0005",
      "title":"Race evidence","channelName":"Race channel",
      "text":"Race evidence remains coherent.",
      "segmentOrdinal":1,"excerptStartCharacter":0,
      "excerptEndCharacter":31,"startSeconds":5,"endSeconds":8,
      "language":"en","truncatedStart":false,"truncatedEnd":false
    }]
  }'::jsonb;
begin
  select conversations.id, messages.id, messages.completion_attempt_token
  into conversation_id, user_message_id, attempt_token
  from public.project_conversations as conversations
  join public.project_conversation_messages as messages
    on messages.conversation_id = conversations.id
  where conversations.project_id = 'a5000000-0000-4000-8000-000000000005'
    and messages.role = 'user'
    and messages.id <> slow_user_message_id;

  perform dblink_connect('grounded_revision_mutation', connection_string);
  perform dblink_connect('grounded_revision_completion', connection_string);
  perform dblink_exec('grounded_revision_mutation', 'set role authenticated');
  perform dblink_exec(
    'grounded_revision_mutation',
    'set request.jwt.claim.sub = ''95000000-0000-4000-8000-000000000005'''
  );
  perform dblink_exec('grounded_revision_completion', 'set role service_role');

  perform dblink_send_query(
    'grounded_revision_mutation',
    $query$
      with locked_project as materialized (
        select projects.id
        from public.projects
        join public.workspaces on workspaces.id = projects.workspace_id
        where projects.id = 'a5000000-0000-4000-8000-000000000005'
          and workspaces.owner_id = '95000000-0000-4000-8000-000000000005'
        for update of projects
      ), pause as materialized (
        select pg_sleep(0.3) from locked_project
      )
      select public.remove_project_video(
        'a5000000-0000-4000-8000-000000000005',
        '75000000-0000-4000-8000-000000000005',
        1
      ) from pause
    $query$
  );
  perform pg_sleep(0.1);
  perform dblink_send_query(
    'grounded_revision_completion',
    pg_catalog.format(
      'select public.complete_project_grounded_answer_v2(%L,%L,%L,%L,%L,%L,%L,%s,%L::jsonb,%L::jsonb,%L::jsonb)',
      '95000000-0000-4000-8000-000000000005',
      'a5000000-0000-4000-8000-000000000005',
      conversation_id, user_message_id, attempt_token,
      'Race answer [S1 @ 00:05].', 'supported', 1,
      manifest::text, coverage::text, snapshot::text
    )
  );

  select result into mutation_result
  from dblink_get_result('grounded_revision_mutation') as raced(result jsonb);
  select result into completion_result
  from dblink_get_result('grounded_revision_completion') as raced(result jsonb);
  perform result from dblink_get_result('grounded_revision_mutation') as clear(result jsonb);
  perform result from dblink_get_result('grounded_revision_completion') as clear(result jsonb);

  if mutation_result <> '{"outcome":"removed","revision":2}'::jsonb
    or completion_result <> '{"outcome":"stale"}'::jsonb
    or exists (
      select 1 from public.project_conversation_messages
      where in_reply_to_message_id = user_message_id and role = 'assistant'
    )
  then
    raise exception 'REGRESSION: completion/source mutation race mixed revisions: %, %',
      mutation_result, completion_result;
  end if;

  perform dblink_disconnect('grounded_revision_mutation');
  perform dblink_disconnect('grounded_revision_completion');

  -- The stale revision attempt remains reserved. Race its exact token through
  -- the two service-only terminal seams. Atomic begin and cancellation lock
  -- the exact user attempt first, so only cancellation or persistence can own
  -- the transition.
  manifest := '{
    "projectId":"a5000000-0000-4000-8000-000000000005",
    "sourceSetRevision":2,"sources":[]
  }'::jsonb;
  coverage := '{
    "totalVideos":0,"readyVideos":0,"usedVideos":0,
    "unavailableVideos":[],"passagesExamined":0,"passagesUsed":0
  }'::jsonb;
  snapshot := '{
    "projectId":"a5000000-0000-4000-8000-000000000005",
    "sourceSetRevision":2,"passages":[]
  }'::jsonb;

  perform dblink_connect('grounded_terminal_cancel', connection_string);
  perform dblink_connect('grounded_terminal_complete', connection_string);
  perform dblink_exec('grounded_terminal_cancel', 'set role service_role');
  perform dblink_exec('grounded_terminal_complete', 'set role service_role');

  perform dblink_send_query(
    'grounded_terminal_cancel',
    pg_catalog.format(
      'with pause as materialized (select pg_sleep(0.2)) select public.cancel_project_grounded_question_v2(%L,%L,%L,%L,%L) from pause',
      '95000000-0000-4000-8000-000000000005',
      'a5000000-0000-4000-8000-000000000005',
      conversation_id, user_message_id, attempt_token
    )
  );
  perform dblink_send_query(
    'grounded_terminal_complete',
    pg_catalog.format(
      'with pause as materialized (select pg_sleep(0.2)) select public.begin_project_grounded_answer_persistence_v2(%L,%L,%L,%L,%L,%L,%L,%s,%L::jsonb,%L::jsonb,%L::jsonb,%L) from pause',
      '95000000-0000-4000-8000-000000000005',
      'a5000000-0000-4000-8000-000000000005',
      conversation_id, user_message_id, attempt_token,
      'The available Project evidence does not support an answer.',
      'abstained', 2, manifest::text, coverage::text, snapshot::text,
      'question'
    )
  );

  select result into mutation_result
  from dblink_get_result('grounded_terminal_cancel') as raced(result jsonb);
  select result into completion_result
  from dblink_get_result('grounded_terminal_complete') as raced(result jsonb);
  perform result from dblink_get_result('grounded_terminal_cancel') as clear(result jsonb);
  perform result from dblink_get_result('grounded_terminal_complete') as clear(result jsonb);

  if mutation_result ->> 'outcome' = 'cancelled' then
    if completion_result <> '{"outcome":"stale"}'::jsonb
      or (select completion_state
          from public.project_conversation_messages
          where id = user_message_id) <> 'cancelled'
      or exists (
        select 1 from public.project_conversation_messages
        where in_reply_to_message_id = user_message_id and role = 'assistant'
      )
    then
      raise exception 'REGRESSION: cancellation won but completion persisted: %, %',
        mutation_result, completion_result;
    end if;
  elsif completion_result ->> 'outcome' = 'completed' then
    if mutation_result ->> 'outcome' <> 'completed'
      or (select completion_state
          from public.project_conversation_messages
          where id = user_message_id) <> 'completed'
      or (select count(*)
          from public.project_conversation_messages
          where in_reply_to_message_id = user_message_id
            and role = 'assistant') <> 1
    then
      raise exception 'REGRESSION: completion won but cancellation drifted: %, %',
        mutation_result, completion_result;
    end if;
  else
    raise exception 'REGRESSION: terminal race had no coherent winner: %, %',
      mutation_result, completion_result;
  end if;

  perform dblink_disconnect('grounded_terminal_cancel');
  perform dblink_disconnect('grounded_terminal_complete');

  -- An already-expired lease cannot be reaped once atomic persistence has
  -- acquired the attempt row. Hold the completed transaction open while an
  -- owner reload tries the shared reaper: reload must wait and then observe
  -- the durable assistant, never a cancelled user-only turn.
  perform dblink_connect('grounded_slow_persistence', connection_string);
  perform dblink_connect('grounded_slow_reload', connection_string);
  perform dblink_exec('grounded_slow_persistence', 'set role service_role');
  perform dblink_exec('grounded_slow_reload', 'set role authenticated');
  perform dblink_exec(
    'grounded_slow_reload',
    'set request.jwt.claim.sub = ''95000000-0000-4000-8000-000000000005'''
  );

  perform dblink_send_query(
    'grounded_slow_persistence',
    pg_catalog.format(
      'with persisted as materialized ('
        || 'select public.begin_project_grounded_answer_persistence_v2('
        || '%L,%L,%L,%L,%L,%L,%L,%s,%L::jsonb,%L::jsonb,%L::jsonb,%L) as result'
        || '), barrier as materialized ('
        || 'select pg_advisory_xact_lock(348, 325), persisted.result from persisted'
        || '), pause as materialized (select pg_sleep(0.3) from barrier) '
        || 'select barrier.result from barrier, pause',
      '95000000-0000-4000-8000-000000000005',
      'a5000000-0000-4000-8000-000000000005',
      conversation_id,
      slow_user_message_id,
      slow_attempt_token,
      'The current Project evidence does not support an answer.',
      'abstained',
      2,
      manifest::text,
      coverage::text,
      snapshot::text,
      'question'
    )
  );

  -- dblink_send_query only confirms dispatch. Observe a transaction-scoped
  -- barrier acquired after persistence has locked and updated the attempt row
  -- before allowing reload's lease reaper to contend for that row.
  for barrier_attempt in 1..100 loop
    if not pg_catalog.pg_try_advisory_lock(348, 325) then
      slow_persistence_barrier_observed := true;
      exit;
    end if;

    perform pg_catalog.pg_advisory_unlock(348, 325);
    perform pg_catalog.pg_sleep(0.01);
  end loop;

  if not slow_persistence_barrier_observed then
    raise exception 'REGRESSION: slow persistence never reached the row-lock barrier';
  end if;

  perform dblink_send_query(
    'grounded_slow_reload',
    pg_catalog.format(
      'select public.load_project_grounded_attempt_v2(%L,%L,%L)',
      'a5000000-0000-4000-8000-000000000005',
      slow_user_message_id,
      conversation_id
    )
  );

  select result into slow_persistence_result
  from dblink_get_result('grounded_slow_persistence') as persisted(result jsonb);
  select result into slow_reload_result
  from dblink_get_result('grounded_slow_reload') as reloaded(result jsonb);
  perform result
  from dblink_get_result('grounded_slow_persistence') as clear(result jsonb);
  perform result
  from dblink_get_result('grounded_slow_reload') as clear(result jsonb);

  if slow_persistence_result ->> 'outcome' <> 'completed'
    or slow_reload_result ->> 'outcome' <> 'ready'
    or slow_reload_result ->> 'completionState' <> 'completed'
    or slow_reload_result #>> '{assistant,content}'
      <> 'The current Project evidence does not support an answer.'
    or (select completion_state
        from public.project_conversation_messages
        where id = slow_user_message_id) <> 'completed'
  then
    raise exception 'REGRESSION: slow persistence/reload race lost terminal state: %, %',
      slow_persistence_result, slow_reload_result;
  end if;

  perform dblink_disconnect('grounded_slow_persistence');
  perform dblink_disconnect('grounded_slow_reload');
end;
$$;

delete from auth.users
where id = '95000000-0000-4000-8000-000000000005';

reset search_path;
