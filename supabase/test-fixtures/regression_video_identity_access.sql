-- Canonical Video identity and Data API access boundary contract.
-- Run after both legacy and fresh migration replays.

begin;

insert into auth.users (id, is_anonymous)
values ('91000000-0000-4000-8000-000000000001', false)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

insert into public.videos (
  id,
  youtube_url,
  youtube_video_id,
  title,
  channel_name,
  language
)
values (
  '92000000-0000-4000-8000-000000000001',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'dQw4w9WgXcQ',
  'Canonical identity',
  'Identity Lab',
  'en'
)
on conflict (youtube_video_id) do update
set youtube_url = excluded.youtube_url;

-- Equivalent URL input must select/update the existing canonical row rather
-- than create a second UUID. The trigger also keeps the legacy hash populated
-- for rows written during a rolling deploy.
insert into public.videos (
  youtube_url,
  youtube_video_id,
  title,
  language
)
values (
  'https://youtu.be/dQw4w9WgXcQ?si=fixture',
  'dQw4w9WgXcQ',
  'Equivalent URL',
  'en'
)
on conflict (youtube_video_id) do update
set title = excluded.title;

insert into public.summaries (
  video_id,
  summary,
  transcript_source,
  output_language
)
values (
  '92000000-0000-4000-8000-000000000001',
  'Canonical summary',
  'manual_captions',
  null
)
on conflict (video_id, output_language) do nothing;

insert into public.video_transcripts (
  video_id,
  transcript_source,
  language,
  segments
)
values (
  '92000000-0000-4000-8000-000000000001',
  'manual_captions',
  'en',
  '[{"text":"Owner-scoped canonical Transcript","start":1,"duration":2}]'::jsonb
)
on conflict (video_id) do update set segments = excluded.segments;

insert into public.user_video_history (user_id, video_id)
values (
  '91000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001'
)
on conflict (user_id, video_id) do nothing;

do $$
declare
  expected_id constant text := 'dQw4w9WgXcQ';
  identity_count integer;
  history_result jsonb;
  mismatch_rejected boolean;
  unsupported_url_rejected boolean;
  service_transcript_count integer;
