-- Contract test for ordered, canonical, owner-private Project Source Sets.
-- Run after both the representative legacy and independent fresh migration
-- replays so constraints, grants, RLS, RPC serialization, retention, and
-- cascades cannot drift between installation paths.

begin;

insert into auth.users (id, is_anonymous)
values
  ('51000000-0000-4000-8000-000000000001', false),
  ('52000000-0000-4000-8000-000000000002', false)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

-- This contract needs multiple owned Projects to prove canonical reuse.
-- #314's Free limit is tested independently, so model this owner as Pro.
insert into public.user_subscriptions (
  user_id,
  stripe_customer_id,
  tier,
  status
)
values (
  '51000000-0000-4000-8000-000000000001',
  'cus_project_source_set_owner',
  'pro',
  'active'
)
on conflict (user_id) do update set
  tier = excluded.tier,
  status = excluded.status;

insert into public.projects (id, workspace_id, name)
select 'a1000000-0000-4000-8000-000000000001', id, 'Source Set owner project'
from public.workspaces
where owner_id = '51000000-0000-4000-8000-000000000001';

insert into public.projects (id, workspace_id, name)
select 'a1000000-0000-4000-8000-000000000002', id, 'Canonical reuse project'
from public.workspaces
where owner_id = '51000000-0000-4000-8000-000000000001';

insert into public.projects (id, workspace_id, name)
select 'a1000000-0000-4000-8000-000000000003', id, 'Status project'
from public.workspaces
where owner_id = '51000000-0000-4000-8000-000000000001';

insert into public.videos (id, youtube_url, url_hash, title, channel_name, language)
values
  ('61000000-0000-4000-8000-000000000001', 'https://www.youtube.com/watch?v=aaaaaaa0001', 'source-set-1', 'Source one', 'Channel A', 'en'),
  ('62000000-0000-4000-8000-000000000002', 'https://www.youtube.com/watch?v=aaaaaaa0002', 'source-set-2', 'Source two', 'Channel B', 'en'),
  ('63000000-0000-4000-8000-000000000003', 'https://www.youtube.com/watch?v=aaaaaaa0003', 'source-set-3', 'Source three', 'Channel C', 'en'),
  ('64000000-0000-4000-8000-000000000004', 'https://www.youtube.com/watch?v=aaaaaaa0004', 'source-set-4', 'Source four', 'Channel D', 'en'),
  ('65000000-0000-4000-8000-000000000005', 'https://www.youtube.com/watch?v=aaaaaaa0005', 'source-set-5', 'Source five', 'Channel E', 'en'),
  ('66000000-0000-4000-8000-000000000006', 'https://www.youtube.com/watch?v=aaaaaaa0006', 'source-set-6', 'Source six', 'Channel F', 'en'),
  ('67000000-0000-4000-8000-000000000007', 'https://www.youtube.com/watch?v=aaaaaaa0007', 'source-set-7', 'Unprocessed source', 'Channel G', 'en');

insert into public.video_transcripts (
  video_id,
  transcript_source,
  language,
  segments
) values
  ('61000000-0000-4000-8000-000000000001', 'manual_captions', 'en', '[{"text":"Canonical transcript 1","start":0,"duration":5}]'::jsonb),
  ('62000000-0000-4000-8000-000000000002', 'manual_captions', 'en', '[{"text":"Canonical transcript 2","start":0,"duration":5}]'::jsonb),
  ('63000000-0000-4000-8000-000000000003', 'manual_captions', 'en', '[{"text":"Canonical transcript 3","start":0,"duration":5}]'::jsonb),
  ('64000000-0000-4000-8000-000000000004', 'manual_captions', 'en', '[{"text":"Canonical transcript 4","start":0,"duration":5}]'::jsonb),
  ('65000000-0000-4000-8000-000000000005', 'manual_captions', 'en', '[{"text":"Canonical transcript 5","start":0,"duration":5}]'::jsonb),
  ('66000000-0000-4000-8000-000000000006', 'manual_captions', 'en', '[{"text":"Canonical transcript 6","start":0,"duration":5}]'::jsonb);

insert into public.summaries (
  video_id,
  summary,
  transcript_source,
  output_language
) values
  ('61000000-0000-4000-8000-000000000001', 'Canonical summary 1', 'manual_captions', null),
  ('62000000-0000-4000-8000-000000000002', 'Canonical summary 2', 'manual_captions', null),
  ('63000000-0000-4000-8000-000000000003', 'Canonical summary 3', 'manual_captions', null),
  ('64000000-0000-4000-8000-000000000004', 'Canonical summary 4', 'manual_captions', null),
  ('65000000-0000-4000-8000-000000000005', 'Canonical summary 5', 'manual_captions', null),
  ('66000000-0000-4000-8000-000000000006', 'Canonical summary 6', 'manual_captions', null);

