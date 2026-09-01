-- Channel onboarding foundation.
--
-- This migration is intentionally inert: no application route or navigation
-- entry consumes it yet. It prepares account-owned records and trusted
-- transaction boundaries for the final, separately approved release.
--
-- Provider access tokens are deliberately not stored in these tables. The
-- server-side provider adapter owns credential handling and submits only a
-- verified provider identity to the service-role commit function.

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  constraint channels_id_owner_key unique (id, owner_id)
);

create table public.channel_oauth_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null,
  provider text not null default 'youtube'
    check (provider = 'youtube'),
  provider_subject text not null,
  read_scope_granted boolean not null default false,
  write_scope_granted boolean not null default false,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  constraint channel_oauth_grants_id_owner_key unique (id, owner_id),
  constraint channel_oauth_grants_id_owner_channel_key
    unique (id, owner_id, channel_id),
  constraint channel_oauth_grants_channel_owner_fk
    foreign key (channel_id, owner_id)
    references public.channels (id, owner_id)
    on delete cascade,
  constraint channel_oauth_grants_read_scope_ck
    check (status = 'revoked' or read_scope_granted is true),
  constraint channel_oauth_grants_revoked_at_ck
    check ((status = 'revoked') = (revoked_at is not null))
);

create table public.connected_youtube_channels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null,
  oauth_grant_id uuid not null,
  provider text not null default 'youtube'
    check (provider = 'youtube'),
  provider_channel_id text not null,
  display_name text not null,
  supported_creator boolean not null default true
    check (supported_creator is true),
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  constraint connected_youtube_channels_id_owner_key unique (id, owner_id),
  constraint connected_youtube_channels_id_owner_channel_key
    unique (id, owner_id, channel_id),
  constraint connected_youtube_channels_grant_unique unique (oauth_grant_id),
  constraint connected_youtube_channels_channel_owner_fk
    foreign key (channel_id, owner_id)
    references public.channels (id, owner_id)
    on delete cascade,
  constraint connected_youtube_channels_grant_owner_fk
    foreign key (oauth_grant_id, owner_id)
    references public.channel_oauth_grants (id, owner_id)
    on delete cascade,
  constraint connected_youtube_channels_grant_channel_fk
    foreign key (oauth_grant_id, owner_id, channel_id)
    references public.channel_oauth_grants (id, owner_id, channel_id)
    on delete cascade,
  constraint connected_youtube_channels_revoked_at_ck
    check ((status = 'revoked') = (revoked_at is not null)),
  constraint connected_youtube_channels_provider_id_ck
    check (length(btrim(provider_channel_id)) between 1 and 240),
  constraint connected_youtube_channels_display_name_ck
    check (length(btrim(display_name)) between 1 and 240)
);

create unique index connected_youtube_channels_one_active_identity
  on public.connected_youtube_channels (owner_id, provider, provider_channel_id)
  where status = 'active';

create table public.active_connected_channel_selections (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  channel_id uuid not null,
  connected_channel_id uuid not null,
  selected_at timestamptz not null default clock_timestamp(),
  constraint active_connected_channel_selections_channel_owner_fk
    foreign key (channel_id, owner_id)
    references public.channels (id, owner_id)
    on delete cascade,
  constraint active_connected_channel_selections_connected_owner_fk
    foreign key (connected_channel_id, owner_id)
    references public.connected_youtube_channels (id, owner_id)
    on delete cascade,
  constraint active_connected_channel_selections_connected_channel_fk
    foreign key (connected_channel_id, owner_id, channel_id)
    references public.connected_youtube_channels (id, owner_id, channel_id)
    on delete cascade
);

-- An attestation is the only adult record. No birth date, identity document,
-- or other identity evidence is collected.
create table public.channel_adult_attestations (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  attested_at timestamptz not null default clock_timestamp(),
  policy_version text not null,
  constraint channel_adult_attestations_policy_version_ck
    check (length(btrim(policy_version)) between 1 and 80)
);

