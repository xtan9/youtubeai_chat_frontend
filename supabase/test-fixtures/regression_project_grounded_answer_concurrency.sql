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

delete from auth.users
where id = '94000000-0000-4000-8000-000000000004';

reset search_path;