insert into public.user_video_history (user_id, video_id)
select '51000000-0000-4000-8000-000000000001', id
from public.videos
where id in (
  '61000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000002',
  '63000000-0000-4000-8000-000000000003',
  '64000000-0000-4000-8000-000000000004',
  '65000000-0000-4000-8000-000000000005',
  '66000000-0000-4000-8000-000000000006',
  '67000000-0000-4000-8000-000000000007'
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.project_videos'::regclass
      and conname = 'project_videos_pkey'
      and contype = 'p'
  ) or not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.project_videos'::regclass
      and conname = 'project_videos_project_position_key'
      and contype = 'u'
      and condeferrable
  ) then
    raise exception 'REGRESSION: Source Set membership uniqueness is missing';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'project_videos'
      and indexname = 'project_videos_video_id_idx'
  ) then
    raise exception 'REGRESSION: canonical Video membership index is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.project_videos'::regclass
      and tgname = 'project_videos_enforce_limit'
      and not tgisinternal
  ) or has_function_privilege(
    'service_role',
    'project_private.enforce_project_video_limit()',
    'EXECUTE'
  ) then
    raise exception 'REGRESSION: universal cap trigger is missing or exposed';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'user_video_history'
      and indexname = 'user_video_history_user_accessed_video_idx'
  ) then
    raise exception 'REGRESSION: processed History pagination index is missing';
  end if;

  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.project_source_sets'::regclass
  ) or not (
    select relrowsecurity
    from pg_class
    where oid = 'public.project_videos'::regclass
  ) then
    raise exception 'REGRESSION: Project Source Set RLS is disabled';
  end if;

  if not has_table_privilege('authenticated', 'public.project_source_sets', 'SELECT')
    or has_table_privilege('authenticated', 'public.project_source_sets', 'INSERT')
    or not has_table_privilege('authenticated', 'public.project_videos', 'SELECT')
    or has_table_privilege('authenticated', 'public.project_videos', 'INSERT')
    or has_table_privilege('anon', 'public.project_videos', 'SELECT')
    or has_table_privilege('service_role', 'public.project_source_sets', 'UPDATE')
    or has_table_privilege('service_role', 'public.project_videos', 'INSERT')
    or has_table_privilege('service_role', 'public.project_videos', 'UPDATE')
    or has_table_privilege('service_role', 'public.project_videos', 'DELETE')
    or not has_function_privilege(
      'authenticated',
      'public.add_project_history_video(uuid,uuid,bigint)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.add_project_history_video(uuid,uuid,bigint)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.list_project_history_candidates(uuid,text,integer,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'project_private.video_has_durable_ready_evidence(uuid)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'project_private.video_has_durable_ready_evidence(uuid)',
      'EXECUTE'
    )
  then
    raise exception 'REGRESSION: Project Source Set grants are not least privilege';
  end if;

  if not exists (
    select 1
    from pg_proc
    where oid = 'public.add_project_history_video(uuid,uuid,bigint)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=""']
  ) then
    raise exception 'REGRESSION: Source Set mutation RPC is not hardened';
  end if;

  if not exists (
    select 1
    from pg_proc
    where oid = 'public.list_project_history_candidates(uuid,text,integer,integer)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=""']
  ) then
    raise exception 'REGRESSION: Source Set candidate RPC is not hardened';
  end if;

  if not exists (
    select 1
    from pg_proc
    where oid =
      'project_private.video_has_durable_ready_evidence(uuid)'::regprocedure
      and not prosecdef
      and provolatile = 's'
      and proconfig @> array['search_path=""']
  ) then
    raise exception 'REGRESSION: canonical readiness predicate is not private and stable';
  end if;

  if position(
    'project_private.video_has_durable_ready_evidence'
    in pg_get_functiondef(
      'public.add_project_history_video(uuid,uuid,bigint)'::regprocedure
    )
  ) = 0 or position(
    'project_private.video_has_durable_ready_evidence'
    in pg_get_functiondef(
      'public.list_project_history_candidates(uuid,text,integer,integer)'::regprocedure
    )
  ) = 0 then
    raise exception 'REGRESSION: Source Set readiness consumers have drifted';
  end if;

  if not project_private.video_has_durable_ready_evidence(
    '61000000-0000-4000-8000-000000000001'
  ) or project_private.video_has_durable_ready_evidence(
    '67000000-0000-4000-8000-000000000007'
  ) then
    raise exception 'REGRESSION: canonical readiness predicate misclassified evidence';
  end if;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '51000000-0000-4000-8000-000000000001',
  true
);

