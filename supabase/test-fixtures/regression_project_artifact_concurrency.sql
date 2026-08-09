-- Two real PostgreSQL sessions race for the one Free Artifact reservation.
-- Exactly one may reserve; the other must observe the atomic 402 condition.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

insert into auth.users (id, is_anonymous)
values ('83000000-0000-4000-8000-000000000003', false);

insert into public.projects (id, workspace_id, name)
select
  'a8300000-0000-4000-8000-000000000003',
  id,
  'Concurrent Study Guide Project'
from public.workspaces
where owner_id = '83000000-0000-4000-8000-000000000003';

do $$
declare
  connection_string text := pg_catalog.format('dbname=%L', current_database());
  result_a jsonb;
  result_b jsonb;
  outcomes text[];
begin
  perform dblink_connect('artifact_cap_a', connection_string);
  perform dblink_connect('artifact_cap_b', connection_string);
  perform dblink_exec('artifact_cap_a', 'set role authenticated');
  perform dblink_exec('artifact_cap_b', 'set role authenticated');
  perform dblink_exec(
    'artifact_cap_a',
    'set request.jwt.claim.sub = ''83000000-0000-4000-8000-000000000003'''
  );
  perform dblink_exec(
    'artifact_cap_b',
    'set request.jwt.claim.sub = ''83000000-0000-4000-8000-000000000003'''
  );

  perform dblink_send_query(
    'artifact_cap_a',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      select public.reserve_project_artifact_generation(
        'a8300000-0000-4000-8000-000000000003',
        'study_guide',
        '56000000-0000-4000-8000-000000000006'
      ) from pause
    $query$
  );
  perform dblink_send_query(
    'artifact_cap_b',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      select public.reserve_project_artifact_generation(
        'a8300000-0000-4000-8000-000000000003',
        'creator_brief',
        '57000000-0000-4000-8000-000000000007'
      ) from pause
    $query$
  );

  select result into result_a
  from dblink_get_result('artifact_cap_a') as raced(result jsonb);
  select result into result_b
  from dblink_get_result('artifact_cap_b') as raced(result jsonb);
  perform result
  from dblink_get_result('artifact_cap_a') as cleared(result jsonb);
  perform result
  from dblink_get_result('artifact_cap_b') as cleared(result jsonb);

  outcomes := array[result_a ->> 'outcome', result_b ->> 'outcome'];
  if not (outcomes @> array['started', 'limit_reached'])
    or (
      select count(*)
      from public.project_artifact_generation_attempts
      where workspace_id = (
        select id from public.workspaces
        where owner_id = '83000000-0000-4000-8000-000000000003'
      )
        and attempt_state = 'reserved'
    ) <> 1
  then
    raise exception 'REGRESSION: concurrent Free Artifact cap drifted: %, %',
      result_a, result_b;
  end if;

  perform dblink_disconnect('artifact_cap_a');
  perform dblink_disconnect('artifact_cap_b');
end;
$$;

delete from auth.users
where id = '83000000-0000-4000-8000-000000000003';

reset search_path;
