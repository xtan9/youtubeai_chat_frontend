-- Private Projects hold Researcher-authored metadata within a Workspace.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  goal text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  constraint projects_name_valid check (
    name = btrim(name)
    and char_length(name) between 1 and 120
  ),
  constraint projects_goal_valid check (
    goal is null
    or (
      goal = btrim(goal)
      and char_length(goal) between 1 and 2000
    )
  )
);

create index projects_workspace_recent_idx
  on public.projects (workspace_id, last_active_at desc, id desc);
