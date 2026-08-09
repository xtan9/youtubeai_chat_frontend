-- Assert the staged legacy rows after the canonical identity migration.

do $$
declare
  survivor constant uuid := 'a3472000-0000-4000-8000-000000000001';
  start_definition text;
  search_definition text;
  balanced_definition text;
begin
  if (select count(*) from public.videos where youtube_video_id = 'dQw4w9WgXcQ') <> 1
    or not exists (
      select 1 from public.videos
      where id = survivor and youtube_video_id = 'dQw4w9WgXcQ'
    )
  then
    raise exception 'REGRESSION: deterministic canonical Video survivor drifted';
  end if;

  if exists (
    select 1 from public.videos
    where id in (
      'a3472000-0000-4000-8000-000000000002',
      'a3472000-0000-4000-8000-000000000003'
    )
  ) then
    raise exception 'REGRESSION: duplicate legacy Video rows survived';
  end if;

  if not exists (
      select 1 from public.videos
      where id = survivor
        and youtube_video_id = 'dQw4w9WgXcQ'
        and url_hash = '0123456789abcdef0123456789abcdef'
    )
    or not exists (
      select 1 from public.videos
      where id = 'a3472000-0000-4000-8000-000000000004'
        and youtube_video_id = '9bZkp7q19f0'
        and url_hash = '9bZkp7q19f0'
    )
    or not exists (
      select 1 from public.videos
      where id = 'a3472000-0000-4000-8000-000000000005'
        and youtube_video_id = 'M7lc1UVf-VE'
        and url_hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  then
    raise exception 'REGRESSION: embed/live/shorts legacy hash backfill drifted';
  end if;

  if (select count(*) from public.summaries where video_id = survivor) <> 3
    or not exists (
      select 1 from public.summaries
      where video_id = survivor and output_language = 'es'
    )
    or not exists (
      select 1 from public.summaries
      where video_id = survivor and output_language = 'fr'
    )
    or exists (
      select 1 from public.summaries
      where summary = 'Duplicate native Summary must lose deterministically'
    )
  then
    raise exception 'REGRESSION: Summary survivor/repointing drifted';
  end if;

  if not exists (
    select 1 from public.video_transcripts
    where video_id = survivor
      and segments->0->>'text' = 'Legacy duplicate evidence Transcript'
  ) then
    raise exception 'REGRESSION: Transcript was not repointed';
  end if;

  if (select count(*) from public.user_video_history where video_id = survivor) <> 2
    or not exists (
      select 1 from public.user_video_history
      where user_id = 'a3471000-0000-4000-8000-000000000001'
        and video_id = survivor
        and accessed_at = '2026-08-02T00:00:00Z'::timestamptz
    )
    or exists (
      select 1 from public.user_video_history
      where video_id <> survivor
        and user_id in (
          'a3471000-0000-4000-8000-000000000001',
          'a3471000-0000-4000-8000-000000000002'
        )
    )
  then
    raise exception 'REGRESSION: owner History survivor/repointing drifted';
  end if;

  if not exists (
    select 1 from public.chat_messages
    where id = 'a3475000-0000-4000-8000-000000000001'
      and video_id = survivor
  ) then
    raise exception 'REGRESSION: Video Chat message was not repointed';
  end if;

  if not exists (
    select 1 from public.project_videos
    where project_id = 'a3474000-0000-4000-8000-000000000001'
      and video_id = survivor
      and position = 1
  )
    or (select count(*) from public.project_videos
        where project_id = 'a3474000-0000-4000-8000-000000000002') <> 1
    or exists (
      select 1 from public.project_videos
      where video_id in (
        'a3472000-0000-4000-8000-000000000002',
        'a3472000-0000-4000-8000-000000000003'
      )
        and project_id in (
          'a3474000-0000-4000-8000-000000000001',
          'a3474000-0000-4000-8000-000000000002'
        )
    )
  then
    raise exception 'REGRESSION: Project membership survivor/repointing drifted';
  end if;

  if (select count(*) from public.project_source_set_events
      where project_id in (
        'a3474000-0000-4000-8000-000000000001',
        'a3474000-0000-4000-8000-000000000002'
      )) <> 3
    or exists (
      select 1 from public.project_source_set_events
      where project_id in (
        'a3474000-0000-4000-8000-000000000001',
        'a3474000-0000-4000-8000-000000000002'
      )
        and video_id <> survivor
    )
  then
    raise exception 'REGRESSION: Project audit events were not preserved/repointed';
  end if;

  if exists (
    select 1 from public.videos
    where youtube_video_id is null
      or youtube_video_id !~ '^[A-Za-z0-9_-]{11}$'
  ) then
    raise exception 'REGRESSION: canonical Video identity is nullable or malformed';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.videos'::regclass
      and conname = 'videos_youtube_video_id_key'
      and contype = 'u'
  )
    or exists (
      select 1 from pg_constraint
      where conrelid = 'public.videos'::regclass
        and conname = 'videos_url_hash_key'
    )
  then
    raise exception 'REGRESSION: canonical Video uniqueness is missing';
  end if;

  select pg_get_functiondef(
    'public.start_project_video_processing(uuid,text,bigint)'::regprocedure
  ) into start_definition;
  select pg_get_functiondef(
    'public.search_project_transcript_passages(uuid,text,integer)'::regprocedure
  ) into search_definition;
  select pg_get_functiondef(
    'public.search_project_transcript_passages_balanced(uuid,text,integer)'::regprocedure
  ) into balanced_definition;

  if start_definition not like '%where youtube_video_id = p_youtube_video_id%'
    or start_definition not like '%on conflict (youtube_video_id) do nothing%'
    or start_definition like '%where url_hash = p_youtube_video_id%'
    or search_definition not like '%videos.youtube_video_id%'
    or search_definition like '%videos.url_hash%'
    or balanced_definition not like '%videos.youtube_video_id%'
    or balanced_definition like '%videos.url_hash%'
  then
    raise exception 'REGRESSION: canonical Project caller definitions drifted';
  end if;

  if not has_function_privilege(
      'authenticated',
      'public.start_project_video_processing(uuid,text,bigint)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.start_project_video_processing(uuid,text,bigint)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.search_project_transcript_passages(uuid,text,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.search_project_transcript_passages(uuid,text,integer)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'authenticated',
      'public.search_project_transcript_passages_balanced(uuid,text,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.search_project_transcript_passages_balanced(uuid,text,integer)',
      'EXECUTE'
    )
  then
    raise exception 'REGRESSION: canonical Project caller grants drifted';
  end if;

  if exists (
    select 1
    from pg_proc
    where oid in (
      'public.start_project_video_processing(uuid,text,bigint)'::regprocedure,
      'public.search_project_transcript_passages(uuid,text,integer)'::regprocedure,
      'public.search_project_transcript_passages_balanced(uuid,text,integer)'::regprocedure
    )
      and (
        not prosecdef
        or proconfig is distinct from array['search_path=""']::text[]
      )
  ) then
    raise exception 'REGRESSION: canonical Project caller security drifted';
  end if;
