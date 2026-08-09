-- Two real PostgreSQL connections race the Project Source Set RPCs. This is
-- intentionally separate from the transactional contract fixture because
-- dblink sessions must observe committed seed rows.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

begin;

insert into auth.users (id, is_anonymous)
values ('53000000-0000-4000-8000-000000000003', false)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

-- Two Projects are required to exercise independent concurrency shapes;
-- the Free one-Project allowance has its own dedicated race fixture.
insert into public.user_subscriptions (
  user_id,
  stripe_customer_id,
  tier,
  status
)
values (
  '53000000-0000-4000-8000-000000000003',
  'cus_project_source_set_concurrency',
  'pro',
  'active'
)
on conflict (user_id) do update set
  tier = excluded.tier,
  status = excluded.status;

insert into public.projects (id, workspace_id, name)
select 'a2000000-0000-4000-8000-000000000001', id, 'Concurrent cap project'
from public.workspaces
where owner_id = '53000000-0000-4000-8000-000000000003';

insert into public.projects (id, workspace_id, name)
select 'a2000000-0000-4000-8000-000000000002', id, 'Concurrent order project'
from public.workspaces
where owner_id = '53000000-0000-4000-8000-000000000003';

insert into public.videos (
  id,
  youtube_url,
  url_hash,
  title,
  channel_name,
  language
)
select
  format('7%1$s000000-0000-4000-8000-00000000000%1$s', ordinal)::uuid,
  format('https://www.youtube.com/watch?v=racevideo00%s', ordinal),
  format('source-set-race-%s', ordinal),
  format('Race source %s', ordinal),
  'Concurrency Lab',
  'en'
from generate_series(1, 6) as ordinal;

insert into public.video_transcripts (
  video_id,
  transcript_source,
  language,
  segments
)
select
  format('7%1$s000000-0000-4000-8000-00000000000%1$s', ordinal)::uuid,
  'manual_captions',
  'en',
  jsonb_build_array(
    jsonb_build_object(
      'text', format('Race transcript %s', ordinal),
      'start', 0,
      'duration', 5
    )
  )
from generate_series(1, 6) as ordinal;

insert into public.summaries (
  video_id,
  summary,
  transcript_source,
  output_language
)
select
  format('7%1$s000000-0000-4000-8000-00000000000%1$s', ordinal)::uuid,
  format('Race summary %s', ordinal),
  'manual_captions',
  null
from generate_series(1, 6) as ordinal;

insert into public.user_video_history (user_id, video_id)
select
  '53000000-0000-4000-8000-000000000003',
  format('7%1$s000000-0000-4000-8000-00000000000%1$s', ordinal)::uuid
from generate_series(1, 6) as ordinal;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '53000000-0000-4000-8000-000000000003',
  true
);

select public.add_project_history_video(
  'a2000000-0000-4000-8000-000000000001',
  format('7%1$s000000-0000-4000-8000-00000000000%1$s', ordinal)::uuid,
  ordinal - 1
)
from generate_series(1, 4) as ordinal;

select public.add_project_history_video(
  'a2000000-0000-4000-8000-000000000002',
  format('7%1$s000000-0000-4000-8000-00000000000%1$s', ordinal)::uuid,
  ordinal - 1
)
from generate_series(1, 3) as ordinal;

commit;

do $$
declare
  connection_string text := 'dbname=' || current_database();
  cap_a jsonb;
  cap_b jsonb;
  order_a jsonb;
  order_b jsonb;
  positions smallint[];
  final_order uuid[];
