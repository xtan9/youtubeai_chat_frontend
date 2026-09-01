-- First real Public Reply foundation (#491).
--
-- This migration owns only the durable claim, quota, provenance, and lifecycle
-- seam. It does not contain a provider client, credential, token, callback, or
-- network operation. A separately governed adapter must supply the one
-- comments.insert attempt after this claim succeeds.

alter table public.channel_work_items
  add column if not exists publication_provider text not null default 'synthetic';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'channel_work_items_publication_provider_ck'
      and conrelid = 'public.channel_work_items'::regclass
  ) then
    alter table public.channel_work_items
      add constraint channel_work_items_publication_provider_ck
      check (publication_provider in ('synthetic', 'youtube'));
  end if;
end;
$$;

-- One account-wide UTC-day ledger keeps the ten-publication limit uniform for
-- every eligible Pro account. The quota units are recorded for truthful cost
-- reporting; deletion never touches this table.
create table if not exists channel_private.channel_public_reply_daily_usage (
  owner_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  publication_count integer not null default 0,
  quota_units integer not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, usage_date),
  constraint public_reply_daily_usage_count_ck
    check (publication_count between 0 and 10),
  constraint public_reply_daily_usage_quota_ck
    check (quota_units >= 0)
);

-- Attempts retain only opaque identifiers and state. Reply/draft/comment text,
-- OAuth material, and provider credentials do not belong in this ledger.
create table if not exists channel_private.public_reply_publication_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  work_item_id uuid not null,
  channel_id uuid not null,
  connected_channel_id uuid not null,
  grant_id uuid not null,
  attempt_number integer not null,
  publication_provider text not null default 'youtube'
    check (publication_provider = 'youtube'),
  quota_cost integer not null default 50
    check (quota_cost = 50),
  status text not null default 'started'
    check (status in ('started', 'accepted', 'rejected', 'uncertain')),
  provider_reply_id text,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  failure_code text,
  constraint public_reply_attempt_work_owner_fk
    foreign key (work_item_id, owner_id)
    references public.channel_work_items(id, owner_id)
    on delete cascade,
  constraint public_reply_attempt_channel_owner_fk
    foreign key (channel_id, owner_id)
    references public.channels(id, owner_id)
    on delete cascade,
  constraint public_reply_attempt_connected_owner_fk
    foreign key (connected_channel_id, owner_id)
    references public.connected_youtube_channels(id, owner_id)
    on delete cascade,
  constraint public_reply_attempt_connected_channel_fk
    foreign key (connected_channel_id, owner_id, channel_id)
    references public.connected_youtube_channels(id, owner_id, channel_id)
    on delete cascade,
  constraint public_reply_attempt_grant_owner_fk
    foreign key (grant_id, owner_id)
    references public.channel_oauth_grants(id, owner_id)
    on delete cascade,
  constraint public_reply_attempt_grant_channel_fk
    foreign key (grant_id, owner_id, channel_id)
    references public.channel_oauth_grants(id, owner_id, channel_id)
    on delete cascade,
  constraint public_reply_attempt_identity_ck
    check (
      attempt_number > 0
      and (provider_reply_id is null or length(btrim(provider_reply_id)) between 1 and 240)
      and (failure_code is null or failure_code ~ '^[a-z][a-z0-9_]{1,79}$')
    ),
  constraint public_reply_attempt_completion_ck
    check (
      (status = 'started' and completed_at is null)
      or (status <> 'started' and completed_at is not null)
    )
);

create unique index if not exists public_reply_attempt_work_number_unique
  on channel_private.public_reply_publication_attempts (work_item_id, attempt_number);

create unique index if not exists public_reply_attempt_in_flight_unique
  on channel_private.public_reply_publication_attempts (work_item_id)
  where status = 'started';

create index if not exists public_reply_attempt_owner_started_idx
  on channel_private.public_reply_publication_attempts (owner_id, started_at desc);

alter table channel_private.channel_public_reply_daily_usage enable row level security;
alter table channel_private.public_reply_publication_attempts enable row level security;
revoke all on table channel_private.channel_public_reply_daily_usage
  from public, anon, authenticated, service_role;
revoke all on table channel_private.public_reply_publication_attempts
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table channel_private.channel_public_reply_daily_usage
  to service_role;
grant select, insert, update, delete on table channel_private.public_reply_publication_attempts
  to service_role;

-- The old claim accepted a caller-provided remaining allowance and had no
-- confirmation field. Remove that bypassable signature before installing the
-- claim that locks the account ledger and requires explicit confirmation.
drop function if exists public.channel_work_item_claim_publication(
  uuid, uuid, text, text, boolean, integer
);

