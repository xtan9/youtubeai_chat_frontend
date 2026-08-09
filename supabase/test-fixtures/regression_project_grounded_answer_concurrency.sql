-- Exercise two real PostgreSQL sessions racing from four to the Free
-- per-Project five-message cap. Exactly one reservation may commit.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

insert into auth.users (id, is_anonymous)
values ('94000000-0000-4000-8000-000000000004', false);

insert into public.projects (id, workspace_id, name)
select
  'a4000000-0000-4000-8000-000000000004',
  id,
  'Concurrent Grounded Answer Project'
from public.workspaces
where owner_id = '94000000-0000-4000-8000-000000000004';

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '94000000-0000-4000-8000-000000000004',
  false
);
select public.start_project_grounded_question(
  'a4000000-0000-4000-8000-000000000004',
  'Existing question one'
);
select public.start_project_grounded_question(
  'a4000000-0000-4000-8000-000000000004',
  'Existing question two'
);
select public.start_project_grounded_question(
  'a4000000-0000-4000-8000-000000000004',
  'Existing question three'
);
select public.start_project_grounded_question(
  'a4000000-0000-4000-8000-000000000004',
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
    'set request.jwt.claim.sub = ''94000000-0000-4000-8000-000000000004'''
  );
  perform dblink_exec(
    'grounded_cap_b',
    'set request.jwt.claim.sub = ''94000000-0000-4000-8000-000000000004'''
  );

  perform dblink_send_query(
    'grounded_cap_a',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      select public.start_project_grounded_question(
        'a4000000-0000-4000-8000-000000000004',
        'Racing fifth question A'
      ) from pause
    $query$
  );
  perform dblink_send_query(
    'grounded_cap_b',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      select public.start_project_grounded_question(
        'a4000000-0000-4000-8000-000000000004',
        'Racing fifth question B'
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
          = 'a4000000-0000-4000-8000-000000000004'
          and project_conversation_messages.role = 'user') <> 5
    or (select count(*)
        from public.project_conversations
        where project_id = 'a4000000-0000-4000-8000-000000000004'
          and kind = 'default') <> 1
  then
    raise exception 'REGRESSION: concurrent fifth/sixth question violated cap: %, %',
      result_a, result_b;
  end if;

  perform dblink_disconnect('grounded_cap_a');
  perform dblink_disconnect('grounded_cap_b');
end;
$$;

-- Completion must hold the same Project lock as every Source Set mutation
-- across revision validation and the assistant insert. Coordinate two real
-- sessions at a trigger synchronization point so this interleaving is
-- deterministic rather than dependent on scheduler timing.
create table public.issue318_revision_race_audit (
  event text primary key,
  observed_at timestamptz not null
);

revoke all on table public.issue318_revision_race_audit
  from public, anon, authenticated, service_role;

create function public.issue318_pause_assistant_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'assistant' and exists (
    select 1
    from public.project_conversations
    where id = new.conversation_id
      and project_id = 'a4000000-0000-4000-8000-000000000004'
  ) then
    perform pg_catalog.pg_advisory_xact_lock(3180911);
    perform pg_catalog.pg_sleep(0.6);
    insert into public.issue318_revision_race_audit (event, observed_at)
    values ('assistant_insert', pg_catalog.clock_timestamp());
  end if;
  return new;
end;
$$;

create trigger issue318_pause_assistant_insert
before insert on public.project_conversation_messages
for each row execute function public.issue318_pause_assistant_insert();

do $$
declare
  connection_string text := pg_catalog.format('dbname=%L', current_database());
  conversation_id uuid;
  user_message_id uuid;
  attempt_token uuid;
  completion_pid integer;
  poll_index integer;
  completion_query text;
  completion_result jsonb;
  mutation_result jsonb;
  completion_busy integer;
  mutation_busy integer;
begin
  select conversations.id, messages.id, messages.completion_attempt_token
  into conversation_id, user_message_id, attempt_token
  from public.project_conversations as conversations
  join public.project_conversation_messages as messages
    on messages.conversation_id = conversations.id
  where conversations.project_id = 'a4000000-0000-4000-8000-000000000004'
    and conversations.kind = 'default'
    and messages.role = 'user'
    and messages.completion_state = 'reserved'
  order by messages.created_at, messages.id
  limit 1;

  completion_query := pg_catalog.format(
    $query$
      select public.complete_project_grounded_answer(
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid,
        %L::uuid,
        'The available Project passages do not support an answer.',
        'unsupported',
        0,
        %L::jsonb,
        %L::jsonb,
        %L::jsonb,
        '[]'::jsonb
      )
    $query$,
    '94000000-0000-4000-8000-000000000004',
    'a4000000-0000-4000-8000-000000000004',
    conversation_id,
    user_message_id,
    attempt_token,
    '{"projectId":"a4000000-0000-4000-8000-000000000004","sourceSetRevision":0,"sources":[]}',
    '{"totalVideos":0,"readyVideos":0,"evidenceVideos":0,"unavailableVideos":[],"passagesExamined":0,"evidencePassages":0}',
    '{"projectId":"a4000000-0000-4000-8000-000000000004","sourceSetRevision":0,"passages":[]}'
  );

  perform dblink_connect('grounded_revision_complete', connection_string);
  perform dblink_connect('grounded_revision_mutate', connection_string);
  select pid into completion_pid
  from dblink(
    'grounded_revision_complete',
    'select pg_catalog.pg_backend_pid()'
  ) as backend(pid integer);
  perform dblink_exec('grounded_revision_complete', 'set role service_role');
  perform dblink_send_query('grounded_revision_complete', completion_query);

  for poll_index in 1..100 loop
    exit when exists (
      select 1
      from pg_catalog.pg_locks
      where pid = completion_pid
        and locktype = 'advisory'
        and granted
    );
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  if not exists (
    select 1
    from pg_catalog.pg_locks
    where pid = completion_pid
      and locktype = 'advisory'
      and granted
  ) then
    raise exception 'REGRESSION: completion did not reach revision race barrier';
  end if;

  perform dblink_send_query(
    'grounded_revision_mutate',
    $query$
      with locked_project as materialized (
        select id
        from public.projects
        where id = 'a4000000-0000-4000-8000-000000000004'
        for update
      ), inserted_source_set as (
        insert into public.project_source_sets (project_id, revision)
        select id, 1
        from locked_project
        returning revision
      ), audited as (
        insert into public.issue318_revision_race_audit (event, observed_at)
        select 'source_mutation', pg_catalog.clock_timestamp()
        from inserted_source_set
        returning observed_at
      )
      select pg_catalog.jsonb_build_object(
        'revision', inserted_source_set.revision,
        'observedAt', audited.observed_at
      )
      from inserted_source_set
      cross join audited
    $query$
  );

  perform pg_catalog.pg_sleep(0.1);
  select dblink_is_busy('grounded_revision_complete')
  into completion_busy;
  select dblink_is_busy('grounded_revision_mutate')
  into mutation_busy;
  if completion_busy <> 1 or mutation_busy <> 1 then
    raise exception 'REGRESSION: Source Set mutation crossed active completion lock: %, %',
      completion_busy, mutation_busy;
  end if;

  select result into completion_result
  from dblink_get_result('grounded_revision_complete') as completed(result jsonb);
  select result into mutation_result
  from dblink_get_result('grounded_revision_mutate') as mutated(result jsonb);
  perform result
  from dblink_get_result('grounded_revision_complete') as cleared(result jsonb);
  perform result
  from dblink_get_result('grounded_revision_mutate') as cleared(result jsonb);

  if completion_result ->> 'outcome' <> 'completed'
    or mutation_result ->> 'revision' <> '1'
    or (
      select observed_at
      from public.issue318_revision_race_audit
      where event = 'assistant_insert'
    ) >= (
      select observed_at
      from public.issue318_revision_race_audit
      where event = 'source_mutation'
    )
    or (
      select source_set_revision
      from public.project_conversation_messages
      where id = (completion_result ->> 'assistantMessageId')::uuid
    ) <> 0
  then
    raise exception 'REGRESSION: answer/source revision boundary drifted: %, %',
      completion_result, mutation_result;
  end if;

  perform dblink_disconnect('grounded_revision_complete');
  perform dblink_disconnect('grounded_revision_mutate');
end;
$$;

drop trigger issue318_pause_assistant_insert
  on public.project_conversation_messages;
drop function public.issue318_pause_assistant_insert();
drop table public.issue318_revision_race_audit;

delete from auth.users
where id = '94000000-0000-4000-8000-000000000004';

reset search_path;
