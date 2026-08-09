-- Each registered Researcher owns exactly one private personal Workspace.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint workspaces_one_personal_per_owner unique (owner_id)
);
