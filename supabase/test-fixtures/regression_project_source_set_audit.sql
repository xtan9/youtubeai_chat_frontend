-- Contract test for Issue #320 Source Set audit history and immutable
-- conversation provenance. Run after the #315/#318/#319 migrations on both
-- representative legacy and fresh schemas.

begin;

do $$
begin
  if to_regclass('public.project_source_set_events') is null
    or to_regprocedure('public.load_project_conversation(uuid,uuid)') is null
  then
    raise exception 'REGRESSION: Source Set audit seams are missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.project_videos'::regclass
      and tgname = 'project_videos_audit_transition'
      and not tgisinternal
  ) then
    raise exception 'REGRESSION: Source Set transition audit trigger is missing';
  end if;

  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.project_source_set_events'::regclass
  ) or has_table_privilege('authenticated', 'public.project_source_set_events', 'SELECT')
  then
    raise exception 'REGRESSION: audit event privacy grants drifted';
  end if;
end;
$$;

insert into auth.users (id, is_anonymous)
values ('a3200000-0000-4000-8000-000000000001', false)
on conflict (id) do nothing;

insert into public.projects (id, workspace_id, name)
select
  'a3200000-0000-4000-8000-000000000003',
  workspaces.id,
  'Source Set audit fixture'
from public.workspaces
where workspaces.owner_id = 'a3200000-0000-4000-8000-000000000001'
on conflict (id) do nothing;

insert into public.videos (id, youtube_url, url_hash, title)
values (
  'a3200000-0000-4000-8000-000000000004',
  'https://www.youtube.com/watch?v=a3200000001',
  'a3200000001',
  'Audit source'
)
on conflict (id) do nothing;

insert into public.project_source_sets (project_id, revision)
values ('a3200000-0000-4000-8000-000000000003', 0)
on conflict (project_id) do update set revision = excluded.revision;

insert into public.project_videos (
  project_id,
  video_id,
  position,
  status,
  processing_attempt_id
)
values (
  'a3200000-0000-4000-8000-000000000003',
  'a3200000-0000-4000-8000-000000000004',
  1,
  'processing',
  'a3200000-0000-4000-8000-000000000006'
);

update public.project_source_sets
set revision = 1
where project_id = 'a3200000-0000-4000-8000-000000000003';

do $$
declare
  event_count integer;
  event_revision bigint;
begin
  select count(*)::integer, max(revision)
  into event_count, event_revision
  from public.project_source_set_events
  where project_id = 'a3200000-0000-4000-8000-000000000003';

  if event_count <> 1 or event_revision <> 1 then
    raise exception 'REGRESSION: one membership commit did not produce one audit event';
  end if;

  if exists (
    select 1
    from public.project_source_set_events
    where project_id = 'a3200000-0000-4000-8000-000000000003'
      and (video_title <> 'Audit source' or event_kind <> 'added')
  ) then
    raise exception 'REGRESSION: audit transition identity drifted';
  end if;
end;
$$;

insert into public.project_conversations (id, project_id, kind)
values (
  'a3200000-0000-4000-8000-000000000005',
  'a3200000-0000-4000-8000-000000000003',
  'default'
);

insert into public.project_conversation_messages (
  conversation_id,
  role,
  content,
  completion_attempt_token,
  completion_state
)
values (
  'a3200000-0000-4000-8000-000000000005',
  'user',
  'Question at revision one',
  gen_random_uuid(),
  'reserved'
);

do $$
begin
  if (
    select source_set_revision
    from public.project_conversation_messages
    where conversation_id = 'a3200000-0000-4000-8000-000000000005'
      and role = 'user'
  ) <> 1 then
    raise exception 'REGRESSION: new user message did not retain Source Set revision';
  end if;
end;
$$;

rollback;
