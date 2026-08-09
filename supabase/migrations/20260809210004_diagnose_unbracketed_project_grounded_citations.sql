-- Bound diagnostics for canonical-looking citation text outside brackets.

create function project_private.project_grounded_unbracketed_diagnostics_v2(
  p_text text,
  p_limit integer
)
returns jsonb
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  candidate_pattern text := '\m(S[0-9]{1,2}[[:space:]]*@[[:space:]]*'
    || '([0-9]{2}:)?[0-9]{2}:[0-9]{2}'
    || '([[:space:]]*[-' || chr(8211) || '][[:space:]]*'
    || '([0-9]{2}:)?[0-9]{2}:[0-9]{2})?)\M';
  candidate text;
  diagnostics jsonb := '[]'::jsonb;
begin
  if p_limit <= 0 or p_text = '' then return diagnostics; end if;
  for candidate in
    select matches.value[1]
    from pg_catalog.regexp_matches(p_text, candidate_pattern, 'gi')
      as matches(value)
  loop
    diagnostics := diagnostics || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'kind', 'malformed', 'raw', pg_catalog.left(candidate, 80)
      )
    );
    exit when pg_catalog.jsonb_array_length(diagnostics) >= p_limit;
  end loop;
  return diagnostics;
exception when others then return null;
end;
$$;

revoke all on function
  project_private.project_grounded_unbracketed_diagnostics_v2(text, integer)
  from public, anon, authenticated, service_role;
