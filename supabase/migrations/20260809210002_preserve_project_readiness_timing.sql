-- Preserve finite negative Transcript timing so #317 readiness can distinguish
-- durable/searchable evidence from passage usability. Every passage consumer
-- still applies explicit nonnegative start and duration predicates.

create or replace function project_private.safe_transcript_seconds(
  p_value jsonb
)
returns double precision
language plpgsql
immutable
strict
set search_path = ''
as $$
declare numeric_value numeric;
begin
  if pg_catalog.jsonb_typeof(p_value) operator(pg_catalog.<>) 'number' then
    return null;
  end if;
  begin
    numeric_value := p_value::text::numeric;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return null;
  end;
  if numeric_value operator(pg_catalog.<) -1000000000
    or numeric_value operator(pg_catalog.>) 1000000000
  then return null; end if;
  return numeric_value::double precision;
end;
$$;

revoke all on function project_private.safe_transcript_seconds(jsonb)
  from public, anon, authenticated, service_role;
