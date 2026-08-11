-- Core Anonymous Trial contract: one non-deletable five-message ledger per
-- anonymous identity, atomic fifth/sixth admission, and idempotent pre-start
-- refund. This fixture uses independent dblink sessions so transaction locks,
-- not a single-session approximation, prove the concurrency boundary.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

delete from public.anonymous_trial_reservations
where user_id in (
  '74000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000003'
);
delete from public.anonymous_trial_ledgers
where user_id in (
  '74000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000003'
);

insert into auth.users (id, is_anonymous)
values
  ('74000000-0000-4000-8000-000000000001', true),
  ('74000000-0000-4000-8000-000000000002', true),
  ('74000000-0000-4000-8000-000000000003', true)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

do $$
begin
  if public.get_anonymous_trial_chat_allowance(
    '74000000-0000-4000-8000-000000000001'
  ) <> '{"outcome":"available","remainingMessages":5}'::jsonb then
    raise exception 'REGRESSION: initial Anonymous Trial allowance is not five';
  end if;
end;
$$;

-- Every outcome reports the current locked ledger value, not a reservation-time
-- snapshot. Interleave two reservations, refund the first, then start the
-- second: the start must observe the restored live allowance.
do $$
declare
  reservation_a jsonb;
  reservation_b jsonb;
  refunded_a jsonb;
  started_b jsonb;
begin
  reservation_a := public.reserve_anonymous_trial_chat_message(
    '74000000-0000-4000-8000-000000000003'
  );
  reservation_b := public.reserve_anonymous_trial_chat_message(
    '74000000-0000-4000-8000-000000000003'
  );
  refunded_a := public.refund_anonymous_trial_chat_message(
    '74000000-0000-4000-8000-000000000003',
    (reservation_a ->> 'reservationId')::uuid
  );
  started_b := public.mark_anonymous_trial_chat_message_started(
    '74000000-0000-4000-8000-000000000003',
    (reservation_b ->> 'reservationId')::uuid
  );

  if reservation_a ->> 'remainingMessages' <> '4'
     or reservation_b ->> 'remainingMessages' <> '3'
     or refunded_a ->> 'remainingMessages' <> '4'
     or started_b <> '{"outcome":"started","remainingMessages":4}'::jsonb then
    raise exception
      'REGRESSION: interleaved outcomes returned stale allowance (a %, b %, refund %, start %)',
      reservation_a, reservation_b, refunded_a, started_b;
  end if;
end;
$$;

-- A reservation abandoned by a failed start/refund boundary is reclaimable.
-- Entitlement reads perform reconciliation, so the failure cannot permanently
-- consume Anonymous Trial allowance even without a successful route retry.
do $$
declare
  abandoned jsonb;
  allowance jsonb;
begin
  abandoned := public.reserve_anonymous_trial_chat_message(
    '74000000-0000-4000-8000-000000000003'
  );
  update public.anonymous_trial_reservations
  set reserved_at = clock_timestamp() - interval '2 minutes',
      expires_at = clock_timestamp() - interval '1 second'
  where id = (abandoned ->> 'reservationId')::uuid;

  allowance := public.get_anonymous_trial_chat_allowance(
    '74000000-0000-4000-8000-000000000003'
  );
  if allowance <> '{"outcome":"available","remainingMessages":4}'::jsonb
     or (select status
         from public.anonymous_trial_reservations
         where id = (abandoned ->> 'reservationId')::uuid) <> 'expired'
     or (select messages_reserved
         from public.anonymous_trial_ledgers
         where user_id = '74000000-0000-4000-8000-000000000003') <> 1 then
    raise exception
      'REGRESSION: abandoned reservation was not durably reconciled: %, %',
      abandoned, allowance;
  end if;
end;
$$;

do $$
declare
  result jsonb;
begin
  for attempt in 1..4 loop
    result := public.reserve_anonymous_trial_chat_message(
      '74000000-0000-4000-8000-000000000001'
    );
    if result ->> 'outcome' <> 'admitted'
       or (result ->> 'remainingMessages')::integer <> 5 - attempt then
      raise exception 'REGRESSION: sequential reservation % returned %', attempt, result;
    end if;

    result := public.mark_anonymous_trial_chat_message_started(
      '74000000-0000-4000-8000-000000000001',
      (result ->> 'reservationId')::uuid
    );
    if result ->> 'outcome' <> 'started' then
      raise exception 'REGRESSION: sequential reservation did not start: %', result;
    end if;
  end loop;
end;
$$;

select dblink_connect('anonymous_trial_fifth', format('dbname=%L', current_database()));
select dblink_connect('anonymous_trial_sixth', format('dbname=%L', current_database()));
select dblink_exec('anonymous_trial_fifth', 'begin');
select dblink_exec('anonymous_trial_fifth', 'set local role service_role');

select dblink_send_query(
  'anonymous_trial_fifth',
  $$
    select public.reserve_anonymous_trial_chat_message(
      '74000000-0000-4000-8000-000000000001'
    )::text
  $$
);

create temporary table anonymous_trial_race_results (
  contender text primary key,
  result jsonb not null
) on commit preserve rows;