-- Work carries only the identifiers and current-source hash needed to bind a
-- future review/publication action. Comment and draft text retention belongs
-- to the later Channel work migration and its policy-bounded cleanup.
create table public.channel_work_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null,
  connected_channel_id uuid not null,
  oauth_grant_id uuid not null,
  comment_id text not null,
  comment_hash text not null,
  status text not null default 'awaiting_review'
    check (status in (
      'awaiting_review',
      'dismissed',
      'marked_criticism',
      'draft_requested',
      'draft_ready',
      'stale',
      'publishing',
      'failed',
      'published',
      'publication_uncertain',
      'deleted'
    )),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint channel_work_items_id_owner_key unique (id, owner_id),
  constraint channel_work_items_channel_owner_fk
    foreign key (channel_id, owner_id)
    references public.channels (id, owner_id)
    on delete cascade,
  constraint channel_work_items_connected_owner_fk
    foreign key (connected_channel_id, owner_id)
    references public.connected_youtube_channels (id, owner_id)
    on delete cascade,
  constraint channel_work_items_connected_channel_fk
    foreign key (connected_channel_id, owner_id, channel_id)
    references public.connected_youtube_channels (id, owner_id, channel_id)
    on delete cascade,
  constraint channel_work_items_grant_owner_fk
    foreign key (oauth_grant_id, owner_id)
    references public.channel_oauth_grants (id, owner_id)
    on delete cascade,
  constraint channel_work_items_grant_channel_fk
    foreign key (oauth_grant_id, owner_id, channel_id)
    references public.channel_oauth_grants (id, owner_id, channel_id)
    on delete cascade,
  constraint channel_work_items_comment_id_ck
    check (length(btrim(comment_id)) between 1 and 240),
  constraint channel_work_items_comment_hash_ck
    check (length(btrim(comment_hash)) between 1 and 240)
);

create index channel_oauth_grants_owner_idx
  on public.channel_oauth_grants (owner_id, created_at desc);

create index connected_youtube_channels_owner_idx
  on public.connected_youtube_channels (owner_id, created_at desc);

create index channel_work_items_owner_connected_idx
  on public.channel_work_items (owner_id, connected_channel_id, updated_at desc);

alter table public.channels enable row level security;
alter table public.channel_oauth_grants enable row level security;
alter table public.connected_youtube_channels enable row level security;
alter table public.active_connected_channel_selections enable row level security;
alter table public.channel_adult_attestations enable row level security;
alter table public.channel_work_items enable row level security;

create policy channels_owner_select
  on public.channels
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy channel_oauth_grants_owner_select
  on public.channel_oauth_grants
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy connected_youtube_channels_owner_select
  on public.connected_youtube_channels
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy active_connected_channel_selections_owner_select
  on public.active_connected_channel_selections
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy channel_adult_attestations_owner_select
  on public.channel_adult_attestations
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy channel_work_items_owner_select
  on public.channel_work_items
  for select to authenticated
  using ((select auth.uid()) = owner_id);

-- All mutations use server-owned functions so a browser cannot insert a
-- locally selected provider channel or change the account's active identity.
revoke all on table public.channels from public, anon, authenticated;
revoke all on table public.channel_oauth_grants from public, anon, authenticated;
revoke all on table public.connected_youtube_channels from public, anon, authenticated;
revoke all on table public.active_connected_channel_selections from public, anon, authenticated;
revoke all on table public.channel_adult_attestations from public, anon, authenticated;
revoke all on table public.channel_work_items from public, anon, authenticated;

grant select on table public.channels to authenticated;
grant select on table public.channel_oauth_grants to authenticated;
grant select on table public.connected_youtube_channels to authenticated;
grant select on table public.active_connected_channel_selections to authenticated;
grant select on table public.channel_adult_attestations to authenticated;
grant select on table public.channel_work_items to authenticated;