do $$
declare
  result jsonb;
begin
  result := public.list_project_history_candidates(
    'a1000000-0000-4000-8000-000000000001',
    'Unprocessed source',
    1,
    10
  );
  if result->>'outcome' <> 'resolved'
    or (result->>'total')::integer <> 0
    or jsonb_array_length(result->'candidates') <> 0 then
    raise exception 'REGRESSION: picker exposed History without durable evidence';
  end if;

  result := public.add_project_history_video(
    'a1000000-0000-4000-8000-000000000001',
    '67000000-0000-4000-8000-000000000007',
    0
  );
  if result->>'outcome' <> 'not_ready'
    or (result->>'revision')::bigint <> 0 then
    raise exception 'REGRESSION: unprocessed History Video became ready membership';
  end if;

  result := public.add_project_history_video(
    'a1000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    0
  );
  if result->>'outcome' <> 'added' or (result->>'revision')::bigint <> 1 then
    raise exception 'REGRESSION: owned History Video was not added atomically';
  end if;

  result := public.add_project_history_video(
    'a1000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    1
  );
  if result->>'outcome' <> 'duplicate' then
    raise exception 'REGRESSION: duplicate membership was not rejected safely';
  end if;

  perform public.add_project_history_video(
    'a1000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000002',
    1
  );
  perform public.add_project_history_video(
    'a1000000-0000-4000-8000-000000000001',
    '63000000-0000-4000-8000-000000000003',
    2
  );
  perform public.add_project_history_video(
    'a1000000-0000-4000-8000-000000000001',
    '64000000-0000-4000-8000-000000000004',
    3
  );
  perform public.add_project_history_video(
    'a1000000-0000-4000-8000-000000000001',
    '65000000-0000-4000-8000-000000000005',
    4
  );

  result := public.add_project_history_video(
    'a1000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000006',
    5
  );
  if result->>'outcome' <> 'limit_reached' then
    raise exception 'REGRESSION: five-Video grounding limit was bypassed';
  end if;

  result := public.add_project_history_video(
    'a1000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000001',
    0
  );
  if result->>'outcome' <> 'added' then
    raise exception 'REGRESSION: canonical Video cannot belong to two Projects';
  end if;

  result := public.reorder_project_videos(
    'a1000000-0000-4000-8000-000000000001',
    array[
      '65000000-0000-4000-8000-000000000005',
      '64000000-0000-4000-8000-000000000004',
      '63000000-0000-4000-8000-000000000003',
      '62000000-0000-4000-8000-000000000002',
      '61000000-0000-4000-8000-000000000001'
    ]::uuid[],
    5
  );
  if result->>'outcome' <> 'reordered' or (result->>'revision')::bigint <> 6 then
    raise exception 'REGRESSION: complete Source Set reorder failed';
  end if;

  result := public.reorder_project_videos(
    'a1000000-0000-4000-8000-000000000001',
    array[
      '61000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000002',
      '63000000-0000-4000-8000-000000000003',
      '64000000-0000-4000-8000-000000000004',
      '65000000-0000-4000-8000-000000000005'
    ]::uuid[],
    5
  );
  if result->>'outcome' <> 'conflict' or (result->>'revision')::bigint <> 6 then
    raise exception 'REGRESSION: stale concurrent reorder was not rejected';
  end if;

  result := public.remove_project_video(
    'a1000000-0000-4000-8000-000000000001',
    '63000000-0000-4000-8000-000000000003',
    6
  );
  if result->>'outcome' <> 'removed' or (result->>'revision')::bigint <> 7 then
    raise exception 'REGRESSION: membership removal did not revise Source Set';
  end if;

  if (
    select array_agg(video_id order by position)
    from public.project_videos
    where project_id = 'a1000000-0000-4000-8000-000000000001'
  ) <> array[
    '65000000-0000-4000-8000-000000000005',
    '64000000-0000-4000-8000-000000000004',
    '62000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000001'
  ]::uuid[] or (
    select array_agg(position order by position)
    from public.project_videos
    where project_id = 'a1000000-0000-4000-8000-000000000001'
  ) <> array[1, 2, 3, 4]::smallint[] then
    raise exception 'REGRESSION: remove/reorder did not preserve stable contiguous order';
  end if;
end;
$$;

reset role;

