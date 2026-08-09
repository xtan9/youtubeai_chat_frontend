-- Issue #323: durable Project Artifacts and the first complete Artifact type,
-- Study Guide. Content/provenance rows are immutable; a separate Workspace
-- generation ledger keeps the Free allowance durable across Artifact or
-- Project deletion and serializes concurrent reservations across all kinds.

create table public.project_artifact_generation_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces(id) on delete cascade,
  project_id uuid
    references public.projects(id) on delete set null,
  artifact_kind text not null,
  attempt_token uuid not null,
  attempt_state text not null default 'reserved',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  constraint project_artifact_generation_attempts_kind_check
    check (artifact_kind in ('study_guide', 'creator_brief', 'project_brief')),
  constraint project_artifact_generation_attempts_state_check
    check (attempt_state in ('reserved', 'completed', 'failed')),
  constraint project_artifact_generation_attempts_terminal_time_check
    check (
      (attempt_state = 'reserved'
        and completed_at is null
        and failed_at is null)
      or (attempt_state = 'completed'
        and completed_at is not null
        and failed_at is null)
      or (attempt_state = 'failed'
        and completed_at is null
        and failed_at is not null)
    ),
  constraint project_artifact_generation_attempts_workspace_token_key
    unique (workspace_id, attempt_token)
);

create index project_artifact_generation_attempts_workspace_state_idx
  on public.project_artifact_generation_attempts (
    workspace_id,
    attempt_state,
    created_at
  );
create index project_artifact_generation_attempts_project_id_idx
  on public.project_artifact_generation_attempts (project_id);

alter table public.project_artifact_generation_attempts enable row level security;
revoke all on table public.project_artifact_generation_attempts
  from public, anon, authenticated, service_role;

create table public.project_artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null
    references public.projects(id) on delete cascade,
  generation_attempt_id uuid not null
    references public.project_artifact_generation_attempts(id) on delete cascade,
  artifact_kind text not null,
  content text not null,
  source_set_revision bigint not null,
  source_manifest jsonb not null,
  source_coverage jsonb not null,
  evidence_snapshot jsonb not null,
  citation_diagnostics jsonb not null default '[]'::jsonb,
  generation_metadata jsonb not null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  constraint project_artifacts_generation_attempt_key
    unique (generation_attempt_id),
  constraint project_artifacts_kind_check
    check (artifact_kind in ('study_guide', 'creator_brief', 'project_brief')),
  constraint project_artifacts_content_length_check
    check (char_length(content) between 1 and 100000),
  constraint project_artifacts_source_set_revision_check
    check (source_set_revision >= 0),
  constraint project_artifacts_json_shape_check
    check (
      jsonb_typeof(source_manifest) = 'object'
      and jsonb_typeof(source_coverage) = 'object'
      and jsonb_typeof(evidence_snapshot) = 'object'
      and jsonb_typeof(citation_diagnostics) = 'array'
      and jsonb_typeof(generation_metadata) = 'object'
    )
);

create unique index project_artifacts_one_current_kind_idx
  on public.project_artifacts (project_id, artifact_kind)
  where superseded_at is null;
create index project_artifacts_project_history_idx
  on public.project_artifacts (
    project_id,
    artifact_kind,
    created_at desc,
    id desc
  );

alter table public.project_artifacts enable row level security;

create policy project_artifacts_owner_select
on public.project_artifacts
for select
to authenticated
using (
  exists (
    select 1
    from public.projects
    join public.workspaces
      on workspaces.id = projects.workspace_id
    where projects.id = project_artifacts.project_id
      and workspaces.owner_id = (select auth.uid())
  )
);

revoke all on table public.project_artifacts
  from public, anon, authenticated, service_role;
grant select on table public.project_artifacts to authenticated;

