-- Serialize Project creation per Workspace and enforce the Free plan's one
-- durable Project allowance at the database boundary. Hard deletion removes
-- the row, so it frees only this allowance; unrelated usage tables are never
-- read or mutated here.

create function project_private.enforce_project_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_owner_id uuid;
  request_user_id uuid := auth.uid();
  request_role text := current_setting('role', true);
  request_jwt jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  owner_tier text;
  smoke_pro_entitled boolean := false;
begin
  select owner_id
  into workspace_owner_id
  from public.workspaces
  where id = new.workspace_id;

  -- The trigger runs as its owner only so it can read the server-owned
  -- Subscription tier. Missing and foreign Workspace identifiers deliberately
  -- share one response for untrusted roles so UUID existence is not exposed.
  if request_role = 'anon'
    or (
      request_role = 'authenticated'
      and (
        workspace_owner_id is null
        or request_user_id is null
        or request_user_id <> workspace_owner_id
      )
    )
  then
    raise insufficient_privilege using message = 'Project Workspace access is not allowed';
  end if;

  -- Preserve the normal foreign-key classification for trusted server roles.
  if workspace_owner_id is null then
    raise foreign_key_violation using message = 'Project Workspace access is not allowed';
  end if;

  -- Smoke Pro is an internal Auth entitlement. PostgREST verifies the JWT
  -- before exposing its service-managed app_metadata claims to auth.jwt().
  -- Requiring both exact markers prevents user-editable user_metadata or
  -- request JSON from granting Project access.
  smoke_pro_entitled :=
    request_role = 'authenticated'
    and request_user_id = workspace_owner_id
    and request_jwt ->> 'sub' = request_user_id::text
    and request_jwt @> '{
      "app_metadata": {
        "is_smoke_account": true,
        "smoke_entitlement": "pro"
      }
    }'::jsonb;

  -- Transaction-scoped locking makes the count-and-insert decision atomic
  -- across concurrent API requests without serializing unrelated Workspaces.
  perform pg_advisory_xact_lock(
    hashtextextended(new.workspace_id::text, 0)
  );

  select tier
  into owner_tier
  from public.user_subscriptions
  where user_id = workspace_owner_id;

  if not smoke_pro_entitled
    and coalesce(owner_tier, 'free') <> 'pro'
    and exists (
      select 1
      from public.projects
      where workspace_id = new.workspace_id
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'FREE_PROJECT_LIMIT_REACHED';
  end if;

  return new;
end;
$$;

revoke all on function project_private.enforce_project_plan_limit()
  from public, anon, authenticated;

create trigger projects_enforce_plan_limit
before insert on public.projects
for each row execute function project_private.enforce_project_plan_limit();

comment on function project_private.enforce_project_plan_limit() is
  'Enforces the owner-derived Free Project allowance atomically before insert.';