create or replace function public.channel_work_item_claim_publication(
  p_owner_id uuid,
  p_work_item_id uuid,
  p_current_comment_id text default null,
  p_current_comment_hash text default null,
  p_final_text_validated boolean default false,
  p_explicit_confirmation boolean default false,
  -- Retained as a compatibility-shaped argument but deliberately ignored;
  -- the locked account ledger is the only source of remaining allowance.
  p_remaining_daily_publications integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  work_item record;
  usage_row record;
  attempt_number integer;
  attempt_id uuid;
  usage_day date := (clock_timestamp() at time zone 'UTC')::date;
begin
  if p_explicit_confirmation is not true then
    return jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'explicit_confirmation_required'
    );
  end if;

  insert into channel_private.channel_public_reply_daily_usage (owner_id, usage_date)
  values (p_owner_id, usage_day)
  on conflict (owner_id, usage_date) do nothing;

  select *
    into usage_row
  from channel_private.channel_public_reply_daily_usage
  where owner_id = p_owner_id
    and usage_date = usage_day
  for update;

  if usage_row.publication_count >= 10 then
    return jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'daily_publication_limit'
    );
  end if;

  select work.*
    into work_item
  from public.channel_work_items as work
  where work.id = p_work_item_id
    and work.owner_id = p_owner_id
    and work.publication_provider = 'youtube'
    and (
      work.status = 'draft_ready'
      or (
        work.status = 'failed'
        and work.retry_authorized_by = 'provider_rejection'
      )
    )
    and work.status <> 'publication_uncertain'
    and nullif(btrim(work.final_text), '') is not null
    and p_final_text_validated is true
    and btrim(coalesce(p_current_comment_id, '')) = btrim(work.comment_id)
    and btrim(coalesce(p_current_comment_hash, '')) = btrim(work.comment_hash)
    and exists (
      select 1
      from public.active_connected_channel_selections as active
      join public.connected_youtube_channels as connected
        on connected.id = active.connected_channel_id
       and connected.owner_id = active.owner_id
       and connected.channel_id = active.channel_id
       and connected.oauth_grant_id = work.oauth_grant_id
      join public.channel_oauth_grants as grant_record
        on grant_record.id = connected.oauth_grant_id
       and grant_record.owner_id = connected.owner_id
       and grant_record.channel_id = connected.channel_id
      where active.owner_id = work.owner_id
        and active.channel_id = work.channel_id
        and active.connected_channel_id = work.connected_channel_id
        and connected.status = 'active'
        and connected.supported_creator is true
        and grant_record.status = 'active'
        and grant_record.write_scope_granted is true
    )
    and exists (
      select 1
      from channel_private.channel_lifecycles as lifecycle
      where lifecycle.owner_id = work.owner_id
        and lifecycle.channel_id = work.channel_id
        and lifecycle.connected_channel_id = work.connected_channel_id
        and lifecycle.grant_id = work.oauth_grant_id
        and lifecycle.state = 'active'
        and lifecycle.grant_status = 'active'
        and lifecycle.provenance_status = 'active'
        and lifecycle.local_data_status = 'retained'
    )
    and exists (
      select 1
      from public.user_subscriptions as subscription
      where subscription.user_id = work.owner_id
        and subscription.tier = 'pro'
    )
  for update;

  if work_item.id is null then
    return jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'publication_claim_lost'
    );
  end if;

  update public.channel_work_items
     set status = 'publishing',
         lifecycle_revision = lifecycle_revision + 1,
         updated_at = clock_timestamp()
   where id = work_item.id
     and owner_id = p_owner_id;

  update channel_private.channel_public_reply_daily_usage
     set publication_count = publication_count + 1,
         quota_units = quota_units + 50,
         updated_at = clock_timestamp()
   where owner_id = p_owner_id
     and usage_date = usage_day;

  select coalesce(max(attempt_number), 0) + 1
    into attempt_number
  from channel_private.public_reply_publication_attempts
  where work_item_id = work_item.id;

  insert into channel_private.public_reply_publication_attempts (
    owner_id,
    work_item_id,
    channel_id,
    connected_channel_id,
    grant_id,
    attempt_number
  )
  values (
    work_item.owner_id,
    work_item.id,
    work_item.channel_id,
    work_item.connected_channel_id,
    work_item.oauth_grant_id,
    attempt_number
  )
  returning id into attempt_id;

  return jsonb_build_object(
    'outcome', 'attempt_started',
    'workItemId', work_item.id,
    'attemptId', attempt_id,
    'quotaCost', 50,
    'dailyPublicationLimit', 10,
    'dailyPublicationsRemaining', 9 - usage_row.publication_count
  );
end;
$$;

revoke all on function public.channel_work_item_claim_publication(
  uuid, uuid, text, text, boolean, boolean, integer
) from public, anon, authenticated;
grant execute on function public.channel_work_item_claim_publication(
  uuid, uuid, text, text, boolean, boolean, integer
) to service_role;

