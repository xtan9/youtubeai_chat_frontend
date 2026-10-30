-- Real competing sessions: one active provider lease, then terminal failure
-- must win over a completion that waited on its row lock.
create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
insert into auth.users(id,is_anonymous) values('99100000-0000-4000-8000-000000000001',false);
insert into public.projects(id,workspace_id,name) select '99100000-0000-4000-8000-000000000003',id,'Concurrent research' from public.workspaces where owner_id='99100000-0000-4000-8000-000000000001';
do $$
declare a jsonb; b jsonb; run_id uuid; blocked boolean:=false;
begin
 perform dblink_connect('research_a',format('dbname=%L application_name=research_terminal_a',current_database()));
 perform dblink_connect('research_b',format('dbname=%L application_name=research_terminal_b',current_database()));
 perform dblink_exec('research_a','set role service_role');
 perform dblink_exec('research_b','set role service_role');
 perform dblink_send_query('research_a',$q$select public.reserve_project_research('99100000-0000-4000-8000-000000000003','99100000-0000-4000-8000-000000000001',null)$q$);
 perform dblink_send_query('research_b',$q$select public.reserve_project_research('99100000-0000-4000-8000-000000000003','99100000-0000-4000-8000-000000000001',null)$q$);
 select result into a from dblink_get_result('research_a') as t(result jsonb);
 select result into b from dblink_get_result('research_b') as t(result jsonb);
 perform result from dblink_get_result('research_a') as t(result jsonb);
 perform result from dblink_get_result('research_b') as t(result jsonb);
 if array[a->>'outcome',b->>'outcome'] not in (array['started','busy'],array['busy','started']) then raise exception 'Concurrent provider leases: %, %',a,b; end if;
 run_id:=coalesce(a->>'id',b->>'id')::uuid;
 perform dblink_exec('research_a','begin');
 perform dblink_exec('research_a',format('update public.project_research_runs set state=''failed'' where id=%L',run_id));
 perform dblink_send_query('research_b',format($q$select public.complete_project_research(%L,'99100000-0000-4000-8000-000000000001','{"promptVersion":"project-research-v1","sourceSetRevision":0}',0)$q$,run_id));
 for attempt in 1..100 loop
  select exists(select 1 from pg_stat_activity where application_name='research_terminal_b' and wait_event_type='Lock') into blocked;
  exit when blocked;
  perform pg_sleep(0.01);
 end loop;
 if not blocked then raise exception 'Completion never reached overlapping failure row lock'; end if;
 perform dblink_exec('research_a','commit');
 select result into b from dblink_get_result('research_b') as t(result jsonb);
 perform result from dblink_get_result('research_b') as t(result jsonb);
 if b->>'outcome'<>'conflict' then raise exception 'Failed run resurrected by overlapping publication: %',b; end if;
 if (select state from public.project_research_runs where id=run_id)<>'failed' then raise exception 'Terminal state overwritten'; end if;
 perform dblink_disconnect('research_a');
 perform dblink_disconnect('research_b');
end $$;
delete from auth.users where id='99100000-0000-4000-8000-000000000001';
reset search_path;
