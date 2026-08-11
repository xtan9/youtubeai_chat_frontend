\set ON_ERROR_STOP on

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

delete from public.anonymous_trial_reservations
where user_id between
  '78000000-0000-4000-8000-000000000001'::uuid and
  '78000000-0000-4000-8000-000000000030'::uuid;
delete from public.anonymous_trial_ledgers
where user_id between
  '78000000-0000-4000-8000-000000000001'::uuid and
  '78000000-0000-4000-8000-000000000030'::uuid;
delete from auth.users
where id between
  '78000000-0000-4000-8000-000000000001'::uuid and
  '78000000-0000-4000-8000-000000000030'::uuid;

insert into auth.users (id, is_anonymous)
select
  format('78000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  true
from generate_series(1, 30) as n;

set role service_role;

-- Refunds reverse both the identity allowance and passive-window exposure,
-- but a started generation remains charged even after its lease expires.
do $$
declare
  reserved jsonb;
  refunded jsonb;
  repeated_refund jsonb;
  started jsonb;
  after_expiry jsonb;
begin
  reserved := public.reserve_anonymous_trial_chat_message(
    '78000000-0000-4000-8000-000000000001', repeat('a', 64),
    1000000000, 1000, true
  );
  if reserved->>'outcome' <> 'admitted'
     or (select count(*) from public.anonymous_trial_reservations
         where network_key_hash = repeat('a', 64)
           and status in ('reserved', 'started')) <> 1 then
    raise exception 'REGRESSION: passive admission was not persisted atomically: %', reserved;
  end if;

  refunded := public.refund_anonymous_trial_chat_message(
    '78000000-0000-4000-8000-000000000001',
    (reserved->>'reservationId')::uuid
  );
  repeated_refund := public.refund_anonymous_trial_chat_message(
    '78000000-0000-4000-8000-000000000001',
    (reserved->>'reservationId')::uuid
  );
  if refunded <> '{"outcome":"refunded","remainingMessages":5}'::jsonb
     or repeated_refund <> '{"outcome":"already_refunded","remainingMessages":5}'::jsonb
     or (select count(*) from public.anonymous_trial_reservations
         where network_key_hash = repeat('a', 64)
           and status in ('reserved', 'started')) <> 0 then
    raise exception 'REGRESSION: pre-start refund did not reverse exposure once: %, %',
      refunded, repeated_refund;
  end if;

  reserved := public.reserve_anonymous_trial_chat_message(
    '78000000-0000-4000-8000-000000000002', repeat('b', 64),
    1000000000, 1000, true
  );
  started := public.mark_anonymous_trial_chat_message_started(
    '78000000-0000-4000-8000-000000000002',
    (reserved->>'reservationId')::uuid
  );
  update public.anonymous_trial_reservations
  set reserved_at = clock_timestamp() - interval '6 minutes',
      expires_at = clock_timestamp() - interval '1 second'
  where id = (reserved->>'reservationId')::uuid;
  if started->>'outcome' <> 'started'
     or (public.refund_anonymous_trial_chat_message(
       '78000000-0000-4000-8000-000000000002',
       (reserved->>'reservationId')::uuid
     ))->>'outcome' <> 'started'
     or (public.get_anonymous_trial_chat_allowance(
       '78000000-0000-4000-8000-000000000002'
     ))->>'remainingMessages' <> '4' then
    raise exception 'REGRESSION: started usage was refunded or reconciled away';
  end if;

  reserved := public.reserve_anonymous_trial_chat_message(
    '78000000-0000-4000-8000-000000000003', repeat('c', 64),
    1000000000, 1000, true
  );
  update public.anonymous_trial_reservations
  set reserved_at = clock_timestamp() - interval '6 minutes',
      expires_at = clock_timestamp() - interval '1 second'
  where id = (reserved->>'reservationId')::uuid;
  after_expiry := public.reserve_anonymous_trial_chat_message(
    '78000000-0000-4000-8000-000000000003', repeat('c', 64),
    1000000000, 1000, true
  );
  if after_expiry->>'outcome' <> 'admitted'
     or after_expiry->>'remainingMessages' <> '4'
     or (select status from public.anonymous_trial_reservations
         where id = (reserved->>'reservationId')::uuid) <> 'expired' then
    raise exception 'REGRESSION: abandoned lease did not expire safely: %', after_expiry;
  end if;
end;
$$;

-- Seed nineteen admitted uses on one /24-/64-derived hash. Two independent
-- sessions then race for the twentieth slot; global serialization must admit
-- one and return a bounded network denial to the other.
do $$
declare
  result jsonb;
  ordinal integer;
begin
  for ordinal in 4..22 loop
    result := public.reserve_anonymous_trial_chat_message(
      format('78000000-0000-4000-8000-%s', lpad(ordinal::text, 12, '0'))::uuid,
      repeat('9', 64), 1000000000, 1000, true
    );
    if result->>'outcome' <> 'admitted' then
      raise exception 'REGRESSION: network seed % was not admitted: %', ordinal, result;
    end if;
    perform public.mark_anonymous_trial_chat_message_started(
      format('78000000-0000-4000-8000-%s', lpad(ordinal::text, 12, '0'))::uuid,
      (result->>'reservationId')::uuid
    );
  end loop;
end;
$$;

reset role;
select dblink_connect('passive_network_twentieth', format('dbname=%L', current_database()));
select dblink_connect('passive_network_twenty_first', format('dbname=%L', current_database()));
select dblink_exec('passive_network_twentieth', 'begin');
select dblink_exec('passive_network_twentieth', 'set local role service_role');
select dblink_send_query(
  'passive_network_twentieth',
  $$select public.reserve_anonymous_trial_chat_message(
      '78000000-0000-4000-8000-000000000023', repeat('9', 64),
      1000000000, 1000, true
    )::text$$
);

create temporary table passive_network_race_results (
  contender text primary key,
  result jsonb not null
) on commit preserve rows;

insert into passive_network_race_results
select 'twentieth', result::jsonb
from dblink_get_result('passive_network_twentieth') as raced(result text);
select result from dblink_get_result('passive_network_twentieth') as cleared(result text);

select dblink_exec('passive_network_twenty_first', 'set role service_role');
select dblink_send_query(
  'passive_network_twenty_first',
  $$select public.reserve_anonymous_trial_chat_message(
      '78000000-0000-4000-8000-000000000024', repeat('9', 64),
      1000000000, 1000, true
    )::text$$
);

do $$
begin
  if dblink_is_busy('passive_network_twenty_first') <> 1 then
    raise exception 'REGRESSION: network contenders did not serialize on admission';
  end if;
end;
$$;

select dblink_exec('passive_network_twentieth', 'commit');
insert into passive_network_race_results
select 'twenty_first', result::jsonb
from dblink_get_result('passive_network_twenty_first') as raced(result text);
select result from dblink_get_result('passive_network_twenty_first') as cleared(result text);

do $$
begin
  if (select count(*) from passive_network_race_results
      where result->>'outcome' = 'admitted') <> 1
     or (select count(*) from passive_network_race_results
         where result->>'outcome' = 'network_limited') <> 1
     or (select count(*) from public.anonymous_trial_reservations
         where network_key_hash = repeat('9', 64)
           and status in ('reserved', 'started')
           and reserved_at > clock_timestamp() - interval '24 hours') <> 20 then
    raise exception 'REGRESSION: twentieth/twenty-first race exceeded the window: %',
      (select jsonb_agg(result order by contender) from passive_network_race_results);
  end if;
end;
$$;

select dblink_disconnect('passive_network_twentieth');
select dblink_disconnect('passive_network_twenty_first');

-- Independent sessions for one identity must share the same active lease.
select dblink_connect('passive_identity_first', format('dbname=%L', current_database()));
select dblink_connect('passive_identity_second', format('dbname=%L', current_database()));
select dblink_exec('passive_identity_first', 'begin');
select dblink_exec('passive_identity_first', 'set local role service_role');
select dblink_send_query(
  'passive_identity_first',
  $$select public.reserve_anonymous_trial_chat_message(
      '78000000-0000-4000-8000-000000000025', repeat('e', 64),
      1000000000, 1000, true
    )::text$$
);
create temporary table passive_identity_race_results (
  contender text primary key,
  result jsonb not null
) on commit preserve rows;
insert into passive_identity_race_results
select 'first', result::jsonb
from dblink_get_result('passive_identity_first') as raced(result text);
select result from dblink_get_result('passive_identity_first') as cleared(result text);
select dblink_exec('passive_identity_second', 'set role service_role');
select dblink_send_query(
  'passive_identity_second',
  $$select public.reserve_anonymous_trial_chat_message(
      '78000000-0000-4000-8000-000000000025', repeat('f', 64),
      1000000000, 1000, true
    )::text$$
);
do $$
begin
  if dblink_is_busy('passive_identity_second') <> 1 then
    raise exception 'REGRESSION: same-identity contenders did not serialize';
  end if;
end;
$$;
select dblink_exec('passive_identity_first', 'commit');
insert into passive_identity_race_results
select 'second', result::jsonb
from dblink_get_result('passive_identity_second') as raced(result text);
select result from dblink_get_result('passive_identity_second') as cleared(result text);
do $$
begin
  if (select result->>'outcome' from passive_identity_race_results
      where contender = 'first') <> 'admitted'
     or (select result->>'outcome' from passive_identity_race_results
         where contender = 'second') <> 'concurrent' then
    raise exception 'REGRESSION: cross-session lease admitted competing work: %',
      (select jsonb_agg(result order by contender) from passive_identity_race_results);
  end if;
end;
$$;
select dblink_disconnect('passive_identity_first');
select dblink_disconnect('passive_identity_second');

set role service_role;
do $$
declare
  current_spend bigint;
  result jsonb;
begin
  select coalesce(sum(spend_micros_reserved), 0)
  into current_spend
  from public.anonymous_trial_reservations
  where status in ('reserved', 'started')
    and reserved_at > clock_timestamp() - interval '24 hours';
  result := public.reserve_anonymous_trial_chat_message(
    '78000000-0000-4000-8000-000000000026', repeat('1', 64),
    current_spend + 999, 1000, true
  );
  if result->>'outcome' <> 'global_shutdown'
     or exists (select 1 from public.anonymous_trial_reservations
                where user_id = '78000000-0000-4000-8000-000000000026')
     or coalesce((select messages_reserved from public.anonymous_trial_ledgers
                  where user_id = '78000000-0000-4000-8000-000000000026'), 0) <> 0 then
    raise exception 'REGRESSION: global ceiling did not fail closed atomically: %', result;
  end if;

  result := public.reserve_anonymous_trial_chat_message(
    '78000000-0000-4000-8000-000000000027', repeat('2', 64),
    1000000000, 1000, false
  );
  if result <> '{"outcome":"global_shutdown","remainingMessages":0}'::jsonb
     or exists (select 1 from public.anonymous_trial_ledgers
                where user_id = '78000000-0000-4000-8000-000000000027') then
    raise exception 'REGRESSION: kill switch touched quota state: %', result;
  end if;
end;
$$;

reset role;
-- A missing global coordination row must raise instead of reopening admission.
do $$
declare
  dependency_failed boolean := false;
begin
  delete from public.anonymous_trial_global_admission_lock where singleton;
  begin
    perform public.reserve_anonymous_trial_chat_message(
      '78000000-0000-4000-8000-000000000028', repeat('3', 64),
      1000000000, 1000, true
    );
  exception when others then
    dependency_failed := true;
  end;
  insert into public.anonymous_trial_global_admission_lock (singleton)
  values (true);
  if not dependency_failed then
    raise exception 'REGRESSION: missing global lock failed open';
  end if;
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.anonymous_trial_network_prefixes', 'select')
     or has_table_privilege('authenticated', 'public.anonymous_trial_network_prefixes', 'select')
     or has_table_privilege('anon', 'public.anonymous_trial_global_admission_lock', 'select')
     or has_table_privilege('authenticated', 'public.anonymous_trial_global_admission_lock', 'select')
     or has_function_privilege(
       'anon',
       'public.reserve_anonymous_trial_chat_message(uuid,text,bigint,bigint,boolean)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.reserve_anonymous_trial_chat_message(uuid,text,bigint,bigint,boolean)',
       'execute'
     ) then
    raise exception 'REGRESSION: passive admission state is exposed to public roles';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'anonymous_trial_reservations',
        'anonymous_trial_network_prefixes'
      )
      and column_name ~ '(raw_?ip|ip_?address|fingerprint)'
  ) or exists (
    select 1 from public.anonymous_trial_reservations
    where network_key_hash is not null
      and network_key_hash !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'REGRESSION: raw network identity or fingerprint data is persisted';
  end if;
end;
$$;

delete from public.anonymous_trial_reservations
where user_id between
  '78000000-0000-4000-8000-000000000001'::uuid and
  '78000000-0000-4000-8000-000000000030'::uuid;
delete from public.anonymous_trial_ledgers
where user_id between
  '78000000-0000-4000-8000-000000000001'::uuid and
  '78000000-0000-4000-8000-000000000030'::uuid;
delete from public.anonymous_trial_network_prefixes
where network_key_hash in (
  repeat('a', 64), repeat('b', 64), repeat('c', 64), repeat('9', 64),
  repeat('e', 64), repeat('f', 64), repeat('1', 64), repeat('2', 64),
  repeat('3', 64)
);
delete from auth.users
where id between
  '78000000-0000-4000-8000-000000000001'::uuid and
  '78000000-0000-4000-8000-000000000030'::uuid;

reset search_path;
