-- Issue #488: bind a Supported Creator Channel grant to an opaque reference
-- held by a server-side encrypted credential store.
--
-- This migration stores no access token, refresh token, OAuth code, or key
-- material. The reference is unusable without the separate server-only vault;
-- application code must fail closed when that vault is unavailable.

alter table public.channel_oauth_grants
  add column if not exists oauth_scopes text[] not null
    default array[
      'https://www.googleapis.com/auth/youtube.readonly'
    ]::text[],
  add column if not exists credential_reference_id text;

alter table public.channel_oauth_grants
  add constraint channel_oauth_grants_scopes_ck
  check (
    cardinality(oauth_scopes) between 1 and 2
    and oauth_scopes <@ array[
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.force-ssl'
    ]::text[]
    and 'https://www.googleapis.com/auth/youtube.readonly' = any(oauth_scopes)
    and (
      write_scope_granted = (
        'https://www.googleapis.com/auth/youtube.force-ssl' = any(oauth_scopes)
      )
    )
    and (
      cardinality(oauth_scopes) = 1
      or oauth_scopes[1] <> oauth_scopes[2]
    )
  );

alter table public.channel_oauth_grants
  add constraint channel_oauth_grants_credential_reference_ck
  check (
    credential_reference_id is null
    or (
      credential_reference_id = btrim(credential_reference_id)
      and length(btrim(credential_reference_id)) between 1 and 240
    )
  );

create unique index channel_oauth_grants_credential_reference_idx
  on public.channel_oauth_grants (credential_reference_id)
  where credential_reference_id is not null;

-- The earlier identity-only helper must not remain a callable path for a new
-- connection. The credential-bound function below owns the only new insert
-- path, after the application has encrypted the provider token set.
revoke all on function public.complete_channel_onboarding(
  uuid, boolean, text, text, text
) from public, anon, authenticated, service_role;

-- The callback caller must first encrypt the transient provider token set and
-- obtain the opaque reference. Explicit IDs keep the reference association
-- identical to the account-owned records assembled by the domain contract.
create or replace function public.complete_channel_onboarding_with_credential(
  p_owner_id uuid,
  p_provider_identity_verified boolean,
  p_channel_id uuid,
  p_grant_id uuid,
  p_connected_channel_id uuid,
  p_provider_subject text,
  p_provider_channel_id text,
  p_display_name text,
  p_credential_reference_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_connected record;
begin
  if p_owner_id is null
    or p_channel_id is null
    or p_grant_id is null
    or p_connected_channel_id is null
  then
    raise exception 'Channel identifiers are required'
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
  if nullif(btrim(p_credential_reference_id), '') is null
    or length(btrim(p_credential_reference_id)) > 240
  then
    raise exception 'encrypted OAuth credential reference is required'
      using errcode = '22023';
  end if;

  -- A retry for one identity is safe only when it supplies the same
  -- account-owned IDs. Never replace an already-bound credential reference.
  select connected.id,
         connected.channel_id,
         connected.oauth_grant_id,
         existing_grant.credential_reference_id
    into existing_connected
  from public.connected_youtube_channels as connected
  join public.channel_oauth_grants as existing_grant
    on existing_grant.id = connected.oauth_grant_id
   and existing_grant.owner_id = connected.owner_id
  where connected.owner_id = p_owner_id
    and connected.provider = 'youtube'
    and connected.provider_channel_id = btrim(p_provider_channel_id)
    and existing_grant.provider_subject = btrim(p_provider_subject)
    and existing_grant.status = 'active'
    and existing_grant.read_scope_granted is true
    and existing_grant.write_scope_granted is false
    and connected.status = 'active'
  order by connected.created_at desc
  limit 1;

  if existing_connected.id is not null then
    if existing_connected.channel_id <> p_channel_id
      or existing_connected.oauth_grant_id <> p_grant_id
      or existing_connected.id <> p_connected_channel_id
    then
      raise exception 'provider identity is already bound to another grant'
        using errcode = '23505';
    end if;
    if existing_connected.credential_reference_id is not null
      and existing_connected.credential_reference_id
        <> btrim(p_credential_reference_id)
    then
      raise exception 'provider grant already has a credential reference'
        using errcode = '23505';
    end if;

    update public.channel_oauth_grants
    set credential_reference_id = btrim(p_credential_reference_id),
        oauth_scopes = array[
          'https://www.googleapis.com/auth/youtube.readonly'
        ]::text[]
    where id = existing_connected.oauth_grant_id
      and owner_id = p_owner_id
      and credential_reference_id is null;

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

  insert into public.channels (id, owner_id)
  values (p_channel_id, p_owner_id);

  insert into public.channel_oauth_grants (
    id,
    owner_id,
    channel_id,
    provider,
    provider_subject,
    credential_reference_id,
    oauth_scopes,
    read_scope_granted,
    write_scope_granted,
    status
  )
  values (
    p_grant_id,
    p_owner_id,
    p_channel_id,
    'youtube',
    btrim(p_provider_subject),
    btrim(p_credential_reference_id),
    array[
      'https://www.googleapis.com/auth/youtube.readonly'
    ]::text[],
    true,
    false,
    'active'
  );

  insert into public.connected_youtube_channels (
    id,
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
    p_connected_channel_id,
    p_owner_id,
    p_channel_id,
    p_grant_id,
    'youtube',
    btrim(p_provider_channel_id),
    btrim(p_display_name),
    true,
    'active'
  );

  insert into public.active_connected_channel_selections (
    owner_id, channel_id, connected_channel_id, selected_at
  )
  values (p_owner_id, p_channel_id, p_connected_channel_id, clock_timestamp())
  on conflict (owner_id) do update
    set channel_id = excluded.channel_id,
        connected_channel_id = excluded.connected_channel_id,
        selected_at = excluded.selected_at;

  return jsonb_build_object(
    'outcome', 'connected',
    'channelId', p_channel_id,
    'grantId', p_grant_id,
    'connectedChannelId', p_connected_channel_id
  );
end;
$$;

revoke all on function public.complete_channel_onboarding_with_credential(
  uuid, boolean, uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.complete_channel_onboarding_with_credential(
  uuid, boolean, uuid, uuid, uuid, text, text, text, text
) to service_role;

notify pgrst, 'reload schema';
