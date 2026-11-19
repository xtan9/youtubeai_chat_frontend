create table public.video_spaces (
  project_id uuid primary key references public.projects(id) on delete cascade,
  revision integer not null check (revision > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 3000000)
);
alter table public.video_spaces enable row level security;
revoke all on public.video_spaces from public, anon, authenticated;
grant select, insert, update(revision,document) on public.video_spaces to authenticated;
create policy space_owner on public.video_spaces for all to authenticated
using (exists (select 1 from public.projects p join public.workspaces w on w.id=p.workspace_id
  where p.id=project_id and w.owner_id=(select auth.uid())))
with check (exists (select 1 from public.projects p join public.workspaces w on w.id=p.workspace_id
  where p.id=project_id and w.owner_id=(select auth.uid())));
create policy registered_only on public.video_spaces as restrictive for all to authenticated
using ((select project_private.has_registered_project_access()))
with check ((select project_private.has_registered_project_access()));

-- Store original documents separately so a keystroke never re-uploads the PDF.
create table public.video_space_pdfs (
  project_id uuid not null references public.projects(id) on delete cascade,
  id uuid not null, contents text not null check (length(contents) between 1 and 33333336),
  primary key(project_id,id)
);
alter table public.video_space_pdfs enable row level security;
revoke all on public.video_space_pdfs from public,anon,authenticated;
grant select,insert on public.video_space_pdfs to authenticated;
create policy pdf_owner on public.video_space_pdfs for all to authenticated
using ((select project_private.has_registered_project_access()) and exists (
  select 1 from public.projects p join public.workspaces w on w.id=p.workspace_id
  where p.id=project_id and w.owner_id=(select auth.uid())))
with check ((select project_private.has_registered_project_access()) and exists (
  select 1 from public.projects p join public.workspaces w on w.id=p.workspace_id
  where p.id=project_id and w.owner_id=(select auth.uid())) and exists (
    select from public.video_spaces s,jsonb_array_elements(s.document->'resources') r
    where s.project_id=video_space_pdfs.project_id and r->>'id'=video_space_pdfs.id::text
      and r->>'kind'='pdf' and r->>'originalPdf'='true'));

-- RLS and the revision check apply to both parts of the import transaction.
create function public.save_video_space_pdf(p_project uuid,p_revision integer,p_document jsonb,p_id uuid,p_contents text)
returns integer language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from jsonb_array_elements(p_document->'resources') r
    where r->>'id'=p_id::text and r->>'kind'='pdf' and r->>'originalPdf'='true')
    then raise exception 'Missing PDF resource'; end if;
  if p_revision=0 then
    insert into public.video_spaces values(p_project,1,p_document) on conflict do nothing;
  else
    update public.video_spaces set document=p_document,revision=p_revision+1
      where project_id=p_project and revision=p_revision;
  end if;
  if not found then raise exception 'Space revision conflict' using errcode='40001'; end if;
  insert into public.video_space_pdfs values(p_project,p_id,p_contents);
  return p_revision+1;
end $$;
revoke all on function public.save_video_space_pdf(uuid,integer,jsonb,uuid,text) from public,anon;
grant execute on function public.save_video_space_pdf(uuid,integer,jsonb,uuid,text) to authenticated;
