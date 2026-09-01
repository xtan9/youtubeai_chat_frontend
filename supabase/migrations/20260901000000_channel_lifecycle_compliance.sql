-- Channel lifecycle compliance (#479).
--
-- This migration is intentionally service-owned and inert at the product
-- surface. It gives the later Channel scan/review/publication adapters one
-- durable contract for downgrade grace, retention, disconnection, account
-- deletion, and retryable provider cleanup. No provider token or raw comment
-- text is stored here.

create schema if not exists channel_private;
revoke all on schema channel_private from public, anon, authenticated;
grant usage on schema channel_private to service_role;

-- The foundation already makes the Connected Channel id unique. PostgreSQL
-- still needs an explicit unique key before a composite foreign key can bind
-- that id to the exact grant used by the Channel lifecycle.
create unique index if not exists connected_youtube_channels_id_grant_unique
  on public.connected_youtube_channels (id, oauth_grant_id);

create table channel_private.channel_lifecycles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null,
  connected_channel_id uuid not null,
  grant_id uuid not null,
  state text not null default 'active'
    check (state in ('active', 'read_only_grace', 'cleanup_pending', 'deleted')),
  grace_started_at timestamptz,
  grace_ends_at timestamptz,
  grant_status text not null default 'active'
    check (grant_status in ('active', 'revoked')),
  provenance_status text not null default 'active'
    check (provenance_status in ('active', 'removed')),
  provenance_refreshed_at timestamptz,
  local_data_status text not null default 'retained'
    check (local_data_status in ('retained', 'deleted')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint channel_lifecycles_channel_owner_fk
    foreign key (channel_id, owner_id)
    references public.channels (id, owner_id)
    on delete cascade,
  constraint channel_lifecycles_connected_owner_fk
    foreign key (connected_channel_id, owner_id)
    references public.connected_youtube_channels (id, owner_id)
    on delete cascade,
  constraint channel_lifecycles_connected_channel_fk
    foreign key (connected_channel_id, owner_id, channel_id)
    references public.connected_youtube_channels (id, owner_id, channel_id)
    on delete cascade,
  constraint channel_lifecycles_grant_owner_fk
    foreign key (grant_id, owner_id)
    references public.channel_oauth_grants (id, owner_id)
    on delete cascade,
  constraint channel_lifecycles_grant_channel_fk
    foreign key (grant_id, owner_id, channel_id)
    references public.channel_oauth_grants (id, owner_id, channel_id)
    on delete cascade,
  constraint channel_lifecycles_connected_grant_fk
    foreign key (connected_channel_id, grant_id)
    references public.connected_youtube_channels (id, oauth_grant_id)
    on delete cascade,
  constraint channel_lifecycles_grace_state_ck check (
    (
      state = 'active'
      and grace_started_at is null
      and grace_ends_at is null
      and grant_status = 'active'
      and provenance_status = 'active'
      and local_data_status = 'retained'
    )
    or (
      state = 'read_only_grace'
      and grace_started_at is not null
      and grace_ends_at is not null
      and grace_ends_at > grace_started_at
      and grant_status = 'active'
      and provenance_status = 'active'
      and local_data_status = 'retained'
    )
    or state = 'cleanup_pending'
    or (
      state = 'deleted'
      and grant_status = 'revoked'
      and provenance_status = 'removed'
      and local_data_status = 'deleted'
    )
  )
);

create unique index channel_lifecycles_connected_unique
  on channel_private.channel_lifecycles (connected_channel_id);

create index channel_lifecycles_owner_state_idx
  on channel_private.channel_lifecycles (owner_id, state, grace_ends_at);

-- A retention record contains only the metadata needed by a worker to find
-- and purge data held in the actual review/draft tables. Aggregate rows are
-- deliberately the only rows without a 30-day expiry obligation.
create table channel_private.retention_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null,
  connected_channel_id text not null,
  data_kind text not null check (
    data_kind in (
      'review_text',
      'youtube_api_data',
      'draft_text',
      'review_decision',
      'audit_provenance',
      'reply_control',
      'aggregate'
    )
  ),
  source_table text not null,
  source_key text not null,
  retained_at timestamptz not null default clock_timestamp(),
  refreshed_at timestamptz,
  deleted_at timestamptz,
  deletion_status text not null default 'retained'
    check (deletion_status in ('retained', 'pending', 'deleted', 'escalated')),
  deletion_requested_at timestamptz,
  deletion_next_attempt_at timestamptz,
  deletion_deadline_at timestamptz,
  deletion_attempt_count integer not null default 0
    check (deletion_attempt_count >= 0),
  last_deletion_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint channel_retention_records_channel_owner_fk
    foreign key (channel_id, owner_id)
    references public.channels (id, owner_id)
    on delete cascade,
  constraint channel_retention_records_connected_id_ck
    check (length(btrim(connected_channel_id)) between 1 and 240),
  constraint channel_retention_records_source_ck
    check (
      length(btrim(source_table)) between 1 and 120
      and length(btrim(source_key)) between 1 and 240
    ),
  constraint channel_retention_records_refresh_ck
    check (
      data_kind = 'aggregate'
      or refreshed_at is null
      or refreshed_at >= retained_at
    ),
  constraint channel_retention_records_deleted_ck
    check (
      data_kind <> 'aggregate'
      or (deletion_status = 'retained' and deleted_at is null)
    ),
  constraint channel_retention_records_deletion_state_ck
    check ((deletion_status = 'deleted') = (deleted_at is not null)),
  constraint channel_retention_records_deletion_error_ck
    check (
      last_deletion_error is null
      or last_deletion_error ~ '^[a-z][a-z0-9_]{1,79}$'
    )
);

create index channel_retention_records_due_idx
  on channel_private.retention_records (
    data_kind,
    coalesce(deletion_next_attempt_at, refreshed_at, retained_at)
  )
  where deletion_status in ('retained', 'pending')
    and data_kind <> 'aggregate';

