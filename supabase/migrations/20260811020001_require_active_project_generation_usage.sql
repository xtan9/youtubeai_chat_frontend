-- Generation usage contributes to activated-Project unit economics only.
-- Serialize on the same private Project row as activation so an activation
-- transition and usage write cannot observe contradictory states.

create or replace function public.record_project_generation_usage(
  p_project_id uuid,
  p_owner_id uuid,
  p_operation_id uuid,
  p_generation_kind text,
  p_model_id text,
  p_provider_kind text,
  p_cost_status text,
  p_input_tokens bigint,
  p_cached_input_tokens bigint,
  p_output_tokens bigint,
  p_cost_usd_micros bigint,
  p_duration_ms integer,
  p_rate_card_version text,
  p_rate_card_source text,
  p_rate_card_effective_date date,
  p_error_class text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_owner uuid;
  project_activated_at timestamptz;
  inserted_id uuid;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'record_project_generation_usage requires service_role';
  end if;

  select workspaces.owner_id, analytics_state.activated_at
    into project_owner, project_activated_at
    from public.projects
    join public.workspaces on workspaces.id = projects.workspace_id
    left join public.project_analytics_state as analytics_state
      on analytics_state.project_id = projects.id
    where projects.id = p_project_id
    for update of projects;

  if project_owner is null or project_owner <> p_owner_id then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if project_activated_at is null then
    return jsonb_build_object('outcome', 'inactive');
  end if;

  insert into public.project_generation_usage (
    project_id, owner_id, operation_id, generation_kind, model_id,
    provider_kind, cost_status, input_tokens, cached_input_tokens,
    output_tokens, cost_usd_micros, duration_ms, rate_card_version,
    rate_card_source, rate_card_effective_date, error_class
  ) values (
    p_project_id, p_owner_id, p_operation_id, p_generation_kind, p_model_id,
    p_provider_kind, p_cost_status, p_input_tokens, p_cached_input_tokens,
    p_output_tokens, p_cost_usd_micros, p_duration_ms, p_rate_card_version,
    p_rate_card_source, p_rate_card_effective_date, p_error_class
  )
  on conflict (project_id, operation_id, generation_kind) do nothing
  returning id into inserted_id;

  return jsonb_build_object(
    'outcome', case when inserted_id is null then 'deduplicated' else 'inserted' end
  );
end;
$$;

revoke execute on function public.record_project_generation_usage(
  uuid, uuid, uuid, text, text, text, text, bigint, bigint, bigint, bigint,
  integer, text, text, date, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_project_generation_usage(
  uuid, uuid, uuid, text, text, text, text, bigint, bigint, bigint, bigint,
  integer, text, text, date, text
) to service_role;
