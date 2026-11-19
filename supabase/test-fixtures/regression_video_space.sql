begin;
insert into auth.users(id) values ('99000000-0000-4000-8000-000000000001'),('99000000-0000-4000-8000-000000000002');
insert into public.projects(id,workspace_id,name) select '99000000-0000-4000-8000-000000000003',id,'Seed oil' from public.workspaces where owner_id='99000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000001',true);
insert into public.video_spaces values ('99000000-0000-4000-8000-000000000003',1,'{"opening":"handwritten"}');
select public.save_video_space_pdf('99000000-0000-4000-8000-000000000003',1,'{"resources":[{"id":"99000000-0000-4000-8000-000000000004","kind":"pdf","originalPdf":true}]}','99000000-0000-4000-8000-000000000004','JVBERg==');
do $$ begin
  begin
    perform public.save_video_space_pdf('99000000-0000-4000-8000-000000000003',2,
      '{"resources":[{"id":"99000000-0000-4000-8000-000000000004","kind":"pdf","originalPdf":true}],"changed":true}',
      '99000000-0000-4000-8000-000000000004','duplicate');
    raise exception 'Duplicate PDF replaced the original';
  exception when unique_violation then null; end;
  if not exists (select from public.video_spaces where revision=2 and not document ? 'changed')
    then raise exception 'Failed PDF upload changed the Space'; end if;
  update public.video_spaces set revision=3 where revision=2;
  if not found then raise exception 'Owner failed to save';end if;
  update public.video_spaces set revision=3 where revision=2;
  if found then raise exception 'Stale save succeeded';end if;
  if not exists(select from public.video_space_pdfs) then raise exception 'Owner cannot read PDF';end if;
end $$;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000002',true);
do $$ begin
  if exists(select from public.video_spaces) or exists(select from public.video_space_pdfs) then raise exception 'Foreign data visible';end if;
  begin
    insert into public.video_space_pdfs values ('99000000-0000-4000-8000-000000000003',gen_random_uuid(),'JVBERg==');
    raise exception 'Foreign upload succeeded';
  exception when insufficient_privilege then null;end;
end $$;
reset role;
delete from public.projects where id='99000000-0000-4000-8000-000000000003';
do $$ begin if exists (select from public.video_space_pdfs) then raise exception 'PDF survived project deletion'; end if; end $$;
rollback;
