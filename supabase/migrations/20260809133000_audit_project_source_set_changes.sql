-- Issue #320: make Source Set transitions durable and renderable in every
-- Project Conversation. The event rows intentionally contain only stable
-- identifiers, transition metadata, and an owner-facing title snapshot. They
-- never carry prompts, answers, URLs, transcript text, or analytics content.

create table if not exists public.project_source_set_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null
    references public.projects(id) on delete cascade,
  revision bigint not null,
  event_kind text not null,
  video_id uuid not null references public.videos(id) on delete restrict,
  video_title text,
  from_position smallint,
  to_position smallint,
  from_status text,
  to_status text,
  created_at timestamptz not null default now(),
  constraint project_source_set_events_revision_nonnegative
    check (revision >= 1),
  constraint project_source_set_events_kind_valid
    check (event_kind in ('added', 'removed', 'reordered', 'status_changed')),
  constraint project_source_set_events_position_valid
    check (
      (from_position is null or from_position between 1 and 5)
      and (to_position is null or to_position between 1 and 5)
    ),
  constraint project_source_set_events_status_valid
    check (
      (from_status is null or from_status in ('processing', 'ready', 'failed'))
      and (to_status is null or to_status in ('processing', 'ready', 'failed'))
    ),
  constraint project_source_set_events_transition_shape
    check (
      (event_kind = 'added'
        and from_position is null and to_position is not null
        and from_status is null and to_status is not null)
      or (event_kind = 'removed'
        and from_position is not null and to_position is null
        and from_status is not null and to_status is null)
      or (event_kind = 'reordered'
        and from_position is not null and to_position is not null
        and from_status is not distinct from to_status)
      or (event_kind = 'status_changed'
        and from_status is not null and to_status is not null
        and from_status is distinct from to_status)
    ),
  constraint project_source_set_events_revision_once
    unique (project_id, revision)
);

create index if not exists project_source_set_events_project_order_idx
  on public.project_source_set_events (project_id, created_at, id);

alter table public.project_source_set_events enable row level security;

drop policy if exists project_source_set_events_owner_select
  on public.project_source_set_events;
create policy project_source_set_events_owner_select
  on public.project_source_set_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.projects
      join public.workspaces
        on workspaces.id = projects.workspace_id
      where projects.id = project_source_set_events.project_id
        and workspaces.owner_id = (select auth.uid())
    )
  );

revoke all on table public.project_source_set_events
  from public, anon, authenticated, service_role;

-- Record one event for every project_videos transition that is followed by
-- the existing revision-aware RPC update. Multi-row reorder statements are
-- deduplicated by (project_id, revision), while add/remove/readiness changes
-- each produce exactly one row in the same transaction as the mutation.
create or replace function project_private.audit_project_video_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_video_id uuid;
  v_revision bigint;
  v_event_kind text;
  v_video_title text;
  v_from_position smallint;
  v_to_position smallint;
  v_from_status text;
  v_to_status text;
begin
  if current_setting('project_private.audit_skip', true) = 'on' then
    return coalesce(new, old);
  end if;

  v_project_id := coalesce(new.project_id, old.project_id);
  v_video_id := coalesce(new.video_id, old.video_id);

  if tg_op = 'INSERT' then
    v_event_kind := 'added';
    v_from_position := null;
    v_to_position := new.position;
    v_from_status := null;
    v_to_status := new.status;
  elsif tg_op = 'DELETE' then
    v_event_kind := 'removed';
    v_from_position := old.position;
    v_to_position := null;
    v_from_status := old.status;
    v_to_status := null;
  else
    if old.position is distinct from new.position
      and old.status is not distinct from new.status then
      v_event_kind := 'reordered';
    elsif old.status is distinct from new.status then
      v_event_kind := 'status_changed';
    else
      -- Processing leases and timestamps may change without changing the
      -- auditable Source Set state.
      return new;
    end if;
    v_from_position := old.position;
    v_to_position := new.position;
    v_from_status := old.status;
    v_to_status := new.status;
  end if;

  select revision
    into v_revision
  from public.project_source_sets
  where project_id = v_project_id;

  if v_revision is null then
    return coalesce(new, old);
  end if;

  -- Reorder updates every membership row. The Source Set RPC advances the
  -- aggregate once, so retain the first meaningful row as the one event for
  -- that revision.
  if exists (
    select 1
    from public.project_source_set_events
    where project_id = v_project_id
      and revision = v_revision + 1
  ) then
    return coalesce(new, old);
  end if;

  select title
    into v_video_title
  from public.videos
  where id = v_video_id;

  insert into public.project_source_set_events (
    project_id,
    revision,
    event_kind,
    video_id,
    video_title,
    from_position,
    to_position,
    from_status,
    to_status
  ) values (
    v_project_id,
    v_revision + 1,
    v_event_kind,
    v_video_id,
    v_video_title,
    v_from_position,
    v_to_position,
    v_from_status,
    v_to_status
  )
  on conflict (project_id, revision) do nothing;

  return coalesce(new, old);
