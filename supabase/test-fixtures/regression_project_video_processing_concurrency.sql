-- Real multi-connection proof that duplicate Project URL requests elect one
-- processing owner and that simultaneous fifth/sixth URLs cannot exceed the
-- universal cap or create a losing canonical row.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

begin;

insert into auth.users (id, is_anonymous)
values ('56000000-0000-4000-8000-000000000006', false)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

insert into public.user_subscriptions (user_id, stripe_customer_id, tier, status)
values (
  '56000000-0000-4000-8000-000000000006',
  'cus_project_url_concurrency',
  'pro',
  'active'
)
on conflict (user_id) do update set tier = excluded.tier, status = excluded.status;

insert into public.projects (id, workspace_id, name)
select 'a4000000-0000-4000-8000-000000000001', id, 'Duplicate URL race'
from public.workspaces
where owner_id = '56000000-0000-4000-8000-000000000006';

insert into public.projects (id, workspace_id, name)
select 'a4000000-0000-4000-8000-000000000002', id, 'URL cap race'
from public.workspaces
where owner_id = '56000000-0000-4000-8000-000000000006';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '56000000-0000-4000-8000-000000000006',
  true
);
select public.start_project_video_processing(
  'a4000000-0000-4000-8000-000000000002',
  'racecap0001',
  0
);
select public.start_project_video_processing(
  'a4000000-0000-4000-8000-000000000002',
  'racecap0002',
  1
);
select public.start_project_video_processing(
  'a4000000-0000-4000-8000-000000000002',
  'racecap0003',
  2
);
select public.start_project_video_processing(
  'a4000000-0000-4000-8000-000000000002',
  'racecap0004',
  3
);
reset role;

commit;

do $$
declare
  connection_string text := 'dbname=' || current_database();
  duplicate_a jsonb;
  duplicate_b jsonb;
  cap_a jsonb;
  cap_b jsonb;
  duplicate_owners integer;
  cap_memberships integer;
  cap_canonical_rows integer;
begin
  perform dblink_connect('project_url_a', connection_string);
  perform dblink_connect('project_url_b', connection_string);
  perform dblink_exec('project_url_a', 'set role authenticated');
  perform dblink_exec('project_url_b', 'set role authenticated');
  perform dblink_exec(
    'project_url_a',
    'set request.jwt.claim.sub = ''56000000-0000-4000-8000-000000000006'''
  );
  perform dblink_exec(
    'project_url_b',
    'set request.jwt.claim.sub = ''56000000-0000-4000-8000-000000000006'''
  );

  perform dblink_send_query(
    'project_url_a',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      select public.start_project_video_processing(
        'a4000000-0000-4000-8000-000000000001',
        'racedupe001',
        0
      ) from pause
    $query$
  );
  perform dblink_send_query(
    'project_url_b',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      select public.start_project_video_processing(
        'a4000000-0000-4000-8000-000000000001',
        'racedupe001',
        0
      ) from pause
    $query$
  );

  select result into duplicate_a
  from dblink_get_result('project_url_a') as raced(result jsonb);
  select result into duplicate_b
  from dblink_get_result('project_url_b') as raced(result jsonb);
  perform result
  from dblink_get_result('project_url_a') as cleared(result jsonb);
  perform result
  from dblink_get_result('project_url_b') as cleared(result jsonb);

  duplicate_owners :=
    (duplicate_a->>'ownsProcessing')::boolean::integer
    + (duplicate_b->>'ownsProcessing')::boolean::integer;

  if duplicate_owners <> 1
    or array[duplicate_a->>'outcome', duplicate_b->>'outcome']
       @> array['started', 'already_processing'] is not true
    or duplicate_a->>'videoId' is distinct from duplicate_b->>'videoId'
    or (select count(*) from public.project_videos
        where project_id = 'a4000000-0000-4000-8000-000000000001') <> 1
    or (select count(*) from public.videos where url_hash = 'racedupe001') <> 1
    or (select revision from public.project_source_sets
        where project_id = 'a4000000-0000-4000-8000-000000000001') <> 1
  then
    raise exception 'REGRESSION: concurrent duplicate URLs did not elect exactly one owner';
  end if;

  perform dblink_send_query(
    'project_url_a',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      select public.start_project_video_processing(
        'a4000000-0000-4000-8000-000000000002',
        'racecap0005',
        4
      ) from pause
    $query$
  );
  perform dblink_send_query(
    'project_url_b',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      select public.start_project_video_processing(
        'a4000000-0000-4000-8000-000000000002',
        'racecap0006',
        4
      ) from pause
    $query$
  );

  select result into cap_a
  from dblink_get_result('project_url_a') as raced(result jsonb);
  select result into cap_b
  from dblink_get_result('project_url_b') as raced(result jsonb);

  select count(*) into cap_memberships
  from public.project_videos
  where project_id = 'a4000000-0000-4000-8000-000000000002';

  select count(*) into cap_canonical_rows
  from public.videos
  where url_hash in ('racecap0005', 'racecap0006');

  if not (
    (cap_a->>'outcome' = 'started' and cap_b->>'outcome' = 'conflict')
    or (cap_a->>'outcome' = 'conflict' and cap_b->>'outcome' = 'started')
  )
    or cap_memberships <> 5
    or cap_canonical_rows <> 1
    or (select revision from public.project_source_sets
        where project_id = 'a4000000-0000-4000-8000-000000000002') <> 5
  then
    raise exception 'REGRESSION: concurrent fifth/sixth URLs exceeded cap or leaked canonical state';
  end if;

  perform dblink_disconnect('project_url_a');
  perform dblink_disconnect('project_url_b');
end;
$$;

delete from auth.users
where id = '56000000-0000-4000-8000-000000000006';

delete from public.videos
where url_hash in (
  'racedupe001',
  'racecap0001',
  'racecap0002',
  'racecap0003',
  'racecap0004',
  'racecap0005',
  'racecap0006'
);

reset search_path;
