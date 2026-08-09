-- Parse one canonical citation timestamp without exposing a Data API seam.

create function project_private.project_grounded_timestamp_seconds_v2(
  p_timestamp text
)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[];
  hours bigint := 0;
  minutes bigint;
  seconds bigint;
begin
  if p_timestamp is null
    or p_timestamp !~ '^([0-9]{2}:)?[0-9]{2}:[0-9]{2}$'
  then return null; end if;
  parts := pg_catalog.string_to_array(p_timestamp, ':');
  if pg_catalog.cardinality(parts) = 2 then
    minutes := parts[1]::bigint;
    seconds := parts[2]::bigint;
  elsif pg_catalog.cardinality(parts) = 3 then
    hours := parts[1]::bigint;
    minutes := parts[2]::bigint;
    seconds := parts[3]::bigint;
  else return null;
  end if;
  if seconds < 0 or seconds >= 60 or minutes < 0
    or (pg_catalog.cardinality(parts) = 3 and minutes >= 60)
  then return null; end if;
  return hours * 3600 + minutes * 60 + seconds;
exception when others then return null;
end;
$$;

revoke all on function
  project_private.project_grounded_timestamp_seconds_v2(text)
  from public, anon, authenticated, service_role;
