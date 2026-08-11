create or replace function public.complete_project_artifact_generation(
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
    or p_generation_metadata
      - 'model' - 'promptVersion' - 'generatedAt' - 'normalizationAudit'
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
    or (
      p_kind = 'project_brief'
      and (
        coalesce(jsonb_typeof(p_generation_metadata -> 'normalizationAudit'), 'null')
          <> 'object'
        or p_generation_metadata -> 'normalizationAudit' - 'version' - 'recordSetHash'
          <> '{}'::jsonb
        or jsonb_typeof(p_generation_metadata #> '{normalizationAudit,version}')
          <> 'string'
        or jsonb_typeof(p_generation_metadata #> '{normalizationAudit,recordSetHash}')
          <> 'string'
        or char_length(coalesce(
          p_generation_metadata #>> '{normalizationAudit,version}',
          ''
        )) not between 1 and 80
        or coalesce(
          p_generation_metadata #>> '{normalizationAudit,recordSetHash}',
          ''
        ) !~ '^[a-f0-9]{64}$'
      )
    )
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
