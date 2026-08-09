-- Assert the staged legacy rows after the canonical identity migration.

do $$
declare
  survivor constant uuid := 'a3472000-0000-4000-8000-000000000001';
  exposed_role text;
  table_privilege text;
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

  if not exists (
      select 1
      from public.videos
      join public.video_transcripts
        on video_transcripts.video_id = videos.id
      where videos.id = '8a37686a-e461-4388-a087-ac030d0bf7f0'
        and videos.youtube_url = 'https://www.youtube.com/watch?v=_b1b-uMuzKQ'
        and videos.youtube_video_id = '_b1b-uMuzKQ'
        and videos.url_hash = '34aef0dd8636c55d3c23a6fa334b2001'
        and to_jsonb(video_transcripts) = jsonb_build_object(
          'video_id', '8a37686a-e461-4388-a087-ac030d0bf7f0'::uuid,
          'transcript_source', 'manual_captions',
          'language', 'en',
          'created_at', '2026-08-04T00:01:00Z'::timestamptz,
          'segments', '[{"text":"Recoverable redirect Transcript","start":13,"duration":4}]'::jsonb
        )
    )
    or exists (
      select 1
      from public.videos
      where id in (
        'a456bf8d-5413-452c-82d2-6f4d6923101d',
        'f83123c7-4e6a-4a95-9554-1978dac3e535'
      )
    )
  then
    raise exception 'REGRESSION: production identity incident repair drifted';
  end if;

  if (
      select count(*)
      from project_private.legacy_video_identity_quarantine
    ) <> 2
    or not exists (
      select 1
      from project_private.legacy_video_identity_quarantine
      where video_id = 'a456bf8d-5413-452c-82d2-6f4d6923101d'
        and reason = 'unsupported_channel_url'
        and video_snapshot = jsonb_build_object(
          'id', 'a456bf8d-5413-452c-82d2-6f4d6923101d'::uuid,
          'youtube_url', 'https://youtube.com/@waseemiq1?si=WGN0uguYUo-ivemT',
          'url_hash', '9e45ba7aa82c74c496bbd9d412e8fe13',
          'title', 'Unsupported channel one',
          'channel_name', 'Incident Fixture',
          'language', 'en',
          'created_at', '2026-08-05T00:00:00Z'::timestamptz
        )
        and transcript_snapshot = jsonb_build_object(
          'video_id', 'a456bf8d-5413-452c-82d2-6f4d6923101d'::uuid,
          'transcript_source', 'auto_captions',
          'language', 'en',
          'created_at', '2026-08-05T00:01:00Z'::timestamptz,
          'segments', '[{"text":"Quarantined channel one Transcript","start":17,"duration":4}]'::jsonb
        )
    )
    or not exists (
      select 1
      from project_private.legacy_video_identity_quarantine
      where video_id = 'f83123c7-4e6a-4a95-9554-1978dac3e535'
        and reason = 'unsupported_channel_url'
        and video_snapshot = jsonb_build_object(
          'id', 'f83123c7-4e6a-4a95-9554-1978dac3e535'::uuid,
          'youtube_url', 'https://youtube.com/@richmovies-k3q?si=iolcO_gyLvcEMBYq',
          'url_hash', '1ac8645240c853aba638dfba8364a9cf',
          'title', 'Unsupported channel two',
          'channel_name', 'Incident Fixture',
          'language', 'zh',
          'created_at', '2026-08-06T00:00:00Z'::timestamptz
        )
        and transcript_snapshot = jsonb_build_object(
          'video_id', 'f83123c7-4e6a-4a95-9554-1978dac3e535'::uuid,
          'transcript_source', 'whisper',
          'language', 'zh',
          'created_at', '2026-08-06T00:01:00Z'::timestamptz,
          'segments', '[{"text":"Quarantined channel two Transcript","start":19,"duration":4}]'::jsonb
        )
    )
  then
    raise exception 'REGRESSION: complete private quarantine snapshots drifted';
  end if;

  if not exists (
      select 1
      from pg_class
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'project_private'
        and pg_class.relname = 'legacy_video_identity_quarantine'
        and pg_class.relrowsecurity
    )
    or exists (
      select 1
      from pg_class as quarantine_class
      cross join lateral aclexplode(coalesce(
        quarantine_class.relacl,
        acldefault('r', quarantine_class.relowner)
      )) as quarantine_acl
      where quarantine_class.oid =
        'project_private.legacy_video_identity_quarantine'::regclass
        and (
          quarantine_acl.grantee = 0
          or quarantine_acl.grantee in (
            select pg_roles.oid
            from pg_roles
            where pg_roles.rolname in (
              'anon',
              'authenticated',
              'service_role'
            )
          )
        )
    )
  then
    raise exception 'REGRESSION: private quarantine access boundary drifted';
  end if;

  -- PostgreSQL 15 does not expose MAINTAIN through has_table_privilege.
  -- The ACL expansion above rejects every direct privilege bit (including
  -- MAINTAIN on versions that support it); these explicit checks also catch
  -- privileges inherited by an exposed role through another role.
  foreach exposed_role in array array[
    'anon',
    'authenticated',
    'service_role'
  ]
  loop
    foreach table_privilege in array array[
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ]
    loop
      if has_table_privilege(
        exposed_role,
        'project_private.legacy_video_identity_quarantine',
        table_privilege
      ) then
        raise exception
          'REGRESSION: % inherited % on the private quarantine table',
          exposed_role,
          table_privilege;
      end if;
    end loop;
  end loop;

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
  )
    or not exists (
      select 1
      from pg_attribute
      where attrelid = 'public.videos'::regclass
        and attname = 'youtube_video_id'
        and attnotnull
        and not attisdropped
    )
  then
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