end;
$$;

revoke all on function project_private.audit_project_video_transition()
  from public, anon, authenticated, service_role;

drop trigger if exists project_videos_audit_transition
  on public.project_videos;
create trigger project_videos_audit_transition
  after insert or update or delete on public.project_videos
  for each row execute function project_private.audit_project_video_transition();

-- Stamp user questions at reservation time. This trigger runs inside the
-- existing atomic start RPC, after its Project ownership check and before the
-- row becomes visible to the owner. Legacy rows may remain null, but all new
-- questions carry a concrete revision (including revision zero).
create or replace function project_private.stamp_project_question_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_revision bigint;
begin
  if new.role <> 'user' or new.source_set_revision is not null then
    return new;
  end if;

  select project_id
    into v_project_id
  from public.project_conversations
  where id = new.conversation_id;

  select revision
    into v_revision
  from public.project_source_sets
  where project_id = v_project_id;

  new.source_set_revision := coalesce(v_revision, 0);
  return new;
end;
$$;

revoke all on function project_private.stamp_project_question_revision()
  from public, anon, authenticated, service_role;

drop trigger if exists project_conversation_messages_stamp_revision
  on public.project_conversation_messages;
create trigger project_conversation_messages_stamp_revision
  before insert on public.project_conversation_messages
  for each row execute function project_private.stamp_project_question_revision();

-- The original composite check required user rows to have a null revision.
-- Replace only that shape check so old rows remain valid and new reservations
-- can retain their creation revision. Column-level checks stay intact.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.project_conversation_messages'::regclass
      and contype = 'c'
      and lower(pg_get_constraintdef(oid)) like '%completion_attempt_token%'
      and lower(pg_get_constraintdef(oid)) like '%role =%'
  loop
    execute format(
      'alter table public.project_conversation_messages drop constraint %I',
      constraint_row.conname
    );
  end loop;
end;
$$;

alter table public.project_conversation_messages
  drop constraint if exists project_conversation_messages_audit_shape_check;

alter table public.project_conversation_messages
  add constraint project_conversation_messages_audit_shape_check
  check (
    (
      role = 'user'
      and in_reply_to_message_id is null
      and char_length(content) <= 200
      and completion_attempt_token is not null
      and completion_state is not null
      and (source_set_revision is null or source_set_revision >= 0)
      and answer_classification is null
      and source_manifest is null
      and source_coverage is null
      and evidence_snapshot is null
      and citation_diagnostics is null
      and completed_at is null
    )
    or
    (
      role = 'assistant'
      and in_reply_to_message_id is not null
      and completion_attempt_token is null
      and completion_state is null
      and answer_classification is not null
      and source_set_revision is not null
      and source_set_revision >= 0
      and source_manifest is not null
      and source_coverage is not null
      and evidence_snapshot is not null
      and citation_diagnostics is not null
      and completed_at is not null
      and jsonb_typeof(source_manifest) = 'object'
      and jsonb_typeof(source_coverage) = 'object'
      and jsonb_typeof(evidence_snapshot) = 'object'
      and jsonb_typeof(citation_diagnostics) = 'array'
      and octet_length(source_manifest::text) <= 65536
      and octet_length(source_coverage::text) <= 32768
      and octet_length(evidence_snapshot::text) <= 131072
      and octet_length(citation_diagnostics::text) <= 16384
    )
  );

-- Keep the existing loader implementation as a private compatibility base,
-- then expose an owner-checked wrapper that enriches messages with the
-- immutable Evidence Snapshot and the durable Source Set event timeline.
do $$
begin
  if to_regprocedure('public.load_project_conversation(uuid,uuid)') is not null
    and to_regprocedure('public.load_project_conversation_legacy(uuid,uuid)') is null
  then
    alter function public.load_project_conversation(uuid, uuid)
      rename to load_project_conversation_legacy;
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.load_project_conversation_legacy(uuid,uuid)')
    is not null
  then
    revoke all on function public.load_project_conversation_legacy(uuid, uuid)
      from public, anon, authenticated, service_role;
  end if;
end;
$$;