-- Only an opaque provider reply identity and bounded provenance are retained;
-- reply text is never copied into this control record.
create table channel_private.reply_controls (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null,
  connected_channel_id uuid not null,
  grant_id uuid not null,
  provider_reply_id text not null,
  comment_id text not null,
  comment_hash text not null,
  published_at timestamptz not null,
  last_refreshed_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'deleted')),
  deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint channel_reply_controls_channel_owner_fk
    foreign key (channel_id, owner_id)
    references public.channels (id, owner_id)
    on delete cascade,
  constraint channel_reply_controls_connected_owner_fk
    foreign key (connected_channel_id, owner_id)
    references public.connected_youtube_channels (id, owner_id)
    on delete cascade,
  constraint channel_reply_controls_connected_channel_fk
    foreign key (connected_channel_id, owner_id, channel_id)
    references public.connected_youtube_channels (id, owner_id, channel_id)
    on delete cascade,
  constraint channel_reply_controls_grant_owner_fk
    foreign key (grant_id, owner_id)
    references public.channel_oauth_grants (id, owner_id)
    on delete cascade,
  constraint channel_reply_controls_grant_channel_fk
    foreign key (grant_id, owner_id, channel_id)
    references public.channel_oauth_grants (id, owner_id, channel_id)
    on delete cascade,
  constraint channel_reply_controls_connected_grant_fk
    foreign key (connected_channel_id, grant_id)
    references public.connected_youtube_channels (id, oauth_grant_id)
    on delete cascade,
  constraint channel_reply_controls_identity_ck
    check (
      length(btrim(provider_reply_id)) between 1 and 240
      and length(btrim(comment_id)) between 1 and 240
      and length(btrim(comment_hash)) between 1 and 240
    ),
  constraint channel_reply_controls_refresh_ck
    check (last_refreshed_at >= published_at),
  constraint channel_reply_controls_deleted_ck
    check ((status = 'deleted') = (deleted_at is not null))
);

create unique index channel_reply_controls_provider_reply_unique
  on channel_private.reply_controls (provider_reply_id);

create index channel_reply_controls_active_idx
  on channel_private.reply_controls (owner_id, connected_channel_id, last_refreshed_at)
  where status = 'active';

-- Cleanup rows intentionally do not foreign-key Channel rows: the local
-- deletion step may remove the Channel before a failed provider revocation is
-- retried or escalated.
create table channel_private.cleanup_work (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  channel_id uuid not null,
  connected_channel_id uuid not null,
  grant_id uuid not null,
  reason text not null check (
    reason in ('disconnect', 'account_deletion', 'grace_expiry')
  ),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'retryable', 'completed', 'escalated', 'cancelled')),
  reply_deletion_decision text not null default 'not_required'
    check (reply_deletion_decision in ('not_required', 'pending', 'delete_requested', 'skip_requested', 'timed_out')),
  reply_deletion_status text not null default 'not_required'
    check (reply_deletion_status in ('not_required', 'pending', 'completed', 'skipped', 'failed', 'instructions_required')),
  grant_revocation_status text not null default 'pending'
    check (grant_revocation_status in ('pending', 'succeeded', 'already_absent', 'failed')),
  local_deletion_status text not null default 'pending'
    check (local_deletion_status in ('pending', 'succeeded', 'failed')),
  created_at timestamptz not null default clock_timestamp(),
  deadline_at timestamptz not null,
  next_attempt_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  worker_lease_expires_at timestamptz,
  last_error_code text,
  escalated_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint channel_cleanup_work_ids_ck check (
    owner_id is not null
    and channel_id is not null
    and connected_channel_id is not null
    and grant_id is not null
  ),
  constraint channel_cleanup_work_deadline_ck check (deadline_at >= created_at),
  constraint channel_cleanup_work_error_ck check (
    last_error_code is null or last_error_code ~ '^[a-z][a-z0-9_]{1,79}$'
  ),
  constraint channel_cleanup_work_terminal_ck check (
    (status <> 'completed' or completed_at is not null)
    and (status <> 'escalated' or escalated_at is not null)
    and (status <> 'cancelled' or cancelled_at is not null)
  )
);

create unique index channel_cleanup_work_active_unique
  on channel_private.cleanup_work (owner_id, connected_channel_id, reason)
  where status not in ('completed', 'cancelled');

create index channel_cleanup_work_due_idx
  on channel_private.cleanup_work (status, next_attempt_at, deadline_at);

create index channel_cleanup_work_monitoring_idx
  on channel_private.cleanup_work (status, deadline_at)
  where status in ('retryable', 'escalated');

