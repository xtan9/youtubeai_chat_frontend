-- Ordered many-to-many membership references canonical Videos only.

create table public.project_videos (
  project_id uuid not null
    references public.project_source_sets(project_id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete restrict,
  position smallint not null,
  status text not null default 'processing',
  failure_code text,
  added_at timestamptz not null default now(),
  status_updated_at timestamptz not null default now(),
  primary key (project_id, video_id),
  constraint project_videos_position_bounded check (position between 1 and 5),
  constraint project_videos_status_valid check (
    status in ('processing', 'ready', 'failed')
  ),
  constraint project_videos_failure_code_valid check (
    failure_code is null
    or (
      status = 'failed'
      and failure_code = lower(btrim(failure_code))
      and failure_code ~ '^[a-z0-9_]{1,64}$'
    )
  ),
  constraint project_videos_project_position_key
    unique (project_id, position)
    deferrable initially immediate
);

create index project_videos_video_id_idx
  on public.project_videos (video_id);

-- Start closed even when hosted default privileges grant new public tables.
-- The later Source Set security migration adds read-only application access.
revoke all on table public.project_videos
  from public, anon, authenticated, service_role;