end;
$$;

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a3471000-0000-4000-8000-000000000001',
  false
);
do $$
declare
  balanced_result jsonb;
begin
  balanced_result := public.search_project_transcript_passages_balanced(
    'a3474000-0000-4000-8000-000000000001',
    'Legacy evidence',
    3
  );

  if balanced_result ->> 'outcome' <> 'ready'
    or jsonb_array_length(balanced_result -> 'passages') <> 3
    or not exists (
      select 1
      from jsonb_array_elements(balanced_result -> 'passages') as passage(value)
      where passage.value ->> 'youtubeVideoId' = 'dQw4w9WgXcQ'
    )
    or not exists (
      select 1
      from jsonb_array_elements(balanced_result -> 'passages') as passage(value)
      where passage.value ->> 'youtubeVideoId' = '9bZkp7q19f0'
    )
    or not exists (
      select 1
      from jsonb_array_elements(balanced_result -> 'passages') as passage(value)
      where passage.value ->> 'youtubeVideoId' = 'M7lc1UVf-VE'
    )
  then
    raise exception
      'REGRESSION: balanced search ignored canonical embed/live/shorts identities: %',
      balanced_result;
  end if;
end;
$$;
reset role;
reset request.jwt.claim.sub;

-- Keep later contract fixtures isolated after the migration assertions pass.
delete from public.projects
where id in (
  'a3474000-0000-4000-8000-000000000001',
  'a3474000-0000-4000-8000-000000000002'
);
delete from public.videos
where id in (
  'a3472000-0000-4000-8000-000000000001',
  'a3472000-0000-4000-8000-000000000004',
  'a3472000-0000-4000-8000-000000000005'
);
delete from auth.users
where id in (
  'a3471000-0000-4000-8000-000000000001',
  'a3471000-0000-4000-8000-000000000002'
);
