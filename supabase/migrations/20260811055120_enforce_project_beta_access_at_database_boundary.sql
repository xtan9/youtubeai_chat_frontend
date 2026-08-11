-- Enforce the controlled Project beta at the database boundary. Browser JWTs
-- may authorize only through service-managed app_metadata. User metadata is
-- intentionally ignored.

create or replace function project_private.project_beta_metadata_is_trusted(
  p_app_metadata jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    coalesce(p_app_metadata ->> 'project_beta_access', '') in (
      'internal',
      'invited'
    )
    or coalesce(
      p_app_metadata -> 'is_smoke_account' = 'true'::jsonb,
      false
    )
$$;

create or replace function project_private.has_trusted_project_beta_access()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    current_setting('role', true) in (
      'authenticated',
      'project_beta_rpc_owner'
    )
    and auth.uid() is not null
    and auth.jwt() ->> 'sub' = auth.uid()::text
    and project_private.project_beta_metadata_is_trusted(
      coalesce(auth.jwt() -> 'app_metadata', '{}'::jsonb)
    )
$$;

revoke all on function project_private.project_beta_metadata_is_trusted(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function project_private.has_trusted_project_beta_access()
  from public, anon, authenticated, service_role;
grant usage on schema project_private to authenticated;
grant execute on function project_private.project_beta_metadata_is_trusted(jsonb)
  to authenticated;
grant execute on function project_private.has_trusted_project_beta_access()
  to authenticated;

-- New registered users receive a Workspace only after a trusted invitation.
-- Updating raw_app_meta_data later provisions the same durable Workspace
-- idempotently. Existing Workspace rows are retained and merely hidden.
create or replace function project_private.provision_personal_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.is_anonymous, false)
    or not project_private.project_beta_metadata_is_trusted(
      coalesce(new.raw_app_meta_data, '{}'::jsonb)
    )
  then
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
  after update of is_anonymous, raw_app_meta_data on auth.users
  for each row
  when (
    new.is_anonymous is false
    and (
      old.is_anonymous is distinct from new.is_anonymous
      or old.raw_app_meta_data is distinct from new.raw_app_meta_data
    )
  )
  execute function project_private.provision_personal_workspace();

insert into public.workspaces (owner_id)
select users.id
from auth.users as users
where not coalesce(users.is_anonymous, false)
  and project_private.project_beta_metadata_is_trusted(
    coalesce(users.raw_app_meta_data, '{}'::jsonb)
  )
on conflict (owner_id) do nothing;

-- A dedicated NOLOGIN owner lets authenticated Project RPCs retain their deep
-- interfaces while honoring RLS. It has no membership path from browser roles.
do $$
begin
  if not exists (
    select 1 from pg_roles where rolname = 'project_beta_rpc_owner'
  ) then
    create role project_beta_rpc_owner nologin inherit;
  end if;
end;
$$;

revoke authenticated from project_beta_rpc_owner;
grant usage on schema auth, public, project_private
  to project_beta_rpc_owner;
grant execute on function auth.uid(), auth.jwt()
  to project_beta_rpc_owner;
grant execute on all functions in schema project_private
  to project_beta_rpc_owner;
grant execute on function public.load_project_conversation_legacy(uuid, uuid)
  to project_beta_rpc_owner;
grant execute on function public.start_project_grounded_question_v2_before_analytics(
  uuid, uuid, text, uuid, text
) to project_beta_rpc_owner;
grant execute on function public.load_project_conversation_page_v2_before_analytics(
  uuid, uuid, timestamp with time zone, uuid, integer
) to project_beta_rpc_owner;
grant execute on function public.load_project_grounded_attempt_v2_before_analytics(
  uuid, uuid, uuid
) to project_beta_rpc_owner;

grant select, insert, update, delete on table
  public.workspaces,
  public.projects,
  public.project_source_sets,
  public.project_videos,
  public.project_source_set_events,
  public.project_conversations,
  public.project_conversation_messages,
  public.project_artifact_generation_attempts,
  public.project_artifacts,
  public.project_analytics_state,
  public.project_activation_outbox,
  public.project_generation_usage,
  public.project_message_analytics_ordinals,
  public.project_answer_feedback
to project_beta_rpc_owner;

grant select on table
  public.user_subscriptions,
  public.user_video_history,
  public.video_transcripts,
  public.summaries
to project_beta_rpc_owner;

grant select, insert, update on table public.videos
to project_beta_rpc_owner;

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
      'create policy project_beta_authenticated_gate on public.%I as restrictive for all to authenticated using ((select project_private.has_trusted_project_beta_access())) with check ((select project_private.has_trusted_project_beta_access()))',
      relation_name
    );
    execute format(
      'drop policy if exists project_beta_rpc_owner_access on public.%I',
      relation_name
    );
    execute format(
      'create policy project_beta_rpc_owner_access on public.%I for all to project_beta_rpc_owner using ((select project_private.has_trusted_project_beta_access())) with check ((select project_private.has_trusted_project_beta_access()))',
      relation_name
    );
  end loop;