create table channel_private.cleanup_attempts (
  id uuid primary key default gen_random_uuid(),
  cleanup_work_id uuid not null references channel_private.cleanup_work(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  outcome text not null check (outcome in ('retryable', 'completed', 'escalated', 'cancelled')),
  reply_deletion_status text not null,
  grant_revocation_status text not null,
  local_deletion_status text not null,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  constraint channel_cleanup_attempts_reply_status_ck check (
    reply_deletion_status in ('not_required', 'pending', 'completed', 'skipped', 'failed', 'instructions_required')
  ),
  constraint channel_cleanup_attempts_grant_status_ck check (
    grant_revocation_status in ('pending', 'succeeded', 'already_absent', 'failed')
  ),
  constraint channel_cleanup_attempts_local_status_ck check (
    local_deletion_status in ('pending', 'succeeded', 'failed')
  ),
  unique (cleanup_work_id, attempt_number)
);

create index channel_cleanup_attempts_work_idx
  on channel_private.cleanup_attempts (cleanup_work_id, attempt_number desc);

alter table channel_private.channel_lifecycles enable row level security;
alter table channel_private.retention_records enable row level security;
alter table channel_private.reply_controls enable row level security;
alter table channel_private.cleanup_work enable row level security;
alter table channel_private.cleanup_attempts enable row level security;

revoke all on table channel_private.channel_lifecycles from public, anon, authenticated, service_role;
revoke all on table channel_private.retention_records from public, anon, authenticated, service_role;
revoke all on table channel_private.reply_controls from public, anon, authenticated, service_role;
revoke all on table channel_private.cleanup_work from public, anon, authenticated, service_role;
revoke all on table channel_private.cleanup_attempts from public, anon, authenticated, service_role;

-- Only the trusted server worker receives table DML. Browser roles cannot
-- inspect private review text, reply provenance, or cleanup diagnostics.
grant select, insert, update, delete on all tables in schema channel_private
  to service_role;

create or replace function channel_private.ensure_channel_lifecycle_for_connected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into channel_private.channel_lifecycles (
    owner_id,
    channel_id,
    connected_channel_id,
    grant_id
  )
  values (
    new.owner_id,
    new.channel_id,
    new.id,
    new.oauth_grant_id
  )
  on conflict (connected_channel_id) do nothing;
  return new;
end;
$$;

drop trigger if exists channel_lifecycle_on_connected_insert
  on public.connected_youtube_channels;
create trigger channel_lifecycle_on_connected_insert
  after insert on public.connected_youtube_channels
  for each row
  execute function channel_private.ensure_channel_lifecycle_for_connected();

-- Backfill the lifecycle row for any #471 connection that predates this
-- migration. The identity and grant are read from their account-owned rows.
insert into channel_private.channel_lifecycles (
  owner_id,
  channel_id,
  connected_channel_id,
  grant_id
)
select connected.owner_id,
       connected.channel_id,
       connected.id,
       connected.oauth_grant_id
from public.connected_youtube_channels as connected
where connected.status = 'active'
on conflict (connected_channel_id) do nothing;

-- Existing work-item writers are service-owned, but the database still
-- rejects draft creation and publication claims after a downgrade or
-- disconnect. Completion of an already-started provider write is not blocked
-- here; the publication adapter remains responsible for its own atomic
-- preflight before the one external write.
create or replace function channel_private.enforce_channel_paid_work_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifecycle_row record;
begin
  if new.status not in ('draft_requested', 'draft_ready', 'publishing') then
    return new;
  end if;

  select lifecycle.*
    into lifecycle_row
  from channel_private.channel_lifecycles as lifecycle
  where lifecycle.owner_id = new.owner_id
    and lifecycle.channel_id = new.channel_id
    and lifecycle.connected_channel_id = new.connected_channel_id
  for key share;

  if lifecycle_row.id is null
     or lifecycle_row.state <> 'active'
     or lifecycle_row.grant_status <> 'active'
     or lifecycle_row.provenance_status <> 'active'
     or lifecycle_row.local_data_status <> 'retained'
     or not exists (
       select 1
       from public.user_subscriptions as subscription
       where subscription.user_id = new.owner_id
         and subscription.tier = 'pro'
     ) then
    raise exception 'Channel work requires an active lifecycle'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists channel_paid_work_lifecycle
  on public.channel_work_items;
create trigger channel_paid_work_lifecycle
  before insert or update of status on public.channel_work_items
  for each row
  execute function channel_private.enforce_channel_paid_work_lifecycle();

-- #478's deletion RPC is an existing product-reply entry point. Keep its
-- authorization bound to the same lifecycle row: active connections and the
-- seven-day grace period may delete, while grace-expiry cleanup and removed
-- provenance must hand the owner to YouTube instead.
create or replace function channel_private.enforce_channel_reply_deletion_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifecycle_row record;
begin
  if new.deletion_status <> 'in_progress' then
    return new;
  end if;

  select lifecycle.*
    into lifecycle_row
  from channel_private.channel_lifecycles as lifecycle
  where lifecycle.owner_id = new.owner_id
    and lifecycle.channel_id = new.channel_id
    and lifecycle.connected_channel_id = new.connected_channel_id
    and lifecycle.grant_id = new.oauth_grant_id
  for key share;

  if lifecycle_row.id is null
     or lifecycle_row.grant_status <> 'active'
     or lifecycle_row.provenance_status <> 'active'
     or lifecycle_row.local_data_status <> 'retained'
     or not (
       lifecycle_row.state in ('active', 'read_only_grace')
       or (
         lifecycle_row.state = 'cleanup_pending'
         and lifecycle_row.grace_started_at is null
         and lifecycle_row.grace_ends_at is null
       )
     ) then
    raise exception 'Public Reply deletion requires active Channel provenance'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists channel_reply_deletion_lifecycle
  on public.channel_work_items;
create trigger channel_reply_deletion_lifecycle
  before update of deletion_status on public.channel_work_items
  for each row
  execute function channel_private.enforce_channel_reply_deletion_lifecycle();

-- The current scan table is synthetic-only, so synthetic IDs intentionally
-- remain usable by the offline tracer. If a Connected Channel identity is
-- supplied, however, a new run must have an active paid lifecycle.
create or replace function channel_private.enforce_channel_scan_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifecycle_row record;
begin
  if not exists (
    select 1
    from public.connected_youtube_channels as connected
    where connected.id::text = btrim(new.connected_channel_id)
  ) then
    return new;
  end if;

  select lifecycle.*
    into lifecycle_row
  from channel_private.channel_lifecycles as lifecycle
  where lifecycle.owner_id = new.account_id
    and lifecycle.connected_channel_id::text = btrim(new.connected_channel_id)
  for key share;

  if lifecycle_row.id is null
     or lifecycle_row.state <> 'active'
     or lifecycle_row.grant_status <> 'active'
     or lifecycle_row.provenance_status <> 'active'
     or lifecycle_row.local_data_status <> 'retained'
     or not exists (
       select 1
       from public.user_subscriptions as subscription
       where subscription.user_id = new.account_id
         and subscription.tier = 'pro'
     ) then
    raise exception 'Channel scans require an active paid lifecycle'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists channel_scan_lifecycle on public.channel_scan_runs;
create trigger channel_scan_lifecycle
  before insert on public.channel_scan_runs
  for each row
  execute function channel_private.enforce_channel_scan_lifecycle();

-- Do not let an auth-row delete cascade away Channel data before the owner
-- has received the reply-deletion choice and the service has finished local
-- cleanup. The account-deletion preparation RPC creates the durable work;
-- this guard makes that preparation mandatory for accounts with a Channel.
create or replace function channel_private.require_channel_cleanup_before_account_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from channel_private.channel_lifecycles as lifecycle
    where lifecycle.owner_id = old.id
      and lifecycle.state <> 'deleted'
  ) then
    raise exception 'Channel cleanup must complete before account deletion'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists channel_cleanup_before_account_delete on auth.users;
