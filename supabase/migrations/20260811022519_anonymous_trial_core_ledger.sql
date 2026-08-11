create table public.anonymous_trial_ledgers (
  user_id uuid primary key references auth.users(id) on delete restrict,
  messages_reserved integer not null default 0
    check (messages_reserved between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.anonymous_trial_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.anonymous_trial_ledgers(user_id)
    on delete restrict,
  status text not null default 'reserved'
    check (status in ('reserved', 'started', 'refunded', 'expired')),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  started_at timestamptz,
  refunded_at timestamptz,
  expired_at timestamptz,
  check (expires_at > reserved_at),
  check (
    (status = 'reserved'
      and started_at is null and refunded_at is null and expired_at is null)
    or (status = 'started'
      and started_at is not null and refunded_at is null and expired_at is null)
    or (status = 'refunded'
      and started_at is null and refunded_at is not null and expired_at is null)
    or (status = 'expired'
      and started_at is null and refunded_at is null and expired_at is not null)
  )
);

create index anonymous_trial_reservations_pending_idx
  on public.anonymous_trial_reservations (user_id, expires_at)
  where status = 'reserved';

alter table public.anonymous_trial_ledgers enable row level security;
alter table public.anonymous_trial_reservations enable row level security;

create policy anonymous_trial_ledgers_service_role
  on public.anonymous_trial_ledgers
  for all
  to service_role
  using (true)
  with check (true);

create policy anonymous_trial_reservations_service_role
  on public.anonymous_trial_reservations
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.anonymous_trial_ledgers from public, anon, authenticated;
revoke all on table public.anonymous_trial_reservations from public, anon, authenticated;
revoke all on table public.anonymous_trial_ledgers from service_role;
revoke all on table public.anonymous_trial_reservations from service_role;
grant select, insert, update on table public.anonymous_trial_ledgers to service_role;
grant select, insert, update on table public.anonymous_trial_reservations to service_role;

-- Every quota operation takes the ledger lock through this function before it
-- touches a reservation. Besides keeping lock order consistent, the function
-- durably releases abandoned pre-provider reservations after a bounded lease.
create function public.reconcile_anonymous_trial_chat_reservations(
  p_user_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_count integer;
  expired_count integer;
begin
  select messages_reserved
  into current_count
  from public.anonymous_trial_ledgers
  where user_id = p_user_id
  for update;

  if not found then
    return 0;
  end if;

  update public.anonymous_trial_reservations
  set status = 'expired', expired_at = clock_timestamp()
  where user_id = p_user_id
    and status = 'reserved'
    and expires_at <= clock_timestamp();
  get diagnostics expired_count = row_count;

  if expired_count > current_count then
    raise exception 'Anonymous Trial ledger invariant violated';
  end if;
  if expired_count > 0 then
    current_count := current_count - expired_count;
    update public.anonymous_trial_ledgers
    set messages_reserved = current_count,
        updated_at = clock_timestamp()
    where user_id = p_user_id;
  end if;

  return current_count;
end;
$$;

create function public.get_anonymous_trial_chat_allowance(
  p_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_count integer;
begin
  current_count := public.reconcile_anonymous_trial_chat_reservations(p_user_id);
  return jsonb_build_object(
    'outcome', 'available',
    'remainingMessages', greatest(0, 5 - current_count)
  );
end;
$$;

create function public.reserve_anonymous_trial_chat_message(
  p_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_count integer;
  reservation_id uuid;
  remaining integer;
begin
  insert into public.anonymous_trial_ledgers (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  current_count := public.reconcile_anonymous_trial_chat_reservations(p_user_id);
  if current_count >= 5 then
    return jsonb_build_object(
      'outcome', 'exhausted',
      'remainingMessages', 0
    );
  end if;

  current_count := current_count + 1;
  remaining := 5 - current_count;
  update public.anonymous_trial_ledgers
  set messages_reserved = current_count,
      updated_at = clock_timestamp()
  where user_id = p_user_id;

  insert into public.anonymous_trial_reservations (
    user_id,
    expires_at
  )
  values (p_user_id, clock_timestamp() + interval '5 minutes')
  returning id into reservation_id;

  return jsonb_build_object(
    'outcome', 'admitted',
    'reservationId', reservation_id,
    'remainingMessages', remaining
  );
end;
$$;

create function public.mark_anonymous_trial_chat_message_started(
  p_user_id uuid,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_count integer;
  reservation public.anonymous_trial_reservations%rowtype;
begin
  current_count := public.reconcile_anonymous_trial_chat_reservations(p_user_id);
  select *
  into reservation
  from public.anonymous_trial_reservations
  where id = p_reservation_id
    and user_id = p_user_id
  for update;

  if not found or reservation.status not in ('reserved', 'started') then
    return jsonb_build_object(
      'outcome', 'invalid',
      'remainingMessages', greatest(0, 5 - current_count)
    );
  end if;
  if reservation.status = 'started' then
    return jsonb_build_object(
      'outcome', 'already_started',
      'remainingMessages', greatest(0, 5 - current_count)
    );
  end if;

  update public.anonymous_trial_reservations
  set status = 'started', started_at = clock_timestamp()
  where id = p_reservation_id;

  return jsonb_build_object(
    'outcome', 'started',
    'remainingMessages', greatest(0, 5 - current_count)
  );
end;
$$;

create function public.refund_anonymous_trial_chat_message(
  p_user_id uuid,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_count integer;
  reservation public.anonymous_trial_reservations%rowtype;
begin
  current_count := public.reconcile_anonymous_trial_chat_reservations(p_user_id);
  select *
  into reservation
  from public.anonymous_trial_reservations
  where id = p_reservation_id
    and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object(
      'outcome', 'invalid',
      'remainingMessages', greatest(0, 5 - current_count)
    );
  end if;
  if reservation.status = 'started' then
    return jsonb_build_object(
      'outcome', 'started',
      'remainingMessages', greatest(0, 5 - current_count)
    );
  end if;
  if reservation.status in ('refunded', 'expired') then
    return jsonb_build_object(
      'outcome', case
        when reservation.status = 'expired' then 'expired'
        else 'already_refunded'
      end,
      'remainingMessages', greatest(0, 5 - current_count)
    );
  end if;

  current_count := current_count - 1;
  update public.anonymous_trial_reservations
  set status = 'refunded', refunded_at = clock_timestamp()
  where id = p_reservation_id;

  update public.anonymous_trial_ledgers
  set messages_reserved = current_count,
      updated_at = clock_timestamp()
  where user_id = p_user_id;

  return jsonb_build_object(
    'outcome', 'refunded',
    'remainingMessages', greatest(0, 5 - current_count)
  );
end;
$$;

revoke all on function public.reconcile_anonymous_trial_chat_reservations(uuid)
  from public, anon, authenticated;
revoke all on function public.reserve_anonymous_trial_chat_message(uuid)
  from public, anon, authenticated;
revoke all on function public.mark_anonymous_trial_chat_message_started(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.refund_anonymous_trial_chat_message(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_anonymous_trial_chat_allowance(uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_anonymous_trial_chat_reservations(uuid)
  to service_role;
grant execute on function public.reserve_anonymous_trial_chat_message(uuid)
  to service_role;
grant execute on function public.mark_anonymous_trial_chat_message_started(uuid, uuid)
  to service_role;
grant execute on function public.refund_anonymous_trial_chat_message(uuid, uuid)
  to service_role;
grant execute on function public.get_anonymous_trial_chat_allowance(uuid)
  to service_role;
