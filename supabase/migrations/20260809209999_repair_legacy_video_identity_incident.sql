-- Repair the three production rows that blocked canonical identity rollout.
-- The exact UUID/hash/URL fences make this a fail-closed data correction, not
-- a general-purpose attempt to guess identities from arbitrary legacy URLs.

do $repair_legacy_video_identity_incident$
declare
  redirect_id constant uuid := '8a37686a-e461-4388-a087-ac030d0bf7f0';
  redirect_hash constant text := '34aef0dd8636c55d3c23a6fa334b2001';
  redirect_video_id constant text := '_b1b-uMuzKQ';
  redirect_incident_url constant text := 'https://www.youtube.com/redirect?event=video_description&redir_token=QUFFLUhqa2psQ1R6aVdtR2R3eFczRnpZUDI2cmQxbUMzZ3xBQ3Jtc0tuNXU1UXowb2F2b3VzbkhHY0R4VWxsUDlwQjNMNUdqU0JqM2hEdEJoWTF3dVlWU3hsR2labDZsNDVfdERpTUVtcnBWYXY5bnlYVkUtcnE0eDlQUEN6eFhsRG5nY1YwSWtVMFdzZUg0RHFNZUQ0cFk1UQ&q=https%3A%2F%2Funogeeks.com%2Foracle-fusion-hcm-online-training%2F&v=_b1b-uMuzKQ';
  redirect_url text;
  redirect_transcript_snapshot jsonb;
  retained_redirect_transcript_snapshot jsonb;
  incident record;
  locked_video record;
  target_count integer := 0;
  transcript_count integer;
  summary_count integer;
  history_count integer;
  project_count integer;
  chat_count integer;
  event_count integer;
  changed_count integer;
  video_snapshot jsonb;
  transcript_snapshot jsonb;
  stored_video_snapshot jsonb;
  stored_transcript_snapshot jsonb;
