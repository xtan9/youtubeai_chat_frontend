-- Expand-only read compatibility for durable rows written by the deployed v1
-- app. Stored JSON is not backfilled or tightened during this DB-first rollout.

create function project_private.project_grounded_normalize_coverage_v2(
  p_source_coverage jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_source_coverage) is distinct from 'object'
      then p_source_coverage
    when p_source_coverage ? 'usedVideos'
      and p_source_coverage ? 'passagesUsed'
      then p_source_coverage
    when p_source_coverage ? 'evidenceVideos'
      and p_source_coverage ? 'evidencePassages'
      then (p_source_coverage - 'evidenceVideos' - 'evidencePassages')
        || pg_catalog.jsonb_build_object(
          'usedVideos', p_source_coverage -> 'evidenceVideos',
          'passagesUsed', p_source_coverage -> 'evidencePassages'
        )
    else p_source_coverage
  end;
$$;

revoke all on function
  project_private.project_grounded_normalize_coverage_v2(jsonb)
  from public, anon, authenticated, service_role;