begin
  if public.canonical_youtube_video_id(expected_id) is distinct from expected_id
    or public.canonical_youtube_video_id(
      'https://www.youtube.com/watch?v=' || expected_id || '&t=20s'
    ) is distinct from expected_id
    or public.canonical_youtube_video_id(
      'https://youtu.be/' || expected_id || '?si=fixture'
    ) is distinct from expected_id
    or public.canonical_youtube_video_id(
      'https://m.youtube.com/embed/' || expected_id
    ) is distinct from expected_id
    or public.canonical_youtube_video_id(
      'https://music.youtube.com/shorts/' || expected_id
    ) is distinct from expected_id
    or public.canonical_youtube_video_id(
      'https://www.youtube.com/v/' || expected_id
    ) is distinct from expected_id
  then
    raise exception 'REGRESSION: supported URL forms do not share one identity';
  end if;

  if public.canonical_youtube_video_id(
       'https://example.com/watch?v=' || expected_id
     ) is not null
    or public.canonical_youtube_video_id('not-valid') is not null then
    raise exception 'REGRESSION: malformed or unsupported identity was accepted';
  end if;

  select count(*)
  into identity_count
  from public.videos
  where youtube_video_id = expected_id;
  if identity_count <> 1 then
    raise exception 'REGRESSION: equivalent URLs created duplicate canonical Videos';
  end if;

  -- A caller must not be able to pair one external identity with another
  -- video's URL.  Otherwise a later URL-only write could create a duplicate
  -- canonical Video for the URL that was silently attached to the wrong ID.
  mismatch_rejected := false;
  begin
    begin
      insert into public.videos (
        youtube_url,
        youtube_video_id,
        language
      )
      values (
        'https://youtu.be/9bZkp7q19f0',
        expected_id,
        'en'
      );
    exception when others then
      if sqlerrm <> 'youtube_url and youtube_video_id must identify the same video' then
        raise;
      end if;
      mismatch_rejected := true;
    end;
    if not mismatch_rejected then
      raise exception 'REGRESSION: mismatched canonical ID and URL were accepted';
    end if;
  end;

  -- A valid explicit ID must not make an unsupported supplied URL truthful.
  -- Every stored URL remains independently canonicalizable.
  unsupported_url_rejected := false;
  begin
    begin
      insert into public.videos (
        youtube_url,
        youtube_video_id,
        language
      )
      values (
        'https://example.com/watch?v=' || expected_id,
        expected_id,
        'en'
      );
    exception when others then
      if sqlerrm <> 'youtube_url must contain a supported YouTube video ID' then
        raise;
      end if;
      unsupported_url_rejected := true;
    end;
    if not unsupported_url_rejected then
      raise exception 'REGRESSION: unsupported URL with valid canonical ID was accepted';
    end if;
  end;

  if has_table_privilege('anon', 'public.videos', 'SELECT')
    or has_table_privilege('authenticated', 'public.videos', 'SELECT')
    or has_table_privilege('anon', 'public.summaries', 'SELECT')
    or has_table_privilege('authenticated', 'public.summaries', 'SELECT') then
    raise exception 'REGRESSION: browser role retains shared cache SELECT grant';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('videos', 'summaries')
      and cmd = 'SELECT'
      and roles && array['public', 'anon', 'authenticated']::name[]
  ) then
    raise exception 'REGRESSION: browser shared-cache SELECT policy remains exposed';
  end if;

  if not exists (
      select 1 from pg_class
      where oid = 'public.video_transcripts'::regclass
        and relrowsecurity
    )
    or has_table_privilege('anon', 'public.video_transcripts', 'SELECT')
    or has_table_privilege('authenticated', 'public.video_transcripts', 'SELECT')
    or not has_table_privilege('service_role', 'public.video_transcripts', 'SELECT')
    or not has_table_privilege('service_role', 'public.video_transcripts', 'INSERT')
    or not has_table_privilege('service_role', 'public.video_transcripts', 'UPDATE')
  then
    raise exception 'REGRESSION: Transcript table access boundary drifted';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'video_transcripts'
      and roles && array['anon', 'authenticated']::name[]
  ) then
    raise exception 'REGRESSION: browser Transcript policy remains exposed';
  end if;

  set local role service_role;
  select count(*) into service_transcript_count
  from public.video_transcripts
  where video_id = '92000000-0000-4000-8000-000000000001';
  reset role;
  if service_transcript_count <> 1 then
    raise exception 'REGRESSION: service role cannot read the Transcript cache';
  end if;

  set local role anon;
  begin
    execute 'select count(*) from public.video_transcripts';
    raise exception 'REGRESSION: anon role enumerated Transcripts directly';
  exception when insufficient_privilege then
    null;
  end;
  reset role;

  -- Direct authenticated table reads must fail, while the owner-scoped RPC
  -- still returns the learner's own History projection.
  set local role authenticated;
  perform set_config(
    'request.jwt.claim.sub',
    '91000000-0000-4000-8000-000000000001',
    true
  );
  begin
    execute 'select count(*) from public.videos';
    raise exception 'REGRESSION: authenticated role enumerated Videos directly';
  exception when insufficient_privilege then
    null;
  end;
  begin
    execute 'select count(*) from public.video_transcripts';
    raise exception 'REGRESSION: authenticated role enumerated Transcripts directly';
  exception when insufficient_privilege then
    null;
  end;

  history_result := public.list_user_video_history(
    '91000000-0000-4000-8000-000000000001',
    1,
    25
  );
  if history_result->>'outcome' <> 'resolved'
    or jsonb_array_length(history_result->'rows') <> 1
    or history_result->'rows'->0->>'youtubeVideoId' <> expected_id then
    raise exception 'REGRESSION: owner History RPC did not return canonical identity';
  end if;
  reset role;
end;
$$;

delete from public.summaries
where video_id = '92000000-0000-4000-8000-000000000001';
delete from public.user_video_history
where user_id = '91000000-0000-4000-8000-000000000001';
delete from public.videos
where id = '92000000-0000-4000-8000-000000000001';
delete from auth.users
where id = '91000000-0000-4000-8000-000000000001';

commit;
