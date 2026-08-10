-- Lease and acknowledge immutable activation/correction exports. A crash after
-- PostHog accepts an event replays the same revision and deterministic UUID.

create or replace function public.claim_project_activation_exports(
  p_limit integer default 25
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_exports jsonb;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'claim_project_activation_exports requires service_role';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid Project activation export limit';
  end if;

  with candidates as materialized (
    select outbox.project_id, outbox.activation_revision
    from public.project_activation_outbox as outbox
    where outbox.delivered_at is null
      and (
        outbox.lease_expires_at is null
        or outbox.lease_expires_at <= clock_timestamp()
      )
    order by
      outbox.created_at,
      outbox.project_id,
      outbox.activation_revision
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.project_activation_outbox as outbox
    set lease_token = gen_random_uuid(),
        lease_expires_at = clock_timestamp() + interval '5 minutes',
        delivery_attempts = outbox.delivery_attempts + 1
    from candidates
    where outbox.project_id = candidates.project_id
      and outbox.activation_revision = candidates.activation_revision
    returning outbox.*
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'projectId', claimed.project_id,
        'ownerId', claimed.owner_id,
        'activationRevision', claimed.activation_revision,
        'activationKind', claimed.activation_kind,
        'activatedAt', claimed.activated_at,
        'readyVideos', claimed.ready_videos,
        'leaseToken', claimed.lease_token
      ) order by
        claimed.created_at,
        claimed.project_id,
        claimed.activation_revision
    ),
    '[]'::jsonb
  ) into claimed_exports
  from claimed;

  return jsonb_build_object(
    'outcome', case
      when jsonb_array_length(claimed_exports) = 0 then 'empty'
      else 'claimed'
    end,
    'exports', claimed_exports
  );
end;
$$;

revoke execute on function public.claim_project_activation_exports(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_project_activation_exports(integer)
  to service_role;

create or replace function public.ack_project_activation_export(
  p_project_id uuid,
  p_activation_revision bigint,
  p_lease_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  acknowledged boolean := false;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'ack_project_activation_export requires service_role';
  end if;

  update public.project_activation_outbox
  set delivered_at = clock_timestamp(),
      lease_token = null,
      lease_expires_at = null
  where project_id = p_project_id
    and activation_revision = p_activation_revision
    and lease_token = p_lease_token
    and delivered_at is null
  returning true into acknowledged;

  if acknowledged then
    return jsonb_build_object('outcome', 'acknowledged');
  end if;
  if exists (
    select 1
    from public.project_activation_outbox
    where project_id = p_project_id
      and activation_revision = p_activation_revision
  ) then
    return jsonb_build_object('outcome', 'stale');
  end if;
  return jsonb_build_object('outcome', 'missing');
end;
$$;

revoke execute on function public.ack_project_activation_export(uuid, bigint, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ack_project_activation_export(uuid, bigint, uuid)
  to service_role;