insert into anonymous_trial_race_results (contender, result)
select 'fifth', result::jsonb
from dblink_get_result('anonymous_trial_fifth') as raced(result text);
select result
from dblink_get_result('anonymous_trial_fifth') as cleared(result text);

select dblink_exec('anonymous_trial_sixth', 'set role service_role');
select dblink_send_query(
  'anonymous_trial_sixth',
  $$
    select public.reserve_anonymous_trial_chat_message(
      '74000000-0000-4000-8000-000000000001'
    )::text
  $$
);

do $$
begin
  if dblink_is_busy('anonymous_trial_sixth') <> 1 then
    raise exception 'REGRESSION: sixth reservation did not wait for the ledger lock';
  end if;
end;
$$;

select dblink_exec('anonymous_trial_fifth', 'commit');

insert into anonymous_trial_race_results (contender, result)
select 'sixth', result::jsonb
from dblink_get_result('anonymous_trial_sixth') as raced(result text);
select result
from dblink_get_result('anonymous_trial_sixth') as cleared(result text);

do $$
begin
  if (
    select count(*)
    from anonymous_trial_race_results
    where result ->> 'outcome' = 'admitted'
  ) <> 1 or (
    select count(*)
    from anonymous_trial_race_results
    where result ->> 'outcome' = 'exhausted'
      and (result ->> 'remainingMessages')::integer = 0
  ) <> 1 then
    raise exception 'REGRESSION: fifth/sixth race did not admit exactly one: %',
      (select jsonb_agg(result order by contender) from anonymous_trial_race_results);
  end if;

  if (
    select messages_reserved
    from public.anonymous_trial_ledgers
    where user_id = '74000000-0000-4000-8000-000000000001'
  ) <> 5 then
    raise exception 'REGRESSION: race persisted a ledger count other than five';
  end if;
  if public.get_anonymous_trial_chat_allowance(
    '74000000-0000-4000-8000-000000000001'
  ) <> '{"outcome":"available","remainingMessages":0}'::jsonb then
    raise exception 'REGRESSION: exhausted Anonymous Trial allowance is not zero';
  end if;
end;
$$;

select dblink_disconnect('anonymous_trial_fifth');
select dblink_disconnect('anonymous_trial_sixth');

do $$
declare
  reserved jsonb;
  first_refund jsonb;
  second_refund jsonb;
  started jsonb;
  rejected_refund jsonb;
begin
  reserved := public.reserve_anonymous_trial_chat_message(
    '74000000-0000-4000-8000-000000000002'
  );
  first_refund := public.refund_anonymous_trial_chat_message(
    '74000000-0000-4000-8000-000000000002',
    (reserved ->> 'reservationId')::uuid
  );
  second_refund := public.refund_anonymous_trial_chat_message(
    '74000000-0000-4000-8000-000000000002',
    (reserved ->> 'reservationId')::uuid
  );
  if first_refund <> '{"outcome":"refunded","remainingMessages":5}'::jsonb
     or second_refund <> '{"outcome":"already_refunded","remainingMessages":5}'::jsonb then
    raise exception 'REGRESSION: refund was not idempotent: %, %', first_refund, second_refund;
  end if;

  reserved := public.reserve_anonymous_trial_chat_message(
    '74000000-0000-4000-8000-000000000002'
  );
  started := public.mark_anonymous_trial_chat_message_started(
    '74000000-0000-4000-8000-000000000002',
    (reserved ->> 'reservationId')::uuid
  );
  rejected_refund := public.refund_anonymous_trial_chat_message(
    '74000000-0000-4000-8000-000000000002',
    (reserved ->> 'reservationId')::uuid
  );
  if started ->> 'outcome' <> 'started'
     or rejected_refund ->> 'outcome' <> 'started' then
    raise exception 'REGRESSION: started usage was refundable: %, %', started, rejected_refund;
  end if;
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.anonymous_trial_ledgers', 'select')
     or has_table_privilege('authenticated', 'public.anonymous_trial_ledgers', 'select')
     or has_table_privilege('anon', 'public.anonymous_trial_reservations', 'select')
     or has_table_privilege('authenticated', 'public.anonymous_trial_reservations', 'select') then
    raise exception 'REGRESSION: Anonymous Trial ledgers are directly readable';
  end if;

  if has_function_privilege(
       'anon',
       'public.reserve_anonymous_trial_chat_message(uuid)',
       'execute'
     ) or has_function_privilege(
       'authenticated',
       'public.reserve_anonymous_trial_chat_message(uuid)',
       'execute'
     ) then
    raise exception 'REGRESSION: public roles can reserve Anonymous Trial usage';
  end if;

  if has_function_privilege(
       'anon',
       'public.get_anonymous_trial_chat_allowance(uuid)',
       'execute'
     ) or has_function_privilege(
       'authenticated',
       'public.get_anonymous_trial_chat_allowance(uuid)',
       'execute'
     ) then
    raise exception 'REGRESSION: public roles can read Anonymous Trial usage';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.reserve_anonymous_trial_chat_message(uuid)',
    'execute'
  ) then
    raise exception 'REGRESSION: service role cannot reserve Anonymous Trial usage';
  end if;
end;
$$;

reset search_path;