create function project_private.project_artifact_to_json(
  p_artifact public.project_artifacts
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'artifactId', p_artifact.id,
    'projectId', p_artifact.project_id,
    'kind', p_artifact.artifact_kind,
    'content', p_artifact.content,
    'sourceSetRevision', p_artifact.source_set_revision,
    'sourceManifest', p_artifact.source_manifest,
    'sourceCoverage', p_artifact.source_coverage,
    'evidenceSnapshot', p_artifact.evidence_snapshot,
    'citationDiagnostics', p_artifact.citation_diagnostics,
    'generationMetadata', p_artifact.generation_metadata,
    'createdAt', to_char(
      p_artifact.created_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'supersededAt', case
      when p_artifact.superseded_at is null then null
      else to_char(
        p_artifact.superseded_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    end
  );
$$;

revoke all on function project_private.project_artifact_to_json(
  public.project_artifacts
) from public, anon, authenticated, service_role;

create function public.load_project_artifact(
  p_project_id uuid,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  researcher_id uuid := auth.uid();
  request_role text := current_setting('role', true);
  request_jwt jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_workspace_id uuid;
  current_source_set_revision bigint := 0;
  current_artifact jsonb;
  history jsonb;
  completed_count integer := 0;
  owner_tier text;
  smoke_pro_entitled boolean := false;
  unlimited boolean := false;
begin
  if request_role <> 'authenticated'
    or researcher_id is null
    or p_kind not in ('study_guide', 'creator_brief', 'project_brief')
  then
    return jsonb_build_object('outcome', 'missing');
  end if;

  select workspaces.id
  into v_workspace_id
  from public.projects
  join public.workspaces
    on workspaces.id = projects.workspace_id
  where projects.id = p_project_id
    and workspaces.owner_id = researcher_id;

  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;

  select revision
  into current_source_set_revision
  from public.project_source_sets
  where project_id = p_project_id;
  if not found then
    current_source_set_revision := 0;
  end if;

  smoke_pro_entitled :=
    request_jwt ->> 'sub' = researcher_id::text
    and request_jwt @> '{
      "app_metadata": {
        "is_smoke_account": true,
        "smoke_entitlement": "pro"
      }
    }'::jsonb;
  select tier into owner_tier
  from public.user_subscriptions
  where user_id = researcher_id;
  unlimited := smoke_pro_entitled or coalesce(owner_tier, 'free') = 'pro';

  select count(*)::integer
  into completed_count
  from public.project_artifact_generation_attempts
  where workspace_id = v_workspace_id
    and attempt_state = 'completed';

  select project_private.project_artifact_to_json(artifacts)
  into current_artifact
  from public.project_artifacts as artifacts
  where artifacts.project_id = p_project_id
    and artifacts.artifact_kind = p_kind
    and artifacts.superseded_at is null;

  select coalesce(
    jsonb_agg(
      project_private.project_artifact_to_json(history_rows)
      order by history_rows.created_at desc, history_rows.id desc
    ),
    '[]'::jsonb
  )
  into history
  from (
    select artifacts.*
    from public.project_artifacts as artifacts
    where artifacts.project_id = p_project_id
      and artifacts.artifact_kind = p_kind
      and artifacts.superseded_at is not null
    order by artifacts.created_at desc, artifacts.id desc
    limit 100
  ) as history_rows;

  return jsonb_build_object(
    'outcome', 'ready',
    'currentSourceSetRevision', current_source_set_revision,
    'current', current_artifact,
    'history', history,
    'tier', case when unlimited then 'pro' else 'free' end,
    'generationsUsed', completed_count,
    'generationsLimit', case when unlimited then null else 1 end
  );
end;
$$;

revoke all on function public.load_project_artifact(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.load_project_artifact(uuid, text)
  to authenticated;

create function public.reserve_project_artifact_generation(
  p_project_id uuid,
  p_kind text,
  p_attempt_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  researcher_id uuid := auth.uid();
  request_role text := current_setting('role', true);
  request_jwt jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_workspace_id uuid;
  existing_attempt public.project_artifact_generation_attempts%rowtype;
  v_attempt_id uuid;
  completed_count integer := 0;
  reserved_count integer := 0;
  owner_tier text;
  smoke_pro_entitled boolean := false;
  unlimited boolean := false;
begin
  if request_role <> 'authenticated' or researcher_id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if p_attempt_token is null
    or p_kind not in ('study_guide', 'creator_brief', 'project_brief')
  then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select workspaces.id
  into v_workspace_id
  from public.projects
  join public.workspaces
    on workspaces.id = projects.workspace_id
  where projects.id = p_project_id
    and workspaces.owner_id = researcher_id;

  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('project-artifact-generation:' || v_workspace_id::text, 0)
  );

  -- The HTTP route has a 120-second ceiling. A reservation older than ten
  -- minutes cannot still own live provider work and must not strand Free use.
  update public.project_artifact_generation_attempts
  set attempt_state = 'failed', failed_at = now()
  where workspace_id = v_workspace_id
    and attempt_state = 'reserved'
    and created_at < now() - interval '10 minutes';

  smoke_pro_entitled :=
    request_jwt ->> 'sub' = researcher_id::text
    and request_jwt @> '{
      "app_metadata": {
        "is_smoke_account": true,
        "smoke_entitlement": "pro"
      }
    }'::jsonb;
  select tier into owner_tier
  from public.user_subscriptions
  where user_id = researcher_id;
  unlimited := smoke_pro_entitled or coalesce(owner_tier, 'free') = 'pro';

  select count(*)::integer
  into completed_count
  from public.project_artifact_generation_attempts
  where workspace_id = v_workspace_id
    and attempt_state = 'completed';
  select count(*)::integer
  into reserved_count
  from public.project_artifact_generation_attempts
  where workspace_id = v_workspace_id
    and attempt_state = 'reserved';

  select *
  into existing_attempt
  from public.project_artifact_generation_attempts
  where workspace_id = v_workspace_id
    and attempt_token = p_attempt_token
  for update;

  if found then
    if existing_attempt.project_id is distinct from p_project_id
      or existing_attempt.artifact_kind <> p_kind
    then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    if existing_attempt.attempt_state = 'reserved' then
      return jsonb_build_object(
        'outcome', 'started',
        'attemptId', existing_attempt.id,
        'attemptToken', existing_attempt.attempt_token,
        'kind', existing_attempt.artifact_kind,
        'tier', case when unlimited then 'pro' else 'free' end,
        'generationsUsed', completed_count,
        'generationsLimit', case when unlimited then null else 1 end
      );
    end if;
    if existing_attempt.attempt_state = 'completed' then
      return case
        when unlimited then jsonb_build_object('outcome', 'invalid')
        else jsonb_build_object(
          'outcome', 'limit_reached',
          'tier', 'free',
          'generationsUsed', greatest(completed_count, 1),
          'generationsLimit', 1
        )
      end;
    end if;
  end if;

  if not unlimited and completed_count + reserved_count >= 1 then
    return jsonb_build_object(
      'outcome', 'limit_reached',
      'tier', 'free',
      'generationsUsed', greatest(completed_count + reserved_count, 1),
      'generationsLimit', 1
    );
  end if;

  if existing_attempt.id is not null then
    update public.project_artifact_generation_attempts
    set project_id = p_project_id,
        artifact_kind = p_kind,
        attempt_state = 'reserved',
        created_at = now(),
        completed_at = null,
        failed_at = null
    where id = existing_attempt.id
    returning id into v_attempt_id;
  else
    insert into public.project_artifact_generation_attempts (
      workspace_id,
      project_id,
      artifact_kind,
      attempt_token
    ) values (
      v_workspace_id,
      p_project_id,
      p_kind,
      p_attempt_token
    )
    returning id into v_attempt_id;
  end if;

  update public.projects
  set last_active_at = now()
  where id = p_project_id;

  return jsonb_build_object(
    'outcome', 'started',
    'attemptId', v_attempt_id,
    'attemptToken', p_attempt_token,
    'kind', p_kind,
    'tier', case when unlimited then 'pro' else 'free' end,
    'generationsUsed', completed_count,
    'generationsLimit', case when unlimited then null else 1 end
  );
end;
$$;

revoke all on function public.reserve_project_artifact_generation(
  uuid, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.reserve_project_artifact_generation(
  uuid, text, uuid
) to authenticated;

create function public.complete_project_artifact_generation(
  p_owner_id uuid,
  p_project_id uuid,
  p_attempt_id uuid,
  p_attempt_token uuid,
  p_kind text,
  p_content text,
  p_source_set_revision bigint,
  p_source_manifest jsonb,
  p_source_coverage jsonb,
  p_evidence_snapshot jsonb,
  p_citation_diagnostics jsonb,
  p_generation_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_role text := current_setting('role', true);
  v_workspace_id uuid;
  attempt_state text;
  current_source_set_revision bigint := 0;
  v_artifact_id uuid;
  artifact_json jsonb;
begin
  if request_role <> 'service_role' then
    return jsonb_build_object('outcome', 'missing');
  end if;

  select projects.workspace_id
  into v_workspace_id
  from public.projects
  join public.workspaces
    on workspaces.id = projects.workspace_id
  where projects.id = p_project_id
    and workspaces.owner_id = p_owner_id
  for update of projects;

  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;

  select attempts.attempt_state
  into attempt_state
  from public.project_artifact_generation_attempts as attempts
  where attempts.id = p_attempt_id
    and attempts.workspace_id = v_workspace_id
    and attempts.project_id = p_project_id
    and attempts.artifact_kind = p_kind
    and attempts.attempt_token = p_attempt_token
  for update of attempts;

  if attempt_state is null then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if attempt_state = 'completed' then
    select project_private.project_artifact_to_json(artifacts)
    into artifact_json
    from public.project_artifacts as artifacts
    where artifacts.generation_attempt_id = p_attempt_id;
    if artifact_json is null then
      return jsonb_build_object('outcome', 'missing');
    end if;
    return jsonb_build_object('outcome', 'completed', 'artifact', artifact_json);
  end if;
  if attempt_state = 'failed' then
    return jsonb_build_object('outcome', 'conflict');
  end if;

  select revision
  into current_source_set_revision
  from public.project_source_sets
  where project_id = p_project_id
  for share;
  if not found then
    current_source_set_revision := 0;
  end if;

  if current_source_set_revision <> p_source_set_revision then
    return jsonb_build_object('outcome', 'conflict');
  end if;

  if p_kind not in ('study_guide', 'creator_brief', 'project_brief')
    or char_length(coalesce(p_content, '')) not between 1 and 100000
    or jsonb_typeof(p_generation_metadata) <> 'object'
    or p_generation_metadata - 'model' - 'promptVersion' - 'generatedAt'
      <> '{}'::jsonb
    or jsonb_typeof(p_generation_metadata -> 'model') <> 'string'
    or jsonb_typeof(p_generation_metadata -> 'promptVersion') <> 'string'
    or jsonb_typeof(p_generation_metadata -> 'generatedAt') <> 'string'
    or char_length(coalesce(p_generation_metadata ->> 'model', ''))
      not between 1 and 120
    or char_length(coalesce(p_generation_metadata ->> 'promptVersion', ''))
      not between 1 and 80
    or char_length(coalesce(p_generation_metadata ->> 'generatedAt', ''))
      not between 20 and 40
    or not project_private.project_grounded_artifact_is_coherent(
      p_project_id,
      p_source_set_revision,
      'supported',
      p_source_manifest,
      p_source_coverage,
      p_evidence_snapshot,
      p_citation_diagnostics
    )
  then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  update public.project_artifacts
  set superseded_at = now()
  where project_id = p_project_id
    and artifact_kind = p_kind
    and superseded_at is null;

  insert into public.project_artifacts (
    project_id,
    generation_attempt_id,
    artifact_kind,
    content,
    source_set_revision,
    source_manifest,
    source_coverage,
    evidence_snapshot,
    citation_diagnostics,
    generation_metadata
  ) values (
    p_project_id,
    p_attempt_id,
    p_kind,
    p_content,
    p_source_set_revision,
    p_source_manifest,
    p_source_coverage,
    p_evidence_snapshot,
    p_citation_diagnostics,
    p_generation_metadata
  )
  returning id into v_artifact_id;

  update public.project_artifact_generation_attempts as attempts
  set attempt_state = 'completed', completed_at = now()
  where attempts.id = p_attempt_id
    and attempts.attempt_state = 'reserved';

  update public.projects
  set last_active_at = now()
  where id = p_project_id;

  select project_private.project_artifact_to_json(artifacts)
  into artifact_json
  from public.project_artifacts as artifacts
  where artifacts.id = v_artifact_id;

  return jsonb_build_object(
    'outcome', 'completed',
    'artifact', artifact_json
  );
end;
$$;

revoke all on function public.complete_project_artifact_generation(
  uuid, uuid, uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.complete_project_artifact_generation(
  uuid, uuid, uuid, uuid, text, text, bigint, jsonb, jsonb, jsonb, jsonb, jsonb
) to service_role;

create function public.fail_project_artifact_generation(
  p_owner_id uuid,
  p_project_id uuid,
  p_attempt_id uuid,
  p_attempt_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_role text := current_setting('role', true);
  v_workspace_id uuid;
  updated_count integer := 0;
begin
  if request_role <> 'service_role' then
    return jsonb_build_object('outcome', 'missing');
  end if;

  select projects.workspace_id
  into v_workspace_id
  from public.projects
  join public.workspaces
    on workspaces.id = projects.workspace_id
  where projects.id = p_project_id
    and workspaces.owner_id = p_owner_id;

  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;

  update public.project_artifact_generation_attempts
  set attempt_state = 'failed', failed_at = now()
  where id = p_attempt_id
    and workspace_id = v_workspace_id
    and project_id = p_project_id
    and attempt_token = p_attempt_token
    and attempt_state = 'reserved';
  get diagnostics updated_count = row_count;

  if updated_count = 1 or exists (
    select 1
    from public.project_artifact_generation_attempts
    where id = p_attempt_id
      and workspace_id = v_workspace_id
      and project_id = p_project_id
      and attempt_token = p_attempt_token
      and attempt_state = 'failed'
  ) then
    return jsonb_build_object('outcome', 'failed');
  end if;
  return jsonb_build_object('outcome', 'missing');
end;
$$;

revoke all on function public.fail_project_artifact_generation(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.fail_project_artifact_generation(
  uuid, uuid, uuid, uuid
) to service_role;

notify pgrst, 'reload schema';