create or replace function public.attest_channel_adult(p_policy_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  saved_attested_at timestamptz;
  saved_policy_version text;
begin
  if actor_id is null then
    raise exception 'authenticated Researcher required'
      using errcode = '42501';
  end if;
  if nullif(btrim(p_policy_version), '') is null
    or length(btrim(p_policy_version)) > 80
  then
    raise exception 'adult attestation policy version is invalid'
      using errcode = '22023';
  end if;

  insert into public.channel_adult_attestations (
    owner_id, attested_at, policy_version
  )
  values (actor_id, clock_timestamp(), btrim(p_policy_version))
  on conflict (owner_id) do update
    set attested_at = excluded.attested_at,
        policy_version = excluded.policy_version
  returning attested_at, policy_version
    into saved_attested_at, saved_policy_version;

  return jsonb_build_object(
    'attested', true,
    'attestedAt', saved_attested_at,
    'policyVersion', saved_policy_version
  );
end;
$$;

revoke all on function public.attest_channel_adult(text)
  from public, anon;
grant execute on function public.attest_channel_adult(text)
  to authenticated;

-- This is a server-only bridge. The provider adapter must resolve exactly one
-- `mine=true` identity before it may submit p_provider_identity_verified=true;
-- browser callers cannot execute this function directly.
create or replace function public.complete_channel_onboarding(
  p_owner_id uuid,
  p_provider_identity_verified boolean,
  p_provider_subject text,
  p_provider_channel_id text,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  channel_id uuid;
  grant_id uuid;
  connected_channel_id uuid;
  existing_connected record;
begin
  if p_owner_id is null then
    raise exception 'Channel owner is required'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from auth.users
    where id = p_owner_id
      and not coalesce(is_anonymous, false)
  ) then
    raise exception 'registered Researcher is required'
      using errcode = '42501';
  end if;
  if p_provider_identity_verified is not true then
    raise exception 'provider identity verification is required'
      using errcode = '42501';
  end if;
  if nullif(btrim(p_provider_subject), '') is null
    or nullif(btrim(p_provider_channel_id), '') is null
    or nullif(btrim(p_display_name), '') is null
    or length(btrim(p_provider_subject)) > 240
    or length(btrim(p_provider_channel_id)) > 240
    or length(btrim(p_display_name)) > 240
  then
    raise exception 'provider identity is invalid'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.channel_adult_attestations
    where owner_id = p_owner_id
  ) then
    raise exception '18+ adult attestation is required'
      using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.user_subscriptions
    where user_id = p_owner_id
      and tier = 'pro'
  ) then
    raise exception 'active Pro entitlement is required'
      using errcode = '42501';
  end if;

  -- A retried callback for the same still-active provider identity is
  -- idempotent. The unique active identity index also protects concurrent
  -- callbacks; this branch only restores the active selection.
  select connected.*
    into existing_connected
  from public.connected_youtube_channels as connected
  join public.channel_oauth_grants as existing_grant
    on existing_grant.id = connected.oauth_grant_id
   and existing_grant.owner_id = connected.owner_id
  where connected.owner_id = p_owner_id
    and connected.provider = 'youtube'
    and connected.provider_channel_id = btrim(p_provider_channel_id)
    and existing_grant.provider_subject = btrim(p_provider_subject)
    and connected.status = 'active'
  order by connected.created_at desc
  limit 1;

  if existing_connected.id is not null then
    insert into public.active_connected_channel_selections (
      owner_id, channel_id, connected_channel_id, selected_at
    )
    values (
      p_owner_id,
      existing_connected.channel_id,
      existing_connected.id,
      clock_timestamp()
    )
    on conflict (owner_id) do update
      set channel_id = excluded.channel_id,
          connected_channel_id = excluded.connected_channel_id,
          selected_at = excluded.selected_at;

    return jsonb_build_object(
      'outcome', 'already_connected',
      'channelId', existing_connected.channel_id,
      'connectedChannelId', existing_connected.id,
      'grantId', existing_connected.oauth_grant_id
    );
  end if;

  -- All inserts and the active-channel switch are one transaction. An
  -- interrupted callback never calls this function, and a failed statement
  -- rolls back the complete connection rather than leaving partial records.
  insert into public.channels (owner_id)
  values (p_owner_id)
  returning id into channel_id;

  insert into public.channel_oauth_grants (
    owner_id,
    channel_id,
    provider,
    provider_subject,
    read_scope_granted,
    write_scope_granted,
    status
  )
  values (
    p_owner_id,
    channel_id,
    'youtube',
    btrim(p_provider_subject),
    true,
    false,
    'active'
  )
  returning id into grant_id;

  insert into public.connected_youtube_channels (
    owner_id,
    channel_id,
    oauth_grant_id,
    provider,
    provider_channel_id,
    display_name,
    supported_creator,
    status
  )
  values (
    p_owner_id,
    channel_id,
    grant_id,
    'youtube',
    btrim(p_provider_channel_id),
    btrim(p_display_name),
    true,
    'active'
  )
  returning id into connected_channel_id;

  insert into public.active_connected_channel_selections (
    owner_id, channel_id, connected_channel_id, selected_at
  )
  values (p_owner_id, channel_id, connected_channel_id, clock_timestamp())
  on conflict (owner_id) do update
    set channel_id = excluded.channel_id,
        connected_channel_id = excluded.connected_channel_id,
        selected_at = excluded.selected_at;

  return jsonb_build_object(
    'outcome', 'connected',
    'channelId', channel_id,
    'grantId', grant_id,
    'connectedChannelId', connected_channel_id
  );