begin
  -- When this deliberately backdated migration reaches a database where
  -- 20260809210000 is already recorded, its strict canonical trigger has
  -- already made the incident shape impossible. The guard and quarantine
  -- migrations remain safe additions; this data repair is a no-op.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'videos'
      and column_name = 'youtube_video_id'
  ) then
    if exists (
      select 1
      from public.videos
      where (
          id = redirect_id
          and url_hash = redirect_hash
          and youtube_url = redirect_incident_url
        )
        or (
          id = 'a456bf8d-5413-452c-82d2-6f4d6923101d'::uuid
          and url_hash = '9e45ba7aa82c74c496bbd9d412e8fe13'
          and youtube_url = 'https://youtube.com/@waseemiq1?si=WGN0uguYUo-ivemT'
        )
        or (
          id = 'f83123c7-4e6a-4a95-9554-1978dac3e535'::uuid
          and url_hash = '1ac8645240c853aba638dfba8364a9cf'
          and youtube_url = 'https://youtube.com/@richmovies-k3q?si=iolcO_gyLvcEMBYq'
        )
    ) then
      raise exception
        'canonical migration is recorded but an incident Video row remains';
    end if;
    return;
  end if;

  -- Lock only the observed parent rows, in UUID order. FK checks take KEY
  -- SHARE on these rows, so no new dependent reference can appear between
  -- the counts and deletes. Unrelated Videos and their dependents remain
  -- writable. Fail promptly rather than waiting indefinitely during deploy.
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  for locked_video in
    select videos.id
    from public.videos as videos
    where videos.id in (
      redirect_id,
      'a456bf8d-5413-452c-82d2-6f4d6923101d'::uuid,
      'f83123c7-4e6a-4a95-9554-1978dac3e535'::uuid
    )
    order by videos.id
    for update
  loop
    target_count := target_count + 1;
  end loop;

  if target_count not in (0, 3) then
    raise exception
      'legacy Video identity incident rows are only partially present: % of 3',
      target_count;
  end if;

  if target_count = 3 then
    select videos.youtube_url, to_jsonb(transcripts)
    into strict redirect_url, redirect_transcript_snapshot
    from public.videos as videos
    join public.video_transcripts as transcripts
      on transcripts.video_id = videos.id
    where videos.id = redirect_id
      and videos.url_hash = redirect_hash
    for update of transcripts;

    if not found
      or redirect_url is distinct from redirect_incident_url
    then
      raise exception 'recoverable redirect Video no longer matches its incident fence';
    end if;

    select
      (select count(*) from public.video_transcripts where video_id = redirect_id),
      (select count(*) from public.summaries where video_id = redirect_id),
      (select count(*) from public.user_video_history where video_id = redirect_id),
      (select count(*) from public.project_videos where video_id = redirect_id),
      (select count(*) from public.chat_messages where video_id = redirect_id),
      (select count(*) from public.project_source_set_events where video_id = redirect_id)
    into
      transcript_count,
      summary_count,
      history_count,
      project_count,
      chat_count,
      event_count;

    if transcript_count <> 1
      or summary_count <> 0
      or history_count <> 0
      or project_count <> 0
      or chat_count <> 0
      or event_count <> 0
    then
      raise exception
        'recoverable redirect dependency shape drifted (transcript %, summary %, history %, project %, chat %, event %)',
        transcript_count,
        summary_count,
        history_count,
        project_count,
        chat_count,
        event_count;
    end if;

    update public.videos
    set youtube_url = 'https://www.youtube.com/watch?v=' || redirect_video_id
    where id = redirect_id
      and url_hash = redirect_hash
      and youtube_url = redirect_url;
    get diagnostics changed_count = row_count;

    if changed_count <> 1 then
      raise exception 'recoverable redirect update did not affect exactly one row';
    end if;

    select to_jsonb(transcripts)
    into strict retained_redirect_transcript_snapshot
    from public.video_transcripts as transcripts
    where transcripts.video_id = redirect_id;

    if retained_redirect_transcript_snapshot
      is distinct from redirect_transcript_snapshot
    then
      raise exception 'recoverable redirect Transcript changed during repair';
    end if;

    for incident in
      select *
      from (values
        (
          'a456bf8d-5413-452c-82d2-6f4d6923101d'::uuid,
          'https://youtube.com/@waseemiq1?si=WGN0uguYUo-ivemT'::text,
          '9e45ba7aa82c74c496bbd9d412e8fe13'::text
        ),
        (
          'f83123c7-4e6a-4a95-9554-1978dac3e535'::uuid,
          'https://youtube.com/@richmovies-k3q?si=iolcO_gyLvcEMBYq'::text,
          '1ac8645240c853aba638dfba8364a9cf'::text
        )
      ) as incident_rows(video_id, youtube_url, url_hash)
    loop
      select to_jsonb(videos), to_jsonb(transcripts)
      into strict video_snapshot, transcript_snapshot
      from public.videos as videos
      join public.video_transcripts as transcripts
        on transcripts.video_id = videos.id
      where videos.id = incident.video_id
        and videos.youtube_url = incident.youtube_url
        and videos.url_hash = incident.url_hash
      for update of videos, transcripts;

      if not found then
        raise exception
          'unrecoverable channel Video % no longer matches its incident fence',
          incident.video_id;
      end if;

      select
        (select count(*) from public.video_transcripts where video_id = incident.video_id),
        (select count(*) from public.summaries where video_id = incident.video_id),
        (select count(*) from public.user_video_history where video_id = incident.video_id),
        (select count(*) from public.project_videos where video_id = incident.video_id),
        (select count(*) from public.chat_messages where video_id = incident.video_id),
        (select count(*) from public.project_source_set_events where video_id = incident.video_id)
      into
        transcript_count,
        summary_count,
        history_count,
        project_count,
        chat_count,
        event_count;

      if transcript_count <> 1
        or summary_count <> 0
        or history_count <> 0
        or project_count <> 0
        or chat_count <> 0
        or event_count <> 0
      then
        raise exception
          'unrecoverable channel Video % dependency shape drifted (transcript %, summary %, history %, project %, chat %, event %)',
          incident.video_id,
          transcript_count,
          summary_count,
          history_count,
          project_count,
          chat_count,
          event_count;
      end if;

      insert into project_private.legacy_video_identity_quarantine (
        video_id,
        reason,
        video_snapshot,
        transcript_snapshot
      )
      values (
        incident.video_id,
        'unsupported_channel_url',
        video_snapshot,
        transcript_snapshot
      );

      select quarantine.video_snapshot, quarantine.transcript_snapshot
      into strict stored_video_snapshot, stored_transcript_snapshot
      from project_private.legacy_video_identity_quarantine as quarantine
      where quarantine.video_id = incident.video_id;

      if stored_video_snapshot is distinct from video_snapshot
        or stored_transcript_snapshot is distinct from transcript_snapshot
      then
        raise exception
          'quarantine snapshot verification failed for Video %',
          incident.video_id;
      end if;

      delete from public.videos
      where id = incident.video_id
        and youtube_url = incident.youtube_url
        and url_hash = incident.url_hash;
      get diagnostics changed_count = row_count;

      if changed_count <> 1
        or exists (select 1 from public.video_transcripts where video_id = incident.video_id)
      then
        raise exception
          'active incident Video % was not removed atomically',
          incident.video_id;
      end if;
    end loop;

    if retained_redirect_transcript_snapshot
        is distinct from redirect_transcript_snapshot
      or not exists (
      select 1
      from public.videos
      join public.video_transcripts
        on video_transcripts.video_id = videos.id
      where videos.id = redirect_id
        and videos.youtube_url = 'https://www.youtube.com/watch?v=' || redirect_video_id
        and videos.url_hash = redirect_hash
    ) then
      raise exception 'recoverable redirect Video or Transcript was not preserved';
    end if;
  end if;

  if exists (
    select 1
    from public.videos
    where not coalesce(
      project_private.is_precanonical_youtube_identity(youtube_url),
      false
    )
  ) then
    raise exception 'unsupported active Video URL remains after incident repair';
  end if;
end;
$repair_legacy_video_identity_incident$;
