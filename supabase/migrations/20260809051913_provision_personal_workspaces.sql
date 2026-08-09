-- Provision personal Workspaces from the server-controlled auth identity.

create schema project_private;

create function project_private.provision_personal_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;

  insert into public.workspaces (owner_id)
  values (new.id)
  on conflict (owner_id) do nothing;

  return new;
end;
$$;

revoke all on function project_private.provision_personal_workspace() from public;
revoke all on function project_private.provision_personal_workspace()
  from anon, authenticated;

create trigger provision_personal_workspace_on_signup
  after insert on auth.users
  for each row execute function project_private.provision_personal_workspace();

create trigger provision_personal_workspace_on_registration
  after update of is_anonymous on auth.users
  for each row
  when (old.is_anonymous is true and new.is_anonymous is false)
  execute function project_private.provision_personal_workspace();

-- Provision Researchers who registered before this migration. Anonymous
-- Supabase users intentionally remain outside the persistent Project model.
insert into public.workspaces (owner_id)
select id
from auth.users
where not coalesce(is_anonymous, false);
