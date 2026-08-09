-- Metadata changes count as Project activity and refresh both timestamps.

create function project_private.set_project_metadata_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  new.last_active_at = now();
  return new;
end;
$$;

revoke all on function project_private.set_project_metadata_timestamps() from public;
revoke all on function project_private.set_project_metadata_timestamps()
  from anon, authenticated;

create trigger set_project_metadata_timestamps
  before update of name, goal on public.projects
  for each row execute function project_private.set_project_metadata_timestamps();