create trigger channel_cleanup_before_account_delete
  before delete on auth.users
  for each row
  execute function channel_private.require_channel_cleanup_before_account_delete();

create or replace function channel_private.enqueue_cleanup(
  p_owner_id uuid,
  p_connected_channel_id uuid,
  p_reason text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifecycle_row record;
  existing_id uuid;
  cleanup_id uuid;
  cleanup_deadline timestamptz;
  first_attempt_at timestamptz;
  fresh_reply_count integer;
  stale_reply_count integer;
  reply_decision text := 'not_required';
  reply_status text := 'not_required';
begin
  if p_owner_id is null
     or p_connected_channel_id is null
     or p_reason not in ('disconnect', 'account_deletion', 'grace_expiry')
     or p_now is null then
    raise exception 'invalid Channel cleanup request'
      using errcode = '22023';
  end if;

  select lifecycle.*
    into lifecycle_row
  from channel_private.channel_lifecycles as lifecycle
  where lifecycle.owner_id = p_owner_id
    and lifecycle.connected_channel_id = p_connected_channel_id
  for update;

  if lifecycle_row.id is null then
    raise exception 'Channel lifecycle not found'
      using errcode = 'P0002';
  end if;

  if p_reason = 'grace_expiry'
     and lifecycle_row.state <> 'read_only_grace' then
    raise exception 'read-only grace lifecycle required'
      using errcode = '42501';
  end if;

  select cleanup.id
    into existing_id
  from channel_private.cleanup_work as cleanup
  where cleanup.owner_id = p_owner_id
    and cleanup.connected_channel_id = p_connected_channel_id
    and cleanup.reason = p_reason
    and cleanup.status not in ('completed', 'cancelled')
  order by cleanup.created_at
  limit 1
  for update;

  if existing_id is not null then
    return jsonb_build_object(
      'outcome', 'already_queued',
      'cleanupId', existing_id
    );
  end if;

  if p_reason = 'grace_expiry' then
    cleanup_deadline := lifecycle_row.grace_ends_at;
    first_attempt_at := greatest(p_now, cleanup_deadline);
  else
    cleanup_deadline := p_now + interval '7 days';
    first_attempt_at := p_now;
  end if;

  select count(*) filter (
           where reply.last_refreshed_at > p_now - interval '30 days'
         )::integer,
         count(*) filter (
           where reply.last_refreshed_at <= p_now - interval '30 days'
         )::integer
    into fresh_reply_count, stale_reply_count
  from channel_private.reply_controls as reply
  where reply.owner_id = p_owner_id
    and reply.channel_id = lifecycle_row.channel_id
    and reply.connected_channel_id = p_connected_channel_id
    and reply.grant_id = lifecycle_row.grant_id
    and reply.status = 'active';

  if lifecycle_row.grant_status = 'active'
     and lifecycle_row.provenance_status = 'active'
     and fresh_reply_count > 0
     and p_reason <> 'grace_expiry' then
    reply_decision := 'pending';
    reply_status := 'pending';
  elsif lifecycle_row.grant_status = 'active'
        and lifecycle_row.provenance_status = 'active'
        and stale_reply_count > 0 then
    reply_status := 'instructions_required';
  elsif lifecycle_row.grant_status <> 'active'
        or lifecycle_row.provenance_status <> 'active' then
    reply_status := 'instructions_required';
  end if;

  insert into channel_private.cleanup_work (
    owner_id,
    channel_id,
    connected_channel_id,
    grant_id,
    reason,
    status,
    reply_deletion_decision,
    reply_deletion_status,
    deadline_at,
    next_attempt_at
  )
  values (
    p_owner_id,
    lifecycle_row.channel_id,
    p_connected_channel_id,
    lifecycle_row.grant_id,
    p_reason,
    'pending',
    reply_decision,
    reply_status,
    cleanup_deadline,
    first_attempt_at
  )
  returning id into cleanup_id;

  update channel_private.channel_lifecycles
  set state = 'cleanup_pending',
      updated_at = p_now
  where id = lifecycle_row.id
    and p_reason <> 'grace_expiry';

  return jsonb_build_object(
    'outcome', 'queued',
    'cleanupId', cleanup_id,
    'replyDeletion', case
      when reply_decision = 'pending' then 'delete_before_revocation'
      when reply_status = 'instructions_required' then 'instructions_only'
      else 'not_required'
    end,
    'deadlineAt', cleanup_deadline,
    'googleRevocationPath', 'https://myaccount.google.com/permissions'
  );
end;
$$;

create or replace function channel_private.sync_subscription_channel_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifecycle_row record;
  transition_at timestamptz := clock_timestamp();
begin
  if tg_op = 'UPDATE'
     and old.tier = 'pro'
     and new.tier <> 'pro' then
    -- Downgrade is an immediate operating-mode change. Keep the data only in
    -- read-only grace and create the expiry job before this trigger returns.
    for lifecycle_row in
      select lifecycle.*
      from channel_private.channel_lifecycles as lifecycle
      where lifecycle.owner_id = new.user_id
        and lifecycle.state = 'active'
        and lifecycle.grant_status = 'active'
        and lifecycle.provenance_status = 'active'
        and lifecycle.local_data_status = 'retained'
      for update
    loop
      update channel_private.channel_lifecycles
      set state = 'read_only_grace',
          grace_started_at = transition_at,
          grace_ends_at = transition_at + interval '7 days',
          updated_at = transition_at
      where id = lifecycle_row.id;

      perform channel_private.enqueue_cleanup(
        new.user_id,
        lifecycle_row.connected_channel_id,
        'grace_expiry',
        transition_at
      );
    end loop;
  elsif tg_op = 'UPDATE'
        and old.tier <> 'pro'
        and new.tier = 'pro' then
    -- A verified resubscription during grace restores only active operation;
    -- a cleanup already running is never undone.
    update channel_private.channel_lifecycles
    set state = 'active',
        grace_started_at = null,
        grace_ends_at = null,
        updated_at = transition_at
    where owner_id = new.user_id
      and state = 'read_only_grace'
      and grace_ends_at > transition_at;

    update channel_private.cleanup_work
    set status = 'cancelled',
        cancelled_at = transition_at,
        updated_at = transition_at
    where owner_id = new.user_id
      and reason = 'grace_expiry'
      and status in ('pending', 'retryable')
      and deadline_at > transition_at;
  end if;
  return new;
end;
$$;

drop trigger if exists channel_lifecycle_on_subscription_transition
  on public.user_subscriptions;
create trigger channel_lifecycle_on_subscription_transition
  after update of tier on public.user_subscriptions
  for each row
  execute function channel_private.sync_subscription_channel_lifecycle();

create or replace function public.prepare_channel_cleanup(
  p_owner_id uuid,
  p_connected_channel_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return channel_private.enqueue_cleanup(
    p_owner_id,
    p_connected_channel_id,
    p_reason,
    clock_timestamp()
  );
end;
$$;

-- Account deletion must call this preparation seam before the auth row is
-- removed. The cleanup rows intentionally outlive the Channel foreign keys,
-- allowing provider revocation and the YouTube handoff to finish without
-- retaining local Channel data.
create or replace function public.prepare_channel_account_deletion(
  p_owner_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requested_at timestamptz := clock_timestamp();
  cleanups jsonb;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  if p_owner_id is null then
    raise exception 'Channel account-deletion owner is required'
      using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(
      channel_private.enqueue_cleanup(
        lifecycle.owner_id,
        lifecycle.connected_channel_id,
        'account_deletion',
        requested_at
      )
      order by lifecycle.connected_channel_id
    ),
    '[]'::jsonb
  )
    into cleanups
  from channel_private.channel_lifecycles as lifecycle
  where lifecycle.owner_id = p_owner_id
    and lifecycle.state <> 'deleted';

  return jsonb_build_object(
    'outcome', 'queued',
    'cleanups', cleanups,
    'googleRevocationPath', 'https://myaccount.google.com/permissions'
  );
end;
$$;

create or replace function public.claim_channel_cleanup_work(
  p_worker_id uuid,
  p_now timestamptz,
  p_limit integer default 10
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed jsonb;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  if p_worker_id is null or p_now is null then
    raise exception 'cleanup worker and clock are required'
      using errcode = '22023';
  end if;

  with candidates as (
    select cleanup.id
    from channel_private.cleanup_work as cleanup
    where (
        cleanup.status in ('pending', 'retryable')
        or (
          cleanup.status = 'running'
          and cleanup.worker_lease_expires_at <= p_now
        )
      )
      and cleanup.next_attempt_at <= p_now
      and (cleanup.worker_lease_expires_at is null or cleanup.worker_lease_expires_at <= p_now)
      and (
        cleanup.reply_deletion_decision <> 'pending'
        or p_now >= cleanup.deadline_at - interval '1 day'
      )
    order by cleanup.deadline_at, cleanup.created_at
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
    for update skip locked
  ), claimed_rows as (
    update channel_private.cleanup_work as cleanup
    set status = 'running',
        worker_lease_expires_at = p_now + interval '5 minutes',
        attempt_count = cleanup.attempt_count + 1,
        reply_deletion_decision = case
          when cleanup.reply_deletion_decision = 'pending'
            and p_now >= cleanup.deadline_at - interval '1 day'
            then 'timed_out'
          else cleanup.reply_deletion_decision
        end,
        reply_deletion_status = case
          when cleanup.reply_deletion_decision = 'pending'
            and p_now >= cleanup.deadline_at - interval '1 day'
            then 'skipped'
          else cleanup.reply_deletion_status
        end,
        updated_at = p_now
    from candidates
    where cleanup.id = candidates.id
    returning cleanup.id,
              cleanup.owner_id,
              cleanup.channel_id,
              cleanup.connected_channel_id,
              cleanup.grant_id,
              cleanup.reason,
              cleanup.attempt_count,
              cleanup.deadline_at,
              cleanup.reply_deletion_decision
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'cleanupId', claimed_rows.id,
        'ownerId', claimed_rows.owner_id,
        'channelId', claimed_rows.channel_id,
        'connectedChannelId', claimed_rows.connected_channel_id,
        'grantId', claimed_rows.grant_id,
        'reason', claimed_rows.reason,
        'attemptNumber', claimed_rows.attempt_count,
        'deadlineAt', claimed_rows.deadline_at,
        'replyDeletionDecision', claimed_rows.reply_deletion_decision
      )
      order by claimed_rows.deadline_at, claimed_rows.id
    ),
    '[]'::jsonb
  )
  into claimed
  from claimed_rows;

  return claimed;
end;
$$;

create or replace function public.choose_channel_cleanup_reply(
  p_cleanup_id uuid,
  p_choice text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cleanup record;
  next_decision text;
  next_status text;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  if p_cleanup_id is null
     or p_choice not in ('delete', 'skip')
     or p_now is null then
    raise exception 'invalid Channel reply deletion choice'
      using errcode = '22023';
  end if;

  select *
    into cleanup
  from channel_private.cleanup_work
  where id = p_cleanup_id
  for update;
  if cleanup.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if cleanup.status in ('completed', 'cancelled', 'escalated')
     or cleanup.local_deletion_status = 'succeeded' then
    return jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'cleanup_complete'
    );
  end if;
  if cleanup.reply_deletion_decision <> 'pending' then
    return jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'reply_deletion_not_pending'
    );
  end if;

  if p_now >= cleanup.deadline_at - interval '1 day' then
    update channel_private.cleanup_work
    set reply_deletion_decision = 'timed_out',
        reply_deletion_status = 'skipped',
        status = case when status = 'running' then 'pending' else status end,
        worker_lease_expires_at = null,
        next_attempt_at = p_now,
        updated_at = p_now
    where id = p_cleanup_id;
    return jsonb_build_object(
      'outcome', 'choice_expired',
      'cleanupId', p_cleanup_id,
      'googleRevocationPath', 'https://myaccount.google.com/permissions'
    );
  end if;

  next_decision := case when p_choice = 'delete'
    then 'delete_requested' else 'skip_requested' end;
  next_status := case when p_choice = 'delete'
    then 'pending' else 'skipped' end;
  update channel_private.cleanup_work
  set reply_deletion_decision = next_decision,
      reply_deletion_status = next_status,
      status = case when status = 'running' then 'pending' else status end,
      worker_lease_expires_at = null,
      next_attempt_at = p_now,
      updated_at = p_now
  where id = p_cleanup_id;
  return jsonb_build_object(
    'outcome', 'updated',
    'cleanupId', p_cleanup_id,
    'replyDeletionDecision', next_decision
  );
