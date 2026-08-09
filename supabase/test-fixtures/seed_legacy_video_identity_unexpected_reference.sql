-- Add one dependency to the second channel row so the repair has already
-- moved the first row before it fails. CI invokes this once per inbound
-- relationship kind.

select set_config(
  'test.identity_dependency_kind',
  :'dependency_kind',
  false
);

do $$
declare
  dependency_kind text := current_setting('test.identity_dependency_kind');
  target_video constant uuid := 'f83123c7-4e6a-4a95-9554-1978dac3e535';
begin
  case dependency_kind
    when 'summary' then
      insert into public.summaries (
        id,
        video_id,
        summary,
        transcript_source,
        output_language
      )
      values (
        'b9990000-0000-4000-8000-000000000001',
        target_video,
        'Unexpected dependency must abort the repair.',
        'manual_captions',
        null
      );
    when 'history' then
      insert into public.user_video_history (
        id,
        user_id,
        video_id,
        accessed_at
      )
      values (
        'b9990000-0000-4000-8000-000000000002',
        'a3471000-0000-4000-8000-000000000001',
        target_video,
        '2026-08-07T00:00:00Z'
      );
    when 'project' then
      perform set_config('project_private.audit_skip', 'on', true);
      insert into public.project_videos (
        project_id,
        video_id,
        position,
        status
      )
      values (
        'a3474000-0000-4000-8000-000000000001',
        target_video,
        4,
        'ready'
      );
      perform set_config('project_private.audit_skip', 'off', true);
    when 'chat' then
      insert into public.chat_messages (id, user_id, video_id, role, content)
      values (
        'b9990000-0000-4000-8000-000000000003',
        'a3471000-0000-4000-8000-000000000001',
        target_video,
        'user',
        'Unexpected Chat dependency must abort the repair.'
      );
    when 'event' then
      insert into public.project_source_set_events (
        id,
        project_id,
        revision,
        event_kind,
        video_id,
        video_title,
        to_position,
        to_status
      )
      values (
        'b9990000-0000-4000-8000-000000000004',
        'a3474000-0000-4000-8000-000000000001',
        100,
        'added',
        target_video,
        'Unexpected event dependency',
        5,
        'ready'
      );
    else
      raise exception 'unsupported dependency fixture kind: %', dependency_kind;
  end case;
end;
$$;
