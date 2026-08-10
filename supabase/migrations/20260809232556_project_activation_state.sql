-- Durable, content-free Project activation state and service-only transition RPC.

create table public.project_analytics_state (
  project_id uuid primary key references public.projects(id) on delete cascade,
  owner_id uuid not null,
  first_qualifying_activity_kind text,
  first_qualifying_activity_at timestamptz,
  activated_at timestamptz,
  activation_kind text,
  activation_revision bigint not null default 0,
  activation_ready_threshold_at timestamptz,
  activation_ready_videos integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_analytics_activity_kind_valid check (
    first_qualifying_activity_kind is null
    or first_qualifying_activity_kind in ('search', 'message', 'artifact')
  ),
  constraint project_analytics_activation_kind_valid check (
    activation_kind is null
    or activation_kind in ('search', 'message', 'artifact')
  ),
  constraint project_analytics_activity_coherent check (
    (first_qualifying_activity_kind is null) =
      (first_qualifying_activity_at is null)
  ),
  constraint project_analytics_activation_coherent check (
    (
      activated_at is null
      and activation_kind is null
      and activation_revision = 0
      and activation_ready_threshold_at is null
      and activation_ready_videos is null
    )
    or (
      activated_at is not null
      and activation_kind = first_qualifying_activity_kind
      and first_qualifying_activity_at is not null
      and activation_revision > 0
      and activation_ready_threshold_at is not null
      and activation_ready_videos between 2 and 5
    )
  )
);

alter table public.project_analytics_state enable row level security;
revoke all on table public.project_analytics_state
  from public, anon, authenticated, service_role;