-- Service-role callers must use the attempt-aware processing finalizer; table
-- DML is deliberately unavailable so no application path can bypass revision
-- or the processing lease.
set local role service_role;
do $$
begin
  begin
    insert into public.project_videos (project_id, video_id, position, status)
    values (
      'a1000000-0000-4000-8000-000000000001',
      '66000000-0000-4000-8000-000000000006',
      5,
      'ready'
    );
    raise exception 'REGRESSION: service role can insert membership without revision';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.project_videos
    set status = 'failed', failure_code = 'bypassed_revision'
    where project_id = 'a1000000-0000-4000-8000-000000000001';
    raise exception 'REGRESSION: service role can update status without revision';
  exception
    when insufficient_privilege then null;
  end;

  begin
    delete from public.project_videos
    where project_id = 'a1000000-0000-4000-8000-000000000001';
    raise exception 'REGRESSION: service role can delete membership without revision';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.project_source_sets
    set revision = revision + 100
    where project_id = 'a1000000-0000-4000-8000-000000000001';
    raise exception 'REGRESSION: service role can forge Source Set revision';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Add canonical ready evidence through the owner path. Attempt-aware status
-- transition behavior is covered by the Project Video processing contract.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '51000000-0000-4000-8000-000000000001',
  true
);
select public.add_project_history_video(
  'a1000000-0000-4000-8000-000000000003',
  '62000000-0000-4000-8000-000000000002',
  0
);
select public.add_project_history_video(
  'a1000000-0000-4000-8000-000000000003',
  '63000000-0000-4000-8000-000000000003',
  1
);
reset role;

do $$
begin
  if (select revision from public.project_source_sets
      where project_id = 'a1000000-0000-4000-8000-000000000003') <> 2
    or exists (
      select 1
      from public.project_videos
      where project_id = 'a1000000-0000-4000-8000-000000000003'
        and (status <> 'ready' or processing_attempt_id is not null)
    ) then
    raise exception 'REGRESSION: owner-added ready membership or revision is incoherent';
  end if;
end;
$$;

-- Free History eviction is independent from durable Project membership.
delete from public.user_video_history
where user_id = '51000000-0000-4000-8000-000000000001'
  and video_id = '61000000-0000-4000-8000-000000000001';

do $$
begin
  if not exists (
    select 1
    from public.project_videos
    where project_id = 'a1000000-0000-4000-8000-000000000001'
      and video_id = '61000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'REGRESSION: History eviction removed Project membership';
  end if;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '52000000-0000-4000-8000-000000000002',
  true
);

do $$
declare
  result jsonb;
begin
  if (select count(*) from public.project_source_sets) <> 0
    or (select count(*) from public.project_videos) <> 0 then
    raise exception 'REGRESSION: cross-owner Source Set read escaped RLS';
  end if;

  result := public.add_project_history_video(
    'a1000000-0000-4000-8000-000000000001',
    '66000000-0000-4000-8000-000000000006',
    7
  );
  if result <> jsonb_build_object('outcome', 'missing') then
    raise exception 'REGRESSION: cross-owner add leaked or mutated Source Set';
  end if;

  result := public.remove_project_video(
    'a1000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    7
  );
  if result <> jsonb_build_object('outcome', 'missing') then
    raise exception 'REGRESSION: cross-owner remove leaked or mutated Source Set';
  end if;

  result := public.reorder_project_videos(
    'a1000000-0000-4000-8000-000000000001',
    array[]::uuid[],
    7
  );
  if result <> jsonb_build_object('outcome', 'missing') then
    raise exception 'REGRESSION: cross-owner reorder leaked or mutated Source Set';
  end if;

  result := public.list_project_history_candidates(
    'a1000000-0000-4000-8000-000000000001',
    null,
    1,
    10
  );
  if result <> jsonb_build_object('outcome', 'missing') then
    raise exception 'REGRESSION: cross-owner candidate list leaked Project or History';
  end if;

  begin
    delete from public.project_videos
    where project_id = 'a1000000-0000-4000-8000-000000000001';
    raise exception 'REGRESSION: direct authenticated membership mutation is allowed';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;

-- Deleting a Project cascades only aggregate/membership rows.
delete from public.projects
where id = 'a1000000-0000-4000-8000-000000000002';

do $$
begin
  if exists (
    select 1
    from public.project_source_sets
    where project_id = 'a1000000-0000-4000-8000-000000000002'
  ) or exists (
    select 1
    from public.project_videos
    where project_id = 'a1000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'REGRESSION: Project deletion did not cascade membership';
  end if;

  if not exists (
    select 1 from public.videos
    where id = '61000000-0000-4000-8000-000000000001'
  ) or not exists (
    select 1 from public.video_transcripts
    where video_id = '61000000-0000-4000-8000-000000000001'
  ) or not exists (
    select 1 from public.summaries
    where video_id = '61000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'REGRESSION: Project deletion removed canonical evidence';
  end if;
end;
$$;

rollback;
