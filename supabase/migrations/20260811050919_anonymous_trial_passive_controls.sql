alter table public.anonymous_trial_reservations
  add column network_key_hash text,
  add column spend_micros_reserved bigint,
  add column completed_at timestamptz;

alter table public.anonymous_trial_reservations
  add constraint anonymous_trial_reservations_network_key_hash_check
    check (network_key_hash is null or network_key_hash ~ '^[0-9a-f]{64}$'),
  add constraint anonymous_trial_reservations_spend_micros_check
    check (spend_micros_reserved is null or spend_micros_reserved > 0),
  add constraint anonymous_trial_reservations_completion_check
    check (
      completed_at is null
      or (status = 'started' and started_at is not null and completed_at >= started_at)
    );

create index anonymous_trial_reservations_network_window_idx
  on public.anonymous_trial_reservations (
    network_key_hash,
    reserved_at desc
  )
  where status in ('reserved', 'started');

create index anonymous_trial_reservations_global_spend_window_idx
  on public.anonymous_trial_reservations (reserved_at desc)
  include (spend_micros_reserved)
  where status in ('reserved', 'started');

create table public.anonymous_trial_network_prefixes (
  network_key_hash text primary key
    check (network_key_hash ~ '^[0-9a-f]{64}$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.anonymous_trial_global_admission_lock (
  singleton boolean primary key default true check (singleton),
  updated_at timestamptz not null default now()
);

insert into public.anonymous_trial_global_admission_lock (singleton)
values (true);

alter table public.anonymous_trial_network_prefixes enable row level security;
alter table public.anonymous_trial_global_admission_lock enable row level security;

create policy anonymous_trial_network_prefixes_service_role
  on public.anonymous_trial_network_prefixes
  for all
  to service_role
  using (true)
  with check (true);

create policy anonymous_trial_global_admission_lock_service_role
  on public.anonymous_trial_global_admission_lock
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.anonymous_trial_network_prefixes
  from public, anon, authenticated, service_role;
revoke all on table public.anonymous_trial_global_admission_lock
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.anonymous_trial_network_prefixes
  to service_role;
grant select, update on table public.anonymous_trial_global_admission_lock
  to service_role;

drop function public.reserve_anonymous_trial_chat_message(uuid);

create function public.reserve_anonymous_trial_chat_message(
  p_user_id uuid,
  p_network_key_hash text,
  p_global_spend_limit_micros bigint,
  p_reservation_cost_micros bigint,
  p_admission_enabled boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_count integer;
  network_count integer;
  global_spend bigint;
  reservation_id uuid;
  admission_time timestamptz := clock_timestamp();
begin
  if p_admission_enabled is not true then
    return jsonb_build_object(
      'outcome', 'global_shutdown',
      'remainingMessages', 0
    );
  end if;
  if p_network_key_hash is null
     or p_network_key_hash !~ '^[0-9a-f]{64}$'
     or p_global_spend_limit_micros is null
     or p_global_spend_limit_micros <= 0
     or p_reservation_cost_micros is null
     or p_reservation_cost_micros <= 0
     or p_reservation_cost_micros > p_global_spend_limit_micros then
    raise exception 'Anonymous Trial admission configuration is invalid';
  end if;

  -- Global, network, then identity is the one lock order for every admission.
  -- The singleton intentionally serializes this low-volume public cost boundary.
  perform 1
  from public.anonymous_trial_global_admission_lock
  where singleton = true
  for update;
  if not found then
    raise exception 'Anonymous Trial global admission lock is unavailable';
  end if;

  -- Reconcile every abandoned pre-provider lease while the global admission
  -- lock is held. Lock ledgers first, in stable order, to preserve the
  -- ledger-then-reservation order used by per-identity quota operations.
  perform 1
  from public.anonymous_trial_ledgers as ledger
  where exists (
    select 1
    from public.anonymous_trial_reservations as reservation
    where reservation.user_id = ledger.user_id
      and reservation.status = 'reserved'
      and reservation.expires_at <= admission_time
  )
  order by ledger.user_id
  for update;

  if exists (
    select 1
    from public.anonymous_trial_ledgers as ledger
    join (
      select user_id, count(*)::integer as expired_count
      from public.anonymous_trial_reservations
      where status = 'reserved'
        and expires_at <= admission_time
      group by user_id
    ) as expired_counts using (user_id)
    where ledger.messages_reserved < expired_counts.expired_count
  ) then
    raise exception 'Anonymous Trial ledger invariant violated';
  end if;

  with expired_reservations as (
    update public.anonymous_trial_reservations
    set status = 'expired', expired_at = admission_time
    where status = 'reserved'
      and expires_at <= admission_time
    returning user_id
  ), expired_counts as (
    select user_id, count(*)::integer as expired_count
    from expired_reservations
    group by user_id
  )
  update public.anonymous_trial_ledgers as ledger
  set messages_reserved = ledger.messages_reserved - expired_counts.expired_count,
      updated_at = admission_time
  from expired_counts
  where ledger.user_id = expired_counts.user_id;

  insert into public.anonymous_trial_network_prefixes (network_key_hash)
  values (p_network_key_hash)
  on conflict (network_key_hash) do nothing;
  perform 1
  from public.anonymous_trial_network_prefixes
  where network_key_hash = p_network_key_hash
  for update;
  if not found then
    raise exception 'Anonymous Trial network admission lock is unavailable';
  end if;

  insert into public.anonymous_trial_ledgers (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
  current_count := public.reconcile_anonymous_trial_chat_reservations(p_user_id);

  if exists (
    select 1
    from public.anonymous_trial_reservations
    where user_id = p_user_id
      and (
        status = 'reserved'
        or (status = 'started' and completed_at is null)
      )
      and expires_at > admission_time
  ) then
    return jsonb_build_object(
      'outcome', 'concurrent',
      'remainingMessages', greatest(0, 5 - current_count)
    );
  end if;

  if current_count >= 5 then
    return jsonb_build_object(
      'outcome', 'exhausted',
      'remainingMessages', 0
    );
  end if;

  select count(*)::integer
  into network_count
  from public.anonymous_trial_reservations
  where network_key_hash = p_network_key_hash
    and status in ('reserved', 'started')
    and reserved_at > admission_time - interval '24 hours';
  if network_count >= 20 then
    return jsonb_build_object(
      'outcome', 'network_limited',
      'remainingMessages', greatest(0, 5 - current_count)
    );
  end if;

  select coalesce(sum(spend_micros_reserved), 0)
  into global_spend
  from public.anonymous_trial_reservations
  where status in ('reserved', 'started')
    and reserved_at > admission_time - interval '24 hours';
  if global_spend + p_reservation_cost_micros > p_global_spend_limit_micros then
    return jsonb_build_object(
      'outcome', 'global_shutdown',
      'remainingMessages', greatest(0, 5 - current_count)
    );
  end if;

  current_count := current_count + 1;
  update public.anonymous_trial_ledgers
  set messages_reserved = current_count,
      updated_at = admission_time
  where user_id = p_user_id;

  update public.anonymous_trial_network_prefixes
  set last_seen_at = admission_time
  where network_key_hash = p_network_key_hash;

  update public.anonymous_trial_global_admission_lock
  set updated_at = admission_time
  where singleton = true;

  insert into public.anonymous_trial_reservations (
    user_id,
    expires_at,
    network_key_hash,
    spend_micros_reserved
  )
  values (
    p_user_id,
    admission_time + interval '5 minutes',
    p_network_key_hash,
    p_reservation_cost_micros
  )
  returning id into reservation_id;

  return jsonb_build_object(
    'outcome', 'admitted',
    'reservationId', reservation_id,
    'remainingMessages', 5 - current_count
  );
end;
$$;

revoke all on function public.reserve_anonymous_trial_chat_message(
  uuid,
  text,
  bigint,
  bigint,
  boolean
) from public, anon, authenticated;
grant execute on function public.reserve_anonymous_trial_chat_message(
  uuid,
  text,
  bigint,
  bigint,
  boolean
) to service_role;

create function public.complete_anonymous_trial_chat_message(
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

  if not found or reservation.status <> 'started' then
    return jsonb_build_object(
      'outcome', 'invalid',
      'remainingMessages', greatest(0, 5 - current_count)
    );
  end if;
  if reservation.completed_at is not null then
    return jsonb_build_object(
      'outcome', 'already_completed',
      'remainingMessages', greatest(0, 5 - current_count)
    );
  end if;

  update public.anonymous_trial_reservations
  set completed_at = clock_timestamp()
  where id = p_reservation_id;

  return jsonb_build_object(
    'outcome', 'completed',
    'remainingMessages', greatest(0, 5 - current_count)
  );
end;
$$;

revoke all on function public.complete_anonymous_trial_chat_message(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_anonymous_trial_chat_message(uuid, uuid)
  to service_role;