end;
$$;

create or replace function public.delete_channel_local_data(
  p_cleanup_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cleanup record;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  if p_cleanup_id is null or p_now is null then
    raise exception 'cleanup and clock are required'
      using errcode = '22023';
  end if;

  select *
    into cleanup
  from channel_private.cleanup_work
  where id = p_cleanup_id
  for update;
  if cleanup.id is null then
    raise exception 'cleanup work not found'
      using errcode = 'P0002';
  end if;

  -- These deletes are deliberately independent of provider revocation. A
  -- failed Google request must not leave local review text or provenance.
  delete from channel_private.reply_controls
  where owner_id = cleanup.owner_id
    and channel_id = cleanup.channel_id
    and connected_channel_id = cleanup.connected_channel_id;

  delete from channel_private.retention_records
  where owner_id = cleanup.owner_id
    and channel_id = cleanup.channel_id
    and connected_channel_id = cleanup.connected_channel_id::text;

  if to_regclass('channel_private.interaction_assessments') is not null then
    execute 'delete from channel_private.interaction_assessments
             where account_id = $1 and connected_channel_id = $2'
      using cleanup.owner_id, cleanup.connected_channel_id::text;
  end if;

  if to_regclass('public.channel_scan_assessments') is not null then
    execute 'delete from public.channel_scan_assessments
             where account_id = $1 and connected_channel_id = $2'
      using cleanup.owner_id, cleanup.connected_channel_id::text;
  end if;

  if to_regclass('public.channel_scan_run_threads') is not null
     and to_regclass('public.channel_scan_runs') is not null then
    execute 'delete from public.channel_scan_run_threads
             where run_id in (
               select id from public.channel_scan_runs
               where account_id = $1 and connected_channel_id = $2
             )'
      using cleanup.owner_id, cleanup.connected_channel_id::text;
  end if;
  if to_regclass('public.channel_scan_run_pages') is not null
     and to_regclass('public.channel_scan_runs') is not null then
    execute 'delete from public.channel_scan_run_pages
             where run_id in (
               select id from public.channel_scan_runs
               where account_id = $1 and connected_channel_id = $2
             )'
      using cleanup.owner_id, cleanup.connected_channel_id::text;
  end if;
  if to_regclass('public.channel_scan_runs') is not null then
    execute 'delete from public.channel_scan_runs
             where account_id = $1 and connected_channel_id = $2'
      using cleanup.owner_id, cleanup.connected_channel_id::text;
  end if;

  delete from public.channel_work_items
  where owner_id = cleanup.owner_id
    and channel_id = cleanup.channel_id
    and connected_channel_id = cleanup.connected_channel_id;

  delete from public.active_connected_channel_selections
  where owner_id = cleanup.owner_id
    and channel_id = cleanup.channel_id
    and connected_channel_id = cleanup.connected_channel_id;

  -- Cascades remove the grant, Connected Channel, and Channel lifecycle row.
  -- cleanup_work itself has no foreign key so a provider retry remains durable.
  delete from public.channels
  where id = cleanup.channel_id
    and owner_id = cleanup.owner_id;

  update channel_private.cleanup_work
  set local_deletion_status = 'succeeded',
      updated_at = p_now
  where id = p_cleanup_id;

  return jsonb_build_object(
    'outcome', 'local_deleted',
    'cleanupId', p_cleanup_id
  );
end;
$$;

create or replace function public.record_channel_cleanup_result(
  p_cleanup_id uuid,
  p_attempt_number integer,
  p_reply_deletion_status text,
  p_grant_revocation_status text,
  p_local_deletion_status text,
  p_error_code text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cleanup record;
  final_status text;
  completed boolean;
  result jsonb;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  if p_cleanup_id is null
     or p_attempt_number is null
     or p_attempt_number < 1
     or p_reply_deletion_status not in ('not_required', 'pending', 'completed', 'skipped', 'failed', 'instructions_required')
     or p_grant_revocation_status not in ('pending', 'succeeded', 'already_absent', 'failed')
     or p_local_deletion_status not in ('pending', 'succeeded', 'failed')
     or p_now is null then
    raise exception 'invalid Channel cleanup result'
      using errcode = '22023';
  end if;
  if p_local_deletion_status = 'pending'
     or p_grant_revocation_status = 'pending' then
    raise exception 'provider and local cleanup outcomes must be known'
      using errcode = '22023';
  end if;

  -- `grant_revocation_failed` is an explicit, monitored outcome. It is never
  -- converted into a completed cleanup merely because local deletion worked.
  -- Once grant/provenance are removed, the UI uses the `provenance_removed`
  -- state to show the YouTube handoff rather than retaining a stale promise.

  select *
    into cleanup
  from channel_private.cleanup_work
  where id = p_cleanup_id
    and status = 'running'
    and attempt_count = p_attempt_number
  for update;
  if cleanup.id is null then
    raise exception 'cleanup claim is stale or missing'
      using errcode = 'P0002';
  end if;

  completed := p_grant_revocation_status in ('succeeded', 'already_absent')
    and p_local_deletion_status = 'succeeded'
    and p_reply_deletion_status in ('not_required', 'completed', 'skipped', 'instructions_required');

  -- Persist the loss of provider authorization before deciding whether local
  -- cleanup is complete. If local deletion fails, all new Channel actions
  -- still fail closed and the owner receives the YouTube handoff.
  if p_grant_revocation_status in ('succeeded', 'already_absent') then
    update public.channel_oauth_grants
    set status = 'revoked',
        revoked_at = coalesce(revoked_at, p_now)
    where id = cleanup.grant_id
      and owner_id = cleanup.owner_id;

    update public.connected_youtube_channels
    set status = 'revoked',
        revoked_at = coalesce(revoked_at, p_now)
    where id = cleanup.connected_channel_id
      and owner_id = cleanup.owner_id;
  end if;

  update channel_private.channel_lifecycles as lifecycle
  set state = case
        when (
          lifecycle.grant_status = 'revoked'
          or p_grant_revocation_status in ('succeeded', 'already_absent')
        ) and (
          lifecycle.local_data_status = 'deleted'
          or p_local_deletion_status = 'succeeded'
        ) then 'deleted'
        else 'cleanup_pending'
      end,
      grant_status = case
        when p_grant_revocation_status in ('succeeded', 'already_absent')
          then 'revoked'
        else lifecycle.grant_status
      end,
      provenance_status = case
        when p_grant_revocation_status in ('succeeded', 'already_absent')
          or p_local_deletion_status = 'succeeded'
          then 'removed'
        else lifecycle.provenance_status
      end,
      provenance_refreshed_at = case
        when p_grant_revocation_status in ('succeeded', 'already_absent')
          or p_local_deletion_status = 'succeeded'
          then null
        else lifecycle.provenance_refreshed_at
      end,
      local_data_status = case
        when p_local_deletion_status = 'succeeded' then 'deleted'
        else lifecycle.local_data_status
      end,
      updated_at = p_now
  where lifecycle.owner_id = cleanup.owner_id
    and lifecycle.channel_id = cleanup.channel_id
    and lifecycle.connected_channel_id = cleanup.connected_channel_id
    and lifecycle.grant_id = cleanup.grant_id;

  if completed then
    final_status := 'completed';
  elsif p_now >= cleanup.deadline_at - interval '1 day' then
    final_status := 'escalated';
  else
    final_status := 'retryable';
  end if;

  insert into channel_private.cleanup_attempts (
    cleanup_work_id,
    attempt_number,
    started_at,
    completed_at,
    outcome,
    reply_deletion_status,
    grant_revocation_status,
    local_deletion_status,
    error_code
  )
  values (
    p_cleanup_id,
    p_attempt_number,
    coalesce(cleanup.updated_at, p_now),
    p_now,
    final_status,
    p_reply_deletion_status,
    p_grant_revocation_status,
    p_local_deletion_status,
    nullif(btrim(p_error_code), '')
  );

  update channel_private.cleanup_work
  set status = final_status,
      reply_deletion_status = p_reply_deletion_status,
      grant_revocation_status = p_grant_revocation_status,
      local_deletion_status = p_local_deletion_status,
      last_error_code = nullif(btrim(p_error_code), ''),
      worker_lease_expires_at = null,
      next_attempt_at = case
        when final_status = 'retryable' then least(
          p_now + interval '1 hour',
          cleanup.deadline_at
        )
        else p_now
      end,
      escalated_at = case
        when final_status = 'escalated' then p_now
        else cleanup.escalated_at
      end,
      completed_at = case
        when final_status = 'completed' then p_now
        else cleanup.completed_at
      end,
      updated_at = p_now
  where id = p_cleanup_id;

  result := jsonb_build_object(
    'outcome', final_status,
    'cleanupId', p_cleanup_id,
    'localDeletionStatus', p_local_deletion_status,
    'grantRevocationStatus', p_grant_revocation_status,
    'replyDeletionStatus', p_reply_deletion_status
  );
  if p_grant_revocation_status <> 'succeeded'
     or p_grant_revocation_status = 'already_absent'
     or p_reply_deletion_status in ('skipped', 'failed', 'instructions_required') then
    result := result || jsonb_build_object(
      'googleRevocationPath', 'https://myaccount.google.com/permissions'
    );
  end if;
  return result;
end;
$$;

create or replace function public.refresh_channel_retention_record(
  p_retention_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  retained record;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  select * into retained
  from channel_private.retention_records
  where id = p_retention_id
  for update;
  if retained.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if retained.data_kind = 'aggregate' then
    return jsonb_build_object('outcome', 'aggregate_retained');
  end if;
  if retained.deleted_at is not null
     or retained.deletion_status = 'deleted' then
    return jsonb_build_object('outcome', 'already_deleted');
  end if;
  if retained.deletion_status <> 'retained' then
    return jsonb_build_object('outcome', 'delete_required');
  end if;
  if p_now is null
     or p_now > coalesce(retained.refreshed_at, retained.retained_at) + interval '30 days' then
    return jsonb_build_object('outcome', 'delete_required');
  end if;
  if not exists (
    select 1
    from channel_private.channel_lifecycles as lifecycle
    where lifecycle.owner_id = retained.owner_id
      and lifecycle.channel_id = retained.channel_id
      and lifecycle.grant_status = 'active'
      and lifecycle.provenance_status = 'active'
  ) then
    return jsonb_build_object('outcome', 'delete_required');
  end if;

  update channel_private.retention_records
  set refreshed_at = p_now,
      updated_at = p_now
  where id = p_retention_id;
  return jsonb_build_object(
    'outcome', 'refreshed',
    'retentionId', p_retention_id,
    'nextDueAt', p_now + interval '30 days'
  );
end;
$$;

create or replace function public.expire_channel_retention_records(
  p_now timestamptz,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expired jsonb;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  if p_now is null then
    raise exception 'retention clock is required'
      using errcode = '22023';
  end if;

  with candidates as (
    select retention.id
    from channel_private.retention_records as retention
    where retention.deletion_status in ('retained', 'pending')
      and retention.deleted_at is null
      and retention.data_kind <> 'aggregate'
      and (
        (
          retention.deletion_status = 'retained'
          and p_now >= coalesce(retention.refreshed_at, retention.retained_at) + interval '30 days'
        )
        or (
          retention.deletion_status = 'pending'
          and p_now >= coalesce(retention.deletion_next_attempt_at, p_now)
        )
      )
    order by coalesce(
      retention.deletion_next_attempt_at,
      retention.refreshed_at,
      retention.retained_at
    ), retention.id
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update skip locked
  ), claimed_rows as (
    update channel_private.retention_records as retention
     set deletion_status = 'pending',
         deletion_requested_at = coalesce(retention.deletion_requested_at, p_now),
         deletion_next_attempt_at = p_now + interval '5 minutes',
         deletion_deadline_at = coalesce(
           retention.deletion_deadline_at,
           coalesce(retention.refreshed_at, retention.retained_at)
             + interval '30 days'
         ),
        deletion_attempt_count = retention.deletion_attempt_count + 1,
        last_deletion_error = null,
        updated_at = p_now
    from candidates
    where retention.id = candidates.id
    returning retention.id,
              retention.data_kind,
              retention.source_table,
              retention.source_key,
              retention.deletion_attempt_count,
              retention.deletion_deadline_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'retentionId', claimed_rows.id,
        'dataKind', claimed_rows.data_kind,
        'sourceTable', claimed_rows.source_table,
        'sourceKey', claimed_rows.source_key,
        'attemptNumber', claimed_rows.deletion_attempt_count,
        'deadlineAt', claimed_rows.deletion_deadline_at
      )
      order by claimed_rows.deletion_deadline_at, claimed_rows.id
    ),
    '[]'::jsonb
  )
    into expired
  from claimed_rows;

  return jsonb_build_object(
    'outcome', 'deletion_pending',
    'retentionWork', expired
  );
end;
$$;

-- A source-specific worker deletes the row identified by sourceTable/sourceKey
-- (using its own allowlist) and then records the verified result here. The
-- registry is not marked deleted when a worker merely discovers an expiry.
create or replace function public.record_channel_retention_deletion(
  p_retention_id uuid,
  p_outcome text,
  p_error_code text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  retained record;
  final_status text;
  next_attempt timestamptz;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  if p_retention_id is null
     or p_outcome not in ('deleted', 'already_deleted', 'retryable', 'failed')
     or p_now is null then
    raise exception 'invalid Channel retention deletion result'
      using errcode = '22023';
  end if;

  select *
    into retained
  from channel_private.retention_records
  where id = p_retention_id
  for update;
  if retained.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if retained.data_kind = 'aggregate' then
    raise exception 'aggregate retention rows cannot be deleted'
      using errcode = '22023';
  end if;
  if retained.deletion_status = 'deleted' or retained.deleted_at is not null then
    return jsonb_build_object('outcome', 'already_deleted');
  end if;
  if retained.deletion_status <> 'pending' then
    return jsonb_build_object('outcome', 'deletion_not_claimed');
  end if;

  if p_outcome in ('deleted', 'already_deleted') then
    update channel_private.retention_records
    set deletion_status = 'deleted',
        deleted_at = p_now,
        deletion_next_attempt_at = null,
        last_deletion_error = null,
        updated_at = p_now
    where id = p_retention_id;
    return jsonb_build_object(
      'outcome', 'deleted',
      'retentionId', p_retention_id
    );
  end if;

  final_status := case
    when retained.deletion_deadline_at is not null
      and p_now >= retained.deletion_deadline_at - interval '1 hour'
      then 'escalated'
    else 'pending'
  end;
  next_attempt := case
    when final_status = 'pending' then p_now + interval '1 hour'
    else p_now
  end;

  update channel_private.retention_records
  set deletion_status = final_status,
      deletion_next_attempt_at = next_attempt,
      last_deletion_error = nullif(btrim(p_error_code), ''),
      updated_at = p_now
  where id = p_retention_id;
  return jsonb_build_object(
    'outcome', final_status,
    'retentionId', p_retention_id
  );
end;
$$;

create or replace function public.expire_channel_reply_controls(
  p_now timestamptz,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expired jsonb;
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  if p_now is null then
    raise exception 'reply-control retention clock is required'
      using errcode = '22023';
  end if;

  with candidates as (
    select reply.id
    from channel_private.reply_controls as reply
    where reply.status = 'active'
      and p_now >= reply.last_refreshed_at + interval '30 days'
    order by reply.last_refreshed_at, reply.id
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update skip locked
  ), deleted_rows as (
    delete from channel_private.reply_controls as reply
    using candidates
    where reply.id = candidates.id
    returning reply.id
  )
  select coalesce(jsonb_agg(deleted_rows.id), '[]'::jsonb)
    into expired
  from deleted_rows;

  return jsonb_build_object(
    'outcome', 'expired',
    'replyControlIds', expired
  );
end;
$$;

revoke all on function public.prepare_channel_cleanup(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.prepare_channel_cleanup(uuid, uuid, text)
  to service_role;

revoke all on function public.prepare_channel_account_deletion(uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_channel_account_deletion(uuid)
  to service_role;

revoke all on function public.claim_channel_cleanup_work(uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.claim_channel_cleanup_work(uuid, timestamptz, integer)
  to service_role;

revoke all on function public.choose_channel_cleanup_reply(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.choose_channel_cleanup_reply(uuid, text, timestamptz)
  to service_role;

revoke all on function public.delete_channel_local_data(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.delete_channel_local_data(uuid, timestamptz)
  to service_role;

revoke all on function public.record_channel_cleanup_result(
  uuid, integer, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_channel_cleanup_result(
  uuid, integer, text, text, text, text, timestamptz
) to service_role;

revoke all on function public.refresh_channel_retention_record(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.refresh_channel_retention_record(uuid, timestamptz)
  to service_role;

revoke all on function public.expire_channel_retention_records(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.expire_channel_retention_records(timestamptz, integer)
  to service_role;

revoke all on function public.record_channel_retention_deletion(
  uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_channel_retention_deletion(
  uuid, text, text, timestamptz
) to service_role;

revoke all on function public.expire_channel_reply_controls(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.expire_channel_reply_controls(timestamptz, integer)
  to service_role;

revoke all on function channel_private.ensure_channel_lifecycle_for_connected()
  from public, anon, authenticated;
revoke all on function channel_private.enforce_channel_paid_work_lifecycle()
  from public, anon, authenticated;
revoke all on function channel_private.enforce_channel_reply_deletion_lifecycle()
  from public, anon, authenticated;
revoke all on function channel_private.enforce_channel_scan_lifecycle()
  from public, anon, authenticated;
revoke all on function channel_private.require_channel_cleanup_before_account_delete()
  from public, anon, authenticated;
revoke all on function channel_private.enqueue_cleanup(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function channel_private.enqueue_cleanup(uuid, uuid, text, timestamptz)
  to service_role;
revoke all on function channel_private.sync_subscription_channel_lifecycle()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
