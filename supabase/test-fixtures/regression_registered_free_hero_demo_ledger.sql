-- Registered Free Hero Demo contract: a private, non-history ledger per
-- user and canonical demo, with atomic fifth/sixth admission.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

delete from public.registered_free_hero_demo_ledgers
where user_id in (
  '75000000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000002'
);

insert into auth.users (id, is_anonymous)
values
  ('75000000-0000-4000-8000-000000000001', false),
  ('75000000-0000-4000-8000-000000000002', false)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

insert into public.videos (
  youtube_url,
  youtube_video_id,
  url_hash,
  title
)
values (
  'https://www.youtube.com/watch?v=Hrbq66XqtCo',
  'Hrbq66XqtCo',
  'Hrbq66XqtCo',
  'Registered Free Hero Demo fixture'
)
on conflict (youtube_video_id) do update
set title = excluded.title;

insert into public.chat_messages (user_id, video_id, role, content)
select
  '75000000-0000-4000-8000-000000000001',
  videos.id,
  'user',
  'Representative visible Hero Demo conversation'
from public.videos
where videos.youtube_video_id = 'Hrbq66XqtCo';

do $$
begin
  if public.get_registered_free_hero_demo_chat_allowance(
    '75000000-0000-4000-8000-000000000001',
    'Hrbq66XqtCo'
  ) <> '{"outcome":"available","remainingMessages":5}'::jsonb then
    raise exception 'REGRESSION: fresh Registered Free demo allowance is not five';
  end if;
end;
$$;

do $$
declare
  result jsonb;
begin
  for attempt in 1..4 loop
    result := public.admit_registered_free_hero_demo_chat_message(
      '75000000-0000-4000-8000-000000000001',
      'Hrbq66XqtCo'
    );
    if result <> jsonb_build_object(
      'outcome', 'admitted',
      'remainingMessages', 5 - attempt
    ) then
      raise exception 'REGRESSION: sequential Registered Free admission % returned %',
        attempt, result;
    end if;
  end loop;
end;
$$;

select dblink_connect(
  'registered_free_demo_fifth',
  format('dbname=%L', current_database())
);
select dblink_connect(
  'registered_free_demo_sixth',
  format('dbname=%L', current_database())
);
select dblink_exec('registered_free_demo_fifth', 'begin');
select dblink_exec('registered_free_demo_fifth', 'set local role service_role');

select dblink_send_query(
  'registered_free_demo_fifth',
  $$
    select public.admit_registered_free_hero_demo_chat_message(
      '75000000-0000-4000-8000-000000000001',
      'Hrbq66XqtCo'
    )::text
  $$
);

create temporary table registered_free_demo_race_results (
  contender text primary key,
  result jsonb not null
) on commit preserve rows;

insert into registered_free_demo_race_results (contender, result)
select 'fifth', result::jsonb
from dblink_get_result('registered_free_demo_fifth') as raced(result text);
select result
from dblink_get_result('registered_free_demo_fifth') as cleared(result text);

select dblink_exec('registered_free_demo_sixth', 'set role service_role');
select dblink_send_query(
  'registered_free_demo_sixth',
  $$
    select public.admit_registered_free_hero_demo_chat_message(
      '75000000-0000-4000-8000-000000000001',
      'Hrbq66XqtCo'
    )::text
  $$
);

do $$
begin
  if dblink_is_busy('registered_free_demo_sixth') <> 1 then
    raise exception 'REGRESSION: sixth Registered Free request did not wait';
  end if;
end;
$$;

select dblink_exec('registered_free_demo_fifth', 'commit');

insert into registered_free_demo_race_results (contender, result)
select 'sixth', result::jsonb
from dblink_get_result('registered_free_demo_sixth') as raced(result text);
select result
from dblink_get_result('registered_free_demo_sixth') as cleared(result text);

do $$
begin
  if (
    select count(*) from registered_free_demo_race_results
    where result = '{"outcome":"admitted","remainingMessages":0}'::jsonb
  ) <> 1 or (
    select count(*) from registered_free_demo_race_results
    where result = '{"outcome":"exhausted","remainingMessages":0}'::jsonb
  ) <> 1 then
    raise exception 'REGRESSION: Registered Free fifth/sixth race was not atomic: %',
      (select jsonb_agg(result order by contender)
       from registered_free_demo_race_results);
  end if;
end;
$$;

select dblink_disconnect('registered_free_demo_fifth');
select dblink_disconnect('registered_free_demo_sixth');

do $$
declare
  other_demo jsonb;
  other_user jsonb;
  before_clear jsonb;
  after_clear jsonb;
begin
  other_demo := public.get_registered_free_hero_demo_chat_allowance(
    '75000000-0000-4000-8000-000000000001',
    'nm1TxQj9IsQ'
  );
  other_user := public.get_registered_free_hero_demo_chat_allowance(
    '75000000-0000-4000-8000-000000000002',
    'Hrbq66XqtCo'
  );
  if other_demo ->> 'remainingMessages' <> '5'
     or other_user ->> 'remainingMessages' <> '5' then
    raise exception 'REGRESSION: Registered Free allowance is not per user and demo';
  end if;

  before_clear := public.get_registered_free_hero_demo_chat_allowance(
    '75000000-0000-4000-8000-000000000001',
    'Hrbq66XqtCo'
  );
  if not exists (
    select 1
    from public.chat_messages
    where user_id = '75000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'REGRESSION: history-clear fixture did not seed a conversation';
  end if;
  delete from public.chat_messages
  where user_id = '75000000-0000-4000-8000-000000000001';
  after_clear := public.get_registered_free_hero_demo_chat_allowance(
    '75000000-0000-4000-8000-000000000001',
    'Hrbq66XqtCo'
  );
  if before_clear <> '{"outcome":"available","remainingMessages":0}'::jsonb
     or after_clear <> before_clear then
    raise exception 'REGRESSION: clearing visible history restored allowance';
  end if;
end;
$$;

do $$
begin
  if has_table_privilege(
       'anon', 'public.registered_free_hero_demo_ledgers', 'select'
     ) or has_table_privilege(
       'authenticated', 'public.registered_free_hero_demo_ledgers', 'select'
     ) then
    raise exception 'REGRESSION: Registered Free demo ledgers are directly readable';
  end if;

  if has_function_privilege(
       'anon',
       'public.admit_registered_free_hero_demo_chat_message(uuid,text)',
       'execute'
     ) or has_function_privilege(
       'authenticated',
       'public.admit_registered_free_hero_demo_chat_message(uuid,text)',
       'execute'
     ) then
    raise exception 'REGRESSION: public roles can admit Registered Free usage';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.admit_registered_free_hero_demo_chat_message(uuid,text)',
       'execute'
     ) then
    raise exception 'REGRESSION: service role cannot admit Registered Free usage';
  end if;
end;
$$;

reset search_path;
