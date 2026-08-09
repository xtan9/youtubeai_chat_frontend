-- Remove the staged dependency after each rollback assertion so the same
-- coherent incident snapshot can exercise the next inbound relationship.

select set_config(
  'test.identity_dependency_kind',
  :'dependency_kind',
  false
);

do $$
declare
  dependency_kind text := current_setting('test.identity_dependency_kind');
begin
  case dependency_kind
    when 'summary' then
      delete from public.summaries
      where id = 'b9990000-0000-4000-8000-000000000001';
    when 'history' then
      delete from public.user_video_history
      where id = 'b9990000-0000-4000-8000-000000000002';
    when 'project' then
      perform set_config('project_private.audit_skip', 'on', true);
      delete from public.project_videos
      where project_id = 'a3474000-0000-4000-8000-000000000001'
        and video_id = 'f83123c7-4e6a-4a95-9554-1978dac3e535';
      perform set_config('project_private.audit_skip', 'off', true);
    when 'chat' then
      delete from public.chat_messages
      where id = 'b9990000-0000-4000-8000-000000000003';
    when 'event' then
      delete from public.project_source_set_events
      where id = 'b9990000-0000-4000-8000-000000000004';
    else
      raise exception 'unsupported dependency fixture kind: %', dependency_kind;
  end case;
end;
$$;