end;
$$;

revoke all on function public.complete_channel_onboarding(
  uuid, boolean, text, text, text
) from public, anon, authenticated;
grant execute on function public.complete_channel_onboarding(
  uuid, boolean, text, text, text
) to service_role;

create or replace function public.set_active_connected_channel(
  p_owner_id uuid,
  p_connected_channel_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_channel record;
begin
  select connected.id, connected.channel_id
    into selected_channel
  from public.connected_youtube_channels as connected
  where connected.id = p_connected_channel_id
    and connected.owner_id = p_owner_id
    and connected.status = 'active'
    and connected.supported_creator is true;

  if selected_channel.id is null then
    raise exception 'owned active Supported Creator Channel is required'
      using errcode = '42501';
  end if;

  insert into public.active_connected_channel_selections (
    owner_id, channel_id, connected_channel_id, selected_at
  )
  values (
    p_owner_id,
    selected_channel.channel_id,
    selected_channel.id,
    clock_timestamp()
  )
  on conflict (owner_id) do update
    set channel_id = excluded.channel_id,
        connected_channel_id = excluded.connected_channel_id,
        selected_at = excluded.selected_at;

  return jsonb_build_object(
    'outcome', 'selected',
    'connectedChannelId', selected_channel.id
  );
end;
$$;

revoke all on function public.set_active_connected_channel(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.set_active_connected_channel(uuid, uuid)
  to service_role;

-- A future publication route must use this binding check in the same
-- transaction as its exclusive work-item claim. It intentionally checks the
-- active identity, original Channel, original grant, and non-revoked record.
create or replace function public.channel_work_item_is_publishable(
  p_owner_id uuid,
  p_work_item_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.channel_work_items as work
    join public.active_connected_channel_selections as active
      on active.owner_id = work.owner_id
     and active.connected_channel_id = work.connected_channel_id
     and active.channel_id = work.channel_id
    join public.connected_youtube_channels as connected
      on connected.id = work.connected_channel_id
     and connected.owner_id = work.owner_id
     and connected.oauth_grant_id = work.oauth_grant_id
    join public.channel_oauth_grants as grant_record
      on grant_record.id = work.oauth_grant_id
     and grant_record.owner_id = work.owner_id
    where work.id = p_work_item_id
      and work.owner_id = p_owner_id
      and active.connected_channel_id = work.connected_channel_id
      and work.status = 'draft_ready'
      and connected.status = 'active'
      and connected.supported_creator is true
      and grant_record.status = 'active'
      and grant_record.write_scope_granted is true
  );
$$;

revoke all on function public.channel_work_item_is_publishable(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.channel_work_item_is_publishable(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
