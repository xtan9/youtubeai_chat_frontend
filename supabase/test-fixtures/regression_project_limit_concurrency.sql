-- Exercise two real PostgreSQL sessions against one Free Workspace. The first
-- insert holds its transaction open; the second must wait for the same
-- workspace-scoped advisory lock and then observe the committed Project.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

insert into auth.users (id, is_anonymous)
values ('60000000-0000-4000-8000-000000000006', false);

select dblink_connect(
  'project_limit_a',
  format('dbname=%L', current_database())
);
select dblink_connect(
  'project_limit_b',
  format('dbname=%L', current_database())
);

select dblink_exec('project_limit_a', 'begin');
select dblink_exec('project_limit_a', 'set local role authenticated');
select dblink_exec(
  'project_limit_a',
  'set local request.jwt.claim.sub = ''60000000-0000-4000-8000-000000000006'''
);
select dblink_exec(
  'project_limit_a',
  $$
    insert into public.projects (workspace_id, name)
    select id, 'Concurrent Project A'
    from public.workspaces
    where owner_id = '60000000-0000-4000-8000-000000000006'
  $$
);

select dblink_exec('project_limit_b', 'set role authenticated');
select dblink_exec(
  'project_limit_b',
  'set request.jwt.claim.sub = ''60000000-0000-4000-8000-000000000006'''
);
select dblink_send_query(
  'project_limit_b',
  $$
    insert into public.projects (workspace_id, name)
    select id, 'Concurrent Project B'
    from public.workspaces
    where owner_id = '60000000-0000-4000-8000-000000000006'
  $$
);

do $$
begin
  if dblink_is_busy('project_limit_b') <> 1 then
    raise exception 'REGRESSION: concurrent Free insert did not wait for the Workspace lock';
  end if;
end;
$$;

select dblink_exec('project_limit_a', 'commit');

do $$
declare
  limit_rejected boolean := false;
begin
  begin
    perform *
    from dblink_get_result('project_limit_b') as result(status text);
  exception
    when others then
      if position('FREE_PROJECT_LIMIT_REACHED' in sqlerrm) = 0 then
        raise;
      end if;
      limit_rejected := true;
  end;

  if not limit_rejected then
    raise exception 'REGRESSION: concurrent Free Project insert was accepted';
  end if;
end;
$$;

select dblink_disconnect('project_limit_a');
select dblink_disconnect('project_limit_b');

do $$
begin
  if (
    select count(*)
    from public.projects
    join public.workspaces on workspaces.id = projects.workspace_id
    where workspaces.owner_id = '60000000-0000-4000-8000-000000000006'
  ) <> 1 then
    raise exception 'REGRESSION: concurrent Free requests produced more than one durable Project';
  end if;
end;
$$;

delete from auth.users
where id = '60000000-0000-4000-8000-000000000006';

reset search_path;
