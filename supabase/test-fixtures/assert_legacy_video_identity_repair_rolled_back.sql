-- Run after 20260809209999 fails on the staged unexpected dependency.

select set_config(
  'test.identity_dependency_kind',
  :'dependency_kind',
  false
);

do $$
declare
  dependency_kind text := current_setting('test.identity_dependency_kind');
  dependency_preserved boolean;
begin
  dependency_preserved := case dependency_kind
    when 'summary' then exists (
      select 1 from public.summaries
      where id = 'b9990000-0000-4000-8000-000000000001'
    )
    when 'history' then exists (
      select 1 from public.user_video_history
      where id = 'b9990000-0000-4000-8000-000000000002'
    )
    when 'project' then exists (
      select 1 from public.project_videos
      where project_id = 'a3474000-0000-4000-8000-000000000001'
        and video_id = 'f83123c7-4e6a-4a95-9554-1978dac3e535'
    )
    when 'chat' then exists (
      select 1 from public.chat_messages
      where id = 'b9990000-0000-4000-8000-000000000003'
    )
    when 'event' then exists (
      select 1 from public.project_source_set_events
      where id = 'b9990000-0000-4000-8000-000000000004'
    )
    else false
  end;

  if (select count(*) from public.videos where id in (
      '8a37686a-e461-4388-a087-ac030d0bf7f0',
      'a456bf8d-5413-452c-82d2-6f4d6923101d',
      'f83123c7-4e6a-4a95-9554-1978dac3e535'
    )) <> 3
    or not exists (
      select 1
      from public.videos
      where id = '8a37686a-e461-4388-a087-ac030d0bf7f0'
        and youtube_url = 'https://www.youtube.com/redirect?event=video_description&redir_token=QUFFLUhqa2psQ1R6aVdtR2R3eFczRnpZUDI2cmQxbUMzZ3xBQ3Jtc0tuNXU1UXowb2F2b3VzbkhHY0R4VWxsUDlwQjNMNUdqU0JqM2hEdEJoWTF3dVlWU3hsR2labDZsNDVfdERpTUVtcnBWYXY5bnlYVkUtcnE0eDlQUEN6eFhsRG5nY1YwSWtVMFdzZUg0RHFNZUQ0cFk1UQ&q=https%3A%2F%2Funogeeks.com%2Foracle-fusion-hcm-online-training%2F&v=_b1b-uMuzKQ'
    )
    or (select count(*) from public.video_transcripts where video_id in (
      '8a37686a-e461-4388-a087-ac030d0bf7f0',
      'a456bf8d-5413-452c-82d2-6f4d6923101d',
      'f83123c7-4e6a-4a95-9554-1978dac3e535'
    )) <> 3
    or not dependency_preserved
    or exists (
      select 1
      from project_private.legacy_video_identity_quarantine
      where video_id in (
        'a456bf8d-5413-452c-82d2-6f4d6923101d',
        'f83123c7-4e6a-4a95-9554-1978dac3e535'
      )
    )
  then
    raise exception 'REGRESSION: failed identity repair left partial changes';
  end if;
end;
$$;