-- Completion is reconciled into the attempt ledger and the lifecycle reply
-- control without copying provider text. A mismatched opaque identity fails
-- the local completion rather than attaching provenance to another reply.
create or replace function channel_private.sync_real_public_reply_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_reply record;
begin
  if new.publication_provider <> 'youtube' then
    return new;
  end if;

  if new.status = 'published'
     and nullif(btrim(new.provider_reply_id), '') is not null
     and new.published_at is not null then
    select *
      into existing_reply
    from channel_private.reply_controls
    where provider_reply_id = new.provider_reply_id
    for update;

    if existing_reply.id is not null and (
      existing_reply.owner_id <> new.owner_id
      or existing_reply.channel_id <> new.channel_id
      or existing_reply.connected_channel_id <> new.connected_channel_id
      or existing_reply.grant_id <> new.oauth_grant_id
      or existing_reply.comment_id <> new.comment_id
    ) then
      raise exception 'provider reply identity is bound to another Channel'
        using errcode = '23514';
    end if;

    insert into channel_private.reply_controls (
      owner_id,
      channel_id,
      connected_channel_id,
      grant_id,
      provider_reply_id,
      comment_id,
      comment_hash,
      published_at,
      last_refreshed_at
    )
    values (
      new.owner_id,
      new.channel_id,
      new.connected_channel_id,
      new.oauth_grant_id,
      new.provider_reply_id,
      new.comment_id,
      new.comment_hash,
      new.published_at,
      greatest(new.published_at, coalesce(new.last_observed_at, new.published_at))
    )
    on conflict (provider_reply_id) do update
      set last_refreshed_at = greatest(
            channel_private.reply_controls.last_refreshed_at,
            excluded.last_refreshed_at
          ),
          status = 'active',
          deleted_at = null,
          updated_at = clock_timestamp();
  elsif new.status = 'deleted' or new.deletion_status = 'completed' then
    update channel_private.reply_controls
       set status = 'deleted',
           deleted_at = coalesce(deleted_at, clock_timestamp()),
           updated_at = clock_timestamp()
     where owner_id = new.owner_id
       and channel_id = new.channel_id
       and connected_channel_id = new.connected_channel_id
       and grant_id = new.oauth_grant_id
       and provider_reply_id = new.provider_reply_id;
  end if;

  update channel_private.public_reply_publication_attempts
     set status = case
           when new.status = 'published' then 'accepted'
           when new.status = 'failed'
             and new.retry_authorized_by = 'provider_rejection' then 'rejected'
           when new.status = 'publication_uncertain' then 'uncertain'
           else status
         end,
         provider_reply_id = case
           when new.status = 'published' then new.provider_reply_id
           else provider_reply_id
         end,
         completed_at = case
           when new.status in ('published', 'failed', 'publication_uncertain')
             then coalesce(completed_at, clock_timestamp())
           else completed_at
         end,
         failure_code = case
           when new.status = 'published' then null
           when new.status = 'failed'
             and new.retry_authorized_by = 'provider_rejection'
             then 'provider_rejection'
           when new.status = 'publication_uncertain'
             then 'publication_uncertain'
           else failure_code
         end
   where work_item_id = new.id
     and owner_id = new.owner_id
     and status in ('started', 'uncertain');

  return new;
end;
$$;

drop trigger if exists channel_real_reply_control_sync
  on public.channel_work_items;
create trigger channel_real_reply_control_sync
  after update of status, provider_reply_id, published_at, last_observed_at, deletion_status
  on public.channel_work_items
  for each row
  execute function channel_private.sync_real_public_reply_state();

revoke all on function channel_private.sync_real_public_reply_state()
  from public, anon, authenticated, service_role;
grant execute on function channel_private.sync_real_public_reply_state()
  to service_role;

-- The existing #478 deletion RPC changes the public work row, while this
-- guard binds a real YouTube delete to the private lifecycle/reply-control
-- records created above. Active and read-only grace are the only states that
-- retain an actionable product delete; stale provenance must hand the owner
-- to YouTube instead. No publication allowance is consulted here.
create or replace function channel_private.enforce_real_reply_deletion_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.publication_provider <> 'youtube'
     or new.deletion_status <> 'in_progress' then
    return new;
  end if;

  if not exists (
    select 1
    from channel_private.channel_lifecycles as lifecycle
    where lifecycle.owner_id = new.owner_id
      and lifecycle.channel_id = new.channel_id
      and lifecycle.connected_channel_id = new.connected_channel_id
      and lifecycle.grant_id = new.oauth_grant_id
      and lifecycle.state in ('active', 'read_only_grace')
      and lifecycle.grant_status = 'active'
      and lifecycle.provenance_status = 'active'
      and lifecycle.local_data_status = 'retained'
  )
  or not exists (
    select 1
    from channel_private.reply_controls as control
    where control.owner_id = new.owner_id
      and control.channel_id = new.channel_id
      and control.connected_channel_id = new.connected_channel_id
      and control.grant_id = new.oauth_grant_id
      and control.provider_reply_id = new.provider_reply_id
      and control.status = 'active'
      and control.last_refreshed_at >= clock_timestamp() - interval '30 days'
  ) then
    raise exception 'real Public Reply deletion requires fresh retained provenance'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists channel_real_reply_deletion_provenance
  on public.channel_work_items;
create trigger channel_real_reply_deletion_provenance
  before update of deletion_status on public.channel_work_items
  for each row
  execute function channel_private.enforce_real_reply_deletion_provenance();

revoke all on function channel_private.enforce_real_reply_deletion_provenance()
  from public, anon, authenticated, service_role;
grant execute on function channel_private.enforce_real_reply_deletion_provenance()
  to service_role;
