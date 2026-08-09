-- One owned default Project Conversation. Ownership remains derived through
-- Project -> Workspace so it cannot drift from the Project's Researcher.

create table public.project_conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null default 'default' check (kind = 'default'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, kind)
);

comment on table public.project_conversations is
  'Durable Researcher-owned conversation threads derived from Project ownership.';
