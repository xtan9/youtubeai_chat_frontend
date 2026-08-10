-- Transactional, content-free activation correction outbox.

create table public.project_activation_outbox (
  project_id uuid not null references public.projects(id) on delete cascade,
  activation_revision bigint not null check (activation_revision > 0),
  owner_id uuid not null,
  activation_kind text not null check (
    activation_kind in ('search', 'message', 'artifact')
  ),
  activated_at timestamptz not null,
  ready_videos integer not null check (ready_videos between 2 and 5),
  lease_token uuid,
  lease_expires_at timestamptz,
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (project_id, activation_revision),
  constraint project_activation_outbox_lease_coherent check (
    (lease_token is null) = (lease_expires_at is null)
  )
);

create index project_activation_outbox_pending_idx
  on public.project_activation_outbox (
    delivered_at,
    lease_expires_at,
    created_at,
    project_id,
    activation_revision
  );

alter table public.project_activation_outbox enable row level security;
revoke all on table public.project_activation_outbox
  from public, anon, authenticated, service_role;

create or replace function public.record_project_analytics_transition(
  p_project_id uuid,
  p_owner_id uuid,
  p_trigger_kind text,
  p_occurred_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_owner uuid;
  project_created_at timestamptz;
  state_row public.project_analytics_state%rowtype;
  ready_video_count integer;
  ready_threshold_at timestamptz;
  activation_candidate_at timestamptz;
  activated_now boolean := false;
  activation_changed boolean := false;
  qualifying_activity_changed boolean := false;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'record_project_analytics_transition requires service_role';
  end if;
  if p_trigger_kind not in ('created', 'source_ready', 'search', 'message', 'artifact') then
    raise exception 'invalid Project analytics trigger';
  end if;
  if p_occurred_at is null
    or p_occurred_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'invalid Project analytics occurrence time';
  end if;

  -- Lock the private Project row so concurrent qualifying actions and source
  -- readiness transitions serialize even before an analytics state row exists.
  select workspaces.owner_id, projects.created_at
    into project_owner, project_created_at
    from public.projects
    join public.workspaces on workspaces.id = projects.workspace_id
    where projects.id = p_project_id
    for update of projects;

  if project_owner is null or project_owner <> p_owner_id then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if p_occurred_at < project_created_at then
    raise exception 'Project analytics occurrence predates Project';
  end if;

  insert into public.project_analytics_state (project_id, owner_id)
    values (p_project_id, p_owner_id)
    on conflict (project_id) do nothing;

  select * into state_row
    from public.project_analytics_state
    where project_id = p_project_id
    for update;

  if state_row.owner_id <> p_owner_id then
    raise exception 'Project analytics owner invariant violated';
  end if;

  if p_trigger_kind in ('search', 'message', 'artifact')
    and (
      state_row.first_qualifying_activity_at is null
      or (p_occurred_at, p_trigger_kind) < (
        state_row.first_qualifying_activity_at,
        state_row.first_qualifying_activity_kind
      )
    ) then
    state_row.first_qualifying_activity_kind := p_trigger_kind;
    state_row.first_qualifying_activity_at := p_occurred_at;
    qualifying_activity_changed := true;
  end if;

  select count(*)::integer into ready_video_count
    from public.project_videos
    where project_id = p_project_id
      and status = 'ready';

  select max(readiness.status_updated_at)
    into ready_threshold_at
    from (
      select status_updated_at
      from public.project_videos
      where project_id = p_project_id
        and status = 'ready'
      order by status_updated_at, video_id
      limit 2
    ) as readiness;

  if state_row.first_qualifying_activity_kind is not null
    and state_row.activated_at is not null then
    -- Preserve the exact readiness threshold that originally qualified the
    -- Project. A delayed earlier action can correct the anchor even if sources
    -- were subsequently removed or failed.
    activation_candidate_at := greatest(
      state_row.first_qualifying_activity_at,
      state_row.activation_ready_threshold_at
    );
  elsif state_row.first_qualifying_activity_kind is not null
    and ready_video_count >= 2 then
    activation_candidate_at := greatest(
      state_row.first_qualifying_activity_at,
      ready_threshold_at
    );
  end if;

  if activation_candidate_at is not null
    and (
      state_row.activated_at is null
      or activation_candidate_at < state_row.activated_at
      or state_row.activation_kind is distinct from
        state_row.first_qualifying_activity_kind
  ) then
    activated_now := state_row.activated_at is null;
    activation_changed := true;
    state_row.activation_revision := state_row.activation_revision + 1;
    if activated_now then
      state_row.activation_ready_threshold_at := ready_threshold_at;
      state_row.activation_ready_videos := ready_video_count;
    end if;
    update public.project_analytics_state
      set first_qualifying_activity_kind =
            state_row.first_qualifying_activity_kind,
          first_qualifying_activity_at =
            state_row.first_qualifying_activity_at,
          activated_at = activation_candidate_at,
          activation_kind = state_row.first_qualifying_activity_kind,
          activation_revision = state_row.activation_revision,
          activation_ready_threshold_at =
            state_row.activation_ready_threshold_at,
          activation_ready_videos = state_row.activation_ready_videos,
          updated_at = clock_timestamp()
      where project_id = p_project_id;
    state_row.activated_at := activation_candidate_at;
    state_row.activation_kind := state_row.first_qualifying_activity_kind;
  elsif qualifying_activity_changed then
    update public.project_analytics_state
      set first_qualifying_activity_kind =
            state_row.first_qualifying_activity_kind,
          first_qualifying_activity_at =
            state_row.first_qualifying_activity_at,
          updated_at = clock_timestamp()
      where project_id = p_project_id;
  end if;

  if activation_changed then
    insert into public.project_activation_outbox (
      project_id,
      activation_revision,
      owner_id,
      activation_kind,
      activated_at,
      ready_videos
    ) values (
      p_project_id,
      state_row.activation_revision,
      p_owner_id,
      state_row.activation_kind,
      state_row.activated_at,
      state_row.activation_ready_videos
    );
  end if;

  return jsonb_build_object(
    'outcome', case
      when activated_now then 'activated'
      when state_row.activated_at is not null then 'already_activated'
      else 'recorded'
    end,
    'activationKind', state_row.activation_kind,
    'activationRevision', state_row.activation_revision,
    'readyVideos', ready_video_count
  );
end;
$$;

revoke execute on function public.record_project_analytics_transition(uuid, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.record_project_analytics_transition(uuid, uuid, text, timestamptz)
  to service_role;