end;
$$;

-- Evidence and entitlement tables remain private. The NOLOGIN RPC owner gets
-- only the reads required by existing Project functions, gated by the same JWT.
create policy project_beta_rpc_owner_video_access
  on public.videos for all to project_beta_rpc_owner
  using ((select project_private.has_trusted_project_beta_access()))
  with check ((select project_private.has_trusted_project_beta_access()));
create policy project_beta_rpc_owner_transcript_read
  on public.video_transcripts for select to project_beta_rpc_owner
  using ((select project_private.has_trusted_project_beta_access()));
create policy project_beta_rpc_owner_summary_read
  on public.summaries for select to project_beta_rpc_owner
  using ((select project_private.has_trusted_project_beta_access()));
create policy project_beta_rpc_owner_history_read
  on public.user_video_history for select to project_beta_rpc_owner
  using ((select project_private.has_trusted_project_beta_access()));
create policy project_beta_rpc_owner_subscription_read
  on public.user_subscriptions for select to project_beta_rpc_owner
  using ((select project_private.has_trusted_project_beta_access()));

-- Run before the existing plan-limit trigger so an uninvited direct INSERT
-- never learns quota or Workspace state.
create or replace function project_private.guard_project_beta_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) = 'authenticated'
    and not project_private.has_trusted_project_beta_access()
  then
    raise insufficient_privilege
      using message = 'Project beta access is not allowed';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function project_private.guard_project_beta_write()
  from public, anon, authenticated, service_role;

drop trigger if exists projects_00_beta_access_guard on public.projects;
create trigger projects_00_beta_access_guard
before insert or update or delete on public.projects
for each row execute function project_private.guard_project_beta_write();

do $$
declare
  function_signature text;
begin
  foreach function_signature in array array[
    'public.add_project_history_video(uuid,uuid,bigint)',
    'public.cancel_project_grounded_question(uuid,uuid)',
    'public.clear_project_conversation(uuid,uuid)',
    'public.create_project_conversation(uuid,text)',
    'public.list_project_conversations(uuid)',
    'public.list_project_history_candidates(uuid,text,integer,integer)',
    'public.load_default_project_conversation(uuid)',
    'public.load_project_artifact(uuid,text)',
    'public.load_project_conversation_page_v2(uuid,uuid,timestamp with time zone,uuid,integer)',
    'public.load_project_conversation(uuid,uuid)',
    'public.load_project_grounded_attempt_v2(uuid,uuid,uuid)',
    'public.load_project_source_set_event_page_v2(uuid,timestamp with time zone,uuid,integer)',
    'public.load_project_source_set(uuid)',
    'public.record_project_answer_feedback(uuid,uuid,text)',
    'public.remove_project_video(uuid,uuid,bigint)',
    'public.rename_project_conversation(uuid,uuid,text)',
    'public.reorder_project_videos(uuid,uuid[],bigint)',
    'public.reserve_project_artifact_generation(uuid,text,uuid)',
    'public.search_project_transcript_passages_balanced(uuid,text,integer)',
    'public.search_project_transcript_passages(uuid,text,integer)',
    'public.start_project_grounded_question(uuid,text)',
    'public.start_project_grounded_question(uuid,text,uuid)',
    'public.start_project_grounded_question(uuid,text,uuid,text)',
    'public.start_project_grounded_question_v2(uuid,uuid,text,uuid,text)',
    'public.start_project_video_processing(uuid,text,bigint)'
  ]
  loop
    execute format(
      'alter function %s owner to project_beta_rpc_owner',
      function_signature
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