begin
  perform dblink_connect('source_cap_a', connection_string);
  perform dblink_connect('source_cap_b', connection_string);
  perform dblink_exec('source_cap_a', 'set role authenticated');
  perform dblink_exec('source_cap_b', 'set role authenticated');
  perform dblink_exec(
    'source_cap_a',
    'set request.jwt.claim.sub = ''53000000-0000-4000-8000-000000000003'''
  );
  perform dblink_exec(
    'source_cap_b',
    'set request.jwt.claim.sub = ''53000000-0000-4000-8000-000000000003'''
  );

  perform dblink_send_query(
    'source_cap_a',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      select public.add_project_history_video(
        'a2000000-0000-4000-8000-000000000001',
        '75000000-0000-4000-8000-000000000005',
        4
      ) from pause
    $query$
  );
  perform dblink_send_query(
    'source_cap_b',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      select public.add_project_history_video(
        'a2000000-0000-4000-8000-000000000001',
        '76000000-0000-4000-8000-000000000006',
        4
      ) from pause
    $query$
  );

  select result into cap_a
  from dblink_get_result('source_cap_a') as raced(result jsonb);
  select result into cap_b
  from dblink_get_result('source_cap_b') as raced(result jsonb);
  perform result
  from dblink_get_result('source_cap_a') as cleared(result jsonb);
  perform result
  from dblink_get_result('source_cap_b') as cleared(result jsonb);

  if array[cap_a->>'outcome', cap_b->>'outcome'] @> array['added', 'conflict']
    is not true
    or (select count(*) from public.project_videos
        where project_id = 'a2000000-0000-4000-8000-000000000001') <> 5
    or (select revision from public.project_source_sets
        where project_id = 'a2000000-0000-4000-8000-000000000001') <> 5 then
    raise exception 'REGRESSION: simultaneous fifth/sixth add violated cap or revision';
  end if;

  select array_agg(position order by position)
  into positions
  from public.project_videos
  where project_id = 'a2000000-0000-4000-8000-000000000001';
  if positions <> array[1, 2, 3, 4, 5]::smallint[] then
    raise exception 'REGRESSION: cap race left non-contiguous positions';
  end if;

  perform dblink_send_query(
    'source_cap_a',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      select public.reorder_project_videos(
        'a2000000-0000-4000-8000-000000000002',
        array[
          '73000000-0000-4000-8000-000000000003',
          '72000000-0000-4000-8000-000000000002',
          '71000000-0000-4000-8000-000000000001'
        ]::uuid[],
        3
      ) from pause
    $query$
  );
  perform dblink_send_query(
    'source_cap_b',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      select public.remove_project_video(
        'a2000000-0000-4000-8000-000000000002',
        '72000000-0000-4000-8000-000000000002',
        3
      ) from pause
    $query$
  );

  select result into order_a
  from dblink_get_result('source_cap_a') as raced(result jsonb);
  select result into order_b
  from dblink_get_result('source_cap_b') as raced(result jsonb);

  if not (
    (order_a->>'outcome' = 'reordered' and order_b->>'outcome' = 'conflict')
    or (order_a->>'outcome' = 'conflict' and order_b->>'outcome' = 'removed')
  ) or (select revision from public.project_source_sets
        where project_id = 'a2000000-0000-4000-8000-000000000002') <> 4 then
    raise exception 'REGRESSION: reorder/remove race did not serialize once';
  end if;

  select
    array_agg(position order by position),
    array_agg(video_id order by position)
  into positions, final_order
  from public.project_videos
  where project_id = 'a2000000-0000-4000-8000-000000000002';

  if order_a->>'outcome' = 'reordered' then
    if positions <> array[1, 2, 3]::smallint[]
      or final_order <> array[
        '73000000-0000-4000-8000-000000000003',
        '72000000-0000-4000-8000-000000000002',
        '71000000-0000-4000-8000-000000000001'
      ]::uuid[] then
      raise exception 'REGRESSION: reorder winner did not leave coherent order';
    end if;
  elsif positions <> array[1, 2]::smallint[]
    or '72000000-0000-4000-8000-000000000002'::uuid = any(final_order) then
    raise exception 'REGRESSION: remove winner did not compact coherent order';
  end if;

  perform dblink_disconnect('source_cap_a');
  perform dblink_disconnect('source_cap_b');
end;
$$;

delete from auth.users
where id = '53000000-0000-4000-8000-000000000003';

delete from public.videos
where id in (
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000002',
  '73000000-0000-4000-8000-000000000003',
  '74000000-0000-4000-8000-000000000004',
  '75000000-0000-4000-8000-000000000005',
  '76000000-0000-4000-8000-000000000006'
);

reset search_path;
