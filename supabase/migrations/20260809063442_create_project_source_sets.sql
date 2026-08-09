-- Durable aggregate metadata for a Project's ordered Source Set.

create table public.project_source_sets (
  project_id uuid primary key references public.projects(id) on delete cascade,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint project_source_sets_revision_nonnegative check (revision >= 0)
);

-- Supabase may grant new public tables through default privileges. Start
-- closed so no intermediate migration exposes revision writes.
revoke all on table public.project_source_sets
  from public, anon, authenticated, service_role;
