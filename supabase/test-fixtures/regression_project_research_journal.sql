-- Owner isolation, publication, retry, stale-source and historical invariants.
begin;
insert into auth.users(id,is_anonymous) values ('99000000-0000-4000-8000-000000000001',false),('99000000-0000-4000-8000-000000000002',false);
insert into public.projects(id,workspace_id,name) select '99000000-0000-4000-8000-000000000003',id,'Research journal' from public.workspaces where owner_id='99000000-0000-4000-8000-000000000001';
insert into public.project_source_sets(project_id,revision) values('99000000-0000-4000-8000-000000000003',1);
insert into public.user_subscriptions(user_id,tier,stripe_customer_id) values('99000000-0000-4000-8000-000000000001','pro','cus_research_fixture') on conflict(user_id) do update set tier='pro';
set local role service_role;
do $$
declare r jsonb; second jsonb; saved jsonb; first_id uuid;
begin
 r:=public.reserve_project_research('99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000002',null);
 if r->>'outcome'<>'missing' then raise exception 'Other owner reserved research'; end if;
 r:=public.reserve_project_research('99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000001',null);
 if r->>'outcome'<>'started' then raise exception 'Research reserve failed: %',r; end if;
 first_id:=(r->>'id')::uuid;
 second:=public.reserve_project_research('99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000001',null);
 if second->>'outcome'<>'busy' then raise exception 'Duplicate provider work allowed'; end if;
 saved:=public.complete_project_research(first_id,'99000000-0000-4000-8000-000000000001','{"promptVersion":"project-research-v1","sourceSetRevision":1,"question":"Initial judgment"}',2);
 if saved->>'outcome'<>'conflict' then raise exception 'Changed source set accepted'; end if;
 saved:=public.complete_project_research(first_id,'99000000-0000-4000-8000-000000000002','{}',1);
 if saved->>'outcome'<>'conflict' then raise exception 'Other owner published research'; end if;
 saved:=public.complete_project_research(first_id,'99000000-0000-4000-8000-000000000001','{"promptVersion":"project-research-v1","sourceSetRevision":1,"question":"Initial judgment"}',1);
 if saved->>'outcome'<>'completed' then raise exception 'Research completion failed: %',saved; end if;
 saved:=public.complete_project_research(first_id,'99000000-0000-4000-8000-000000000001','{}',1);
 if saved->>'outcome'<>'conflict' then raise exception 'Published version overwritten'; end if;
 second:=public.reserve_project_research('99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000001',null);
 if second->>'outcome'<>'conflict' then raise exception 'Stale base accepted'; end if;
 second:=public.reserve_project_research('99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000001',first_id);
 if second->>'outcome'<>'started' then raise exception 'Follow-up reservation failed'; end if;
 update public.project_research_runs set state='failed' where id=(second->>'id')::uuid;
 saved:=public.complete_project_research((second->>'id')::uuid,'99000000-0000-4000-8000-000000000001','{"promptVersion":"project-research-v1","sourceSetRevision":1}',1);
 if saved->>'outcome'<>'conflict' then raise exception 'Failed run was resurrected'; end if;
 begin
  update public.project_research_runs set document='{}' where id=first_id;
  raise exception 'Immutable version could be modified';
 exception when sqlstate '55000' then null;
 end;
 if (select count(*) from public.project_research_runs where state='completed' and project_id='99000000-0000-4000-8000-000000000003')<>1 then raise exception 'Failure replaced prior judgment'; end if;
 perform set_config('research.first_id',first_id::text,true);
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"99000000-0000-4000-8000-000000000001","is_anonymous":false}',true);
do $$ begin
 if (select count(*) from public.project_research_runs where project_id='99000000-0000-4000-8000-000000000003')<>1 then raise exception 'Owner cannot read completed version or sees pending state'; end if;
 if has_table_privilege('authenticated','public.project_research_runs','INSERT') or has_table_privilege('authenticated','public.project_research_runs','UPDATE')
 or has_function_privilege('authenticated','public.reserve_project_research(uuid,uuid,uuid)','execute') then raise exception 'Browser can forge research'; end if;
end $$;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"99000000-0000-4000-8000-000000000002","is_anonymous":false}',true);
do $$ begin
 if exists(select 1 from public.project_research_runs where project_id='99000000-0000-4000-8000-000000000003') then raise exception 'Other owner sees research'; end if;
end $$;
reset role;
update public.user_subscriptions set tier='free' where user_id='99000000-0000-4000-8000-000000000001';
set local role service_role;
do $$ declare r jsonb; begin
 r:=public.reserve_project_research('99000000-0000-4000-8000-000000000003','99000000-0000-4000-8000-000000000001',current_setting('research.first_id')::uuid);
 if r->>'outcome'<>'limit_reached' then raise exception 'Free update limit bypassed'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 if has_table_privilege('anon','public.project_research_runs','select') or has_function_privilege('anon','public.complete_project_research(uuid,uuid,jsonb,bigint)','execute') then raise exception 'Anonymous access allowed'; end if;
end $$;
reset role;
rollback;
