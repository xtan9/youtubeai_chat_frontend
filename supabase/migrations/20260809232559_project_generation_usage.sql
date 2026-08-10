-- Durable, content-free Project generation usage and service-only accounting RPC.

create table public.project_generation_usage (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null,
  operation_id uuid not null,
  generation_kind text not null,
  model_id text not null,
  provider_kind text not null,
  cost_status text not null,
  input_tokens bigint,
  cached_input_tokens bigint,
  output_tokens bigint,
  cost_usd_micros bigint,
  duration_ms integer not null,
  rate_card_version text,
  rate_card_source text,
  rate_card_effective_date date,
  error_class text,
  recorded_at timestamptz not null default now(),
  constraint project_generation_usage_operation_key
    unique (project_id, operation_id, generation_kind),
  constraint project_generation_usage_kind_valid check (
    generation_kind in ('grounded_answer', 'study_guide', 'creator_brief')
  ),
  constraint project_generation_usage_model_valid check (
    model_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  constraint project_generation_usage_provider_valid check (
    provider_kind = 'cliproxyapi'
  ),
  constraint project_generation_usage_cost_status_valid check (
    cost_status in ('measured', 'unavailable')
  ),
  constraint project_generation_usage_tokens_valid check (
    (input_tokens is null or input_tokens between 0 and 1000000)
    and (cached_input_tokens is null or cached_input_tokens between 0 and 1000000)
    and (output_tokens is null or output_tokens between 0 and 1000000)
    and (
      input_tokens is null
      or cached_input_tokens is null
      or cached_input_tokens <= input_tokens
    )
  ),
  constraint project_generation_usage_duration_valid check (
    duration_ms between 0 and 86400000
  ),
  constraint project_generation_usage_cost_valid check (
    cost_usd_micros is null or cost_usd_micros >= 0
  ),
  constraint project_generation_usage_error_valid check (
    error_class is null
    or error_class in ('usage_unavailable', 'rate_card_unavailable')
  ),
  constraint project_generation_usage_rate_card_source_valid check (
    rate_card_source is null
    or rate_card_source = 'provider_contract'
  ),
  constraint project_generation_usage_measurement_coherent check (
    (
      cost_status = 'measured'
      and input_tokens is not null
      and cached_input_tokens is not null
      and output_tokens is not null
      and cost_usd_micros is not null
      and rate_card_version is not null
      and rate_card_source is not null
      and rate_card_effective_date is not null
      and error_class is null
    )
    or (
      cost_status = 'unavailable'
      and cost_usd_micros is null
      and rate_card_version is null
      and rate_card_source is null
      and rate_card_effective_date is null
      and (
        (
          error_class = 'usage_unavailable'
          and input_tokens is null
          and cached_input_tokens is null
          and output_tokens is null
        )
        or (
          error_class = 'rate_card_unavailable'
          and input_tokens is not null
          and cached_input_tokens is not null
          and output_tokens is not null
        )
      )
    )
  )
);

alter table public.project_generation_usage enable row level security;
revoke all on table public.project_generation_usage
  from public, anon, authenticated, service_role;

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
  inserted_id uuid;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'record_project_generation_usage requires service_role';
  end if;

  select workspaces.owner_id
    into project_owner
    from public.projects
    join public.workspaces on workspaces.id = projects.workspace_id
    where projects.id = p_project_id;
  if project_owner is null or project_owner <> p_owner_id then
    return jsonb_build_object('outcome', 'missing');
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
