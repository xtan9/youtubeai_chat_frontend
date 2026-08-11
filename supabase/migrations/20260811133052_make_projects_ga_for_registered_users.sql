-- Projects are generally available to every permanent Supabase user. Keep
-- anonymous Auth users outside the durable Workspace model while preserving
-- the existing owner-scoped RLS, plan limits, and least-privileged RPC owner.

create or replace function project_private.has_registered_project_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    current_setting('role', true) in (
      'authenticated',
      'project_beta_rpc_owner'
    )
    and project_private.project_beta_request_uid() is not null
    and project_private.project_beta_request_jwt() ->> 'sub'
      = project_private.project_beta_request_uid()::text
    and coalesce(
      project_private.project_beta_request_jwt() -> 'is_anonymous'
        = 'false'::jsonb,
      false
    )
$$;

revoke all on function project_private.has_registered_project_access()
  from public, anon, authenticated, service_role;
grant execute on function project_private.has_registered_project_access()
  to authenticated, project_beta_rpc_owner;

-- Registration, rather than rollout metadata, is now the only provisioning
-- boundary. Converting an anonymous account remains idempotent.
create or replace function project_private.provision_personal_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;

  insert into public.workspaces (owner_id)
  values (new.id)
  on conflict (owner_id) do nothing;

  return new;
end;
$$;

drop trigger if exists provision_personal_workspace_on_signup on auth.users;
drop trigger if exists provision_personal_workspace_on_registration on auth.users;

create trigger provision_personal_workspace_on_signup
  after insert on auth.users
  for each row execute function project_private.provision_personal_workspace();

create trigger provision_personal_workspace_on_registration
  after update of is_anonymous on auth.users
  for each row
  when (
    old.is_anonymous is distinct from new.is_anonymous
    and new.is_anonymous is false
  )
  execute function project_private.provision_personal_workspace();

insert into public.workspaces (owner_id)
select users.id
from auth.users as users
where not coalesce(users.is_anonymous, false)
on conflict (owner_id) do nothing;

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'workspaces',
    'projects',
    'project_source_sets',
    'project_videos',
    'project_source_set_events',
    'project_conversations',
    'project_conversation_messages',
    'project_artifact_generation_attempts',
    'project_artifacts',
    'project_analytics_state',
    'project_activation_outbox',
    'project_generation_usage',
    'project_message_analytics_ordinals',
    'project_answer_feedback'
  ]
  loop
    execute format(
      'drop policy if exists project_beta_authenticated_gate on public.%I',
      relation_name
    );
    execute format(
      'drop policy if exists project_beta_rpc_owner_access on public.%I',
      relation_name
    );
    execute format(
      'drop policy if exists project_registered_authenticated_gate on public.%I',
      relation_name
    );
    execute format(
      'create policy project_registered_authenticated_gate on public.%I as restrictive for all to authenticated using ((select project_private.has_registered_project_access())) with check ((select project_private.has_registered_project_access()))',
      relation_name
    );
    execute format(
      'drop policy if exists project_registered_rpc_owner_access on public.%I',
      relation_name
    );
    execute format(
      'create policy project_registered_rpc_owner_access on public.%I for all to project_beta_rpc_owner using ((select project_private.has_registered_project_access())) with check ((select project_private.has_registered_project_access()))',
      relation_name
    );
  end loop;
end;
$$;

drop policy if exists project_beta_rpc_owner_video_access on public.videos;
drop policy if exists project_beta_rpc_owner_transcript_read on public.video_transcripts;
drop policy if exists project_beta_rpc_owner_summary_read on public.summaries;
drop policy if exists project_beta_rpc_owner_history_read on public.user_video_history;
drop policy if exists project_beta_rpc_owner_subscription_read on public.user_subscriptions;

create policy project_registered_rpc_owner_video_access
  on public.videos for all to project_beta_rpc_owner
  using ((select project_private.has_registered_project_access()))
  with check ((select project_private.has_registered_project_access()));
create policy project_registered_rpc_owner_transcript_read
  on public.video_transcripts for select to project_beta_rpc_owner
  using ((select project_private.has_registered_project_access()));
create policy project_registered_rpc_owner_summary_read
  on public.summaries for select to project_beta_rpc_owner
  using ((select project_private.has_registered_project_access()));
create policy project_registered_rpc_owner_history_read
  on public.user_video_history for select to project_beta_rpc_owner
  using ((select project_private.has_registered_project_access()));
create policy project_registered_rpc_owner_subscription_read
  on public.user_subscriptions for select to project_beta_rpc_owner
  using ((select project_private.has_registered_project_access()));

create or replace function project_private.guard_registered_project_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) = 'authenticated'
    and not project_private.has_registered_project_access()
  then
    raise insufficient_privilege
      using message = 'Registered Project access is required';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function project_private.guard_registered_project_write()
  from public, anon, authenticated, service_role;

drop trigger if exists projects_00_beta_access_guard on public.projects;
drop trigger if exists projects_00_registered_access_guard on public.projects;
create trigger projects_00_registered_access_guard
before insert or update or delete on public.projects
for each row execute function project_private.guard_registered_project_write();

drop function if exists project_private.guard_project_beta_write();
drop function if exists project_private.has_trusted_project_beta_access();
drop function if exists project_private.project_beta_metadata_is_trusted(jsonb);

notify pgrst, 'reload schema';