create or replace function public.load_project_conversation(
  p_project_id uuid,
  p_conversation_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  enriched_messages jsonb;
  source_set_events jsonb;
begin
  base_result := public.load_project_conversation_legacy(
    p_project_id,
    p_conversation_id
  );

  if base_result ->> 'outcome' <> 'ready' then
    return base_result;
  end if;

  select coalesce(
    jsonb_agg(
      case
        when message.value ->> 'role' = 'assistant'
          and evidence.evidence_snapshot is not null
        then message.value || jsonb_build_object(
          'evidenceSnapshot', evidence.evidence_snapshot
        )
        else message.value
      end
      order by message.ordinality
    ),
    '[]'::jsonb
  )
  into enriched_messages
  from jsonb_array_elements(base_result -> 'messages')
    with ordinality as message(value, ordinality)
  left join lateral (
    select messages.evidence_snapshot
    from public.project_conversation_messages as messages
    where messages.id = (message.value ->> 'id')::uuid
      and messages.role = 'assistant'
      and messages.evidence_snapshot is not null
  ) as evidence on true;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'eventId', events.id,
      'projectId', events.project_id,
      'revision', events.revision,
      'kind', events.event_kind,
      'videoId', events.video_id,
      'videoTitle', events.video_title,
      'fromPosition', events.from_position,
      'toPosition', events.to_position,
      'fromStatus', events.from_status,
      'toStatus', events.to_status,
      'createdAt', events.created_at
    ) order by events.created_at, events.id
  ), '[]'::jsonb)
  into source_set_events
  from (
    select *
    from public.project_source_set_events
    where project_id = p_project_id
    order by created_at, id
    limit 500
  ) as events;

  return base_result
    || jsonb_build_object(
      'messages', enriched_messages,
      'sourceSetEvents', source_set_events
    );
end;
$$;

revoke all on function public.load_project_conversation(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.load_project_conversation(uuid, uuid)
  to authenticated;

create or replace function public.load_default_project_conversation(
  p_project_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.load_project_conversation(p_project_id, null::uuid)
$$;

revoke all on function public.load_default_project_conversation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.load_default_project_conversation(uuid)
  to authenticated;

-- Expiration can transition more than one processing membership in one
-- transaction. Suppress the row trigger for that batch and write one event per
-- consumed revision so the event ledger and aggregate never diverge.
create or replace function public.expire_stale_project_video_processing(
  p_project_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision bigint;
  previous_revision bigint;
  expired_count integer;
  expired_attempts jsonb;
  expired_memberships jsonb;
begin
  perform 1
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;

  select revision
    into current_revision
  from public.project_source_sets
  where project_id = p_project_id
  for update;

  if current_revision is null then
    return jsonb_build_object(
      'outcome', 'unchanged',
      'revision', 0,
      'expiredCount', 0,
      'expiredAttempts', '[]'::jsonb
    );
  end if;

  previous_revision := current_revision;
  perform set_config('project_private.audit_skip', 'on', true);

  with candidates as (
    select
      project_id,
      video_id,
      position,
      greatest(0, extract(epoch from (now() - status_updated_at)))::double precision
        as processing_seconds
    from public.project_videos
    where project_id = p_project_id
      and status = 'processing'
      and status_updated_at <= now() - interval '6 minutes'
    for update
  ), expired as (
    update public.project_videos
    set status = 'failed',
        failure_code = 'processing_interrupted',
        processing_attempt_id = null,
        status_updated_at = now()
    from candidates
    where project_videos.project_id = candidates.project_id
      and project_videos.video_id = candidates.video_id
    returning candidates.video_id,
      candidates.position,
      candidates.processing_seconds
  )
  select
    count(*)::integer,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'ordinal', position,
          'processingSeconds', processing_seconds
        )
        order by position
      ),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'videoId', video_id,
          'position', position
        )
        order by position
      ),
      '[]'::jsonb
    )
  into expired_count, expired_attempts, expired_memberships
  from expired;

  perform set_config('project_private.audit_skip', 'off', true);

  if expired_count = 0 then
    return jsonb_build_object(
      'outcome', 'unchanged',
      'revision', current_revision,
      'expiredCount', 0,
      'expiredAttempts', '[]'::jsonb
    );
  end if;

  update public.project_source_sets
  set revision = current_revision + expired_count,
      updated_at = now()
  where project_id = p_project_id
  returning revision into current_revision;

  insert into public.project_source_set_events (
    project_id,
    revision,
    event_kind,
    video_id,
    video_title,
    from_position,
    to_position,
    from_status,
    to_status
  )
  select
    p_project_id,
    previous_revision + memberships.ordinality,
    'status_changed',
    (memberships.item ->> 'videoId')::uuid,
    videos.title,
    (memberships.item ->> 'position')::smallint,
    (memberships.item ->> 'position')::smallint,
    'processing',
    'failed'
  from jsonb_array_elements(expired_memberships) with ordinality as memberships(item, ordinality)
  join public.videos
    on videos.id = (memberships.item ->> 'videoId')::uuid
  on conflict (project_id, revision) do nothing;

  return jsonb_build_object(
    'outcome', 'expired',
    'revision', current_revision,
    'expiredCount', expired_count,
    'expiredAttempts', expired_attempts
  );
end;
$$;

revoke all on function public.expire_stale_project_video_processing(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.expire_stale_project_video_processing(uuid)
  to service_role;

notify pgrst, 'reload schema';
