-- Run after every migration during legacy and fresh replays. Once either
-- Source Set table exists, service_role must never gain direct mutation
-- privileges that could bypass revision-aware RPCs.

-- Model Supabase's permissive service defaults before later Source Set tables
-- are created. Their own creation migrations must explicitly start closed.
alter default privileges in schema public
  grant insert, update, delete, truncate on tables to service_role;

do $$
begin
  if to_regclass('public.project_source_sets') is not null then
    if (
      has_table_privilege('service_role', 'public.project_source_sets', 'INSERT')
      or has_table_privilege('service_role', 'public.project_source_sets', 'UPDATE')
      or has_table_privilege('service_role', 'public.project_source_sets', 'DELETE')
      or has_table_privilege('service_role', 'public.project_source_sets', 'TRUNCATE')
    ) then
      raise exception
        'REGRESSION: intermediate migration grants service Source Set DML';
    end if;
  end if;

  if to_regclass('public.project_videos') is not null then
    if (
      has_table_privilege('service_role', 'public.project_videos', 'INSERT')
      or has_table_privilege('service_role', 'public.project_videos', 'UPDATE')
      or has_table_privilege('service_role', 'public.project_videos', 'DELETE')
      or has_table_privilege('service_role', 'public.project_videos', 'TRUNCATE')
    ) then
      raise exception
        'REGRESSION: intermediate migration grants service membership DML';
    end if;
  end if;

  -- The four-argument loader marks the forward #318 security boundary. From
  -- that migration onward, neither application role may bypass the owned and
  -- token-fenced RPC seams with direct Conversation DML.
  if to_regprocedure(
    'public.load_default_project_conversation(uuid,timestamptz,uuid,integer)'
  ) is not null then
    if (
      has_table_privilege('service_role', 'public.project_conversations', 'INSERT')
      or has_table_privilege('service_role', 'public.project_conversations', 'UPDATE')
      or has_table_privilege('service_role', 'public.project_conversations', 'DELETE')
      or has_table_privilege('service_role', 'public.project_conversation_messages', 'INSERT')
      or has_table_privilege('service_role', 'public.project_conversation_messages', 'UPDATE')
      or has_table_privilege('service_role', 'public.project_conversation_messages', 'DELETE')
      or has_table_privilege('authenticated', 'public.project_conversations', 'INSERT')
      or has_table_privilege('authenticated', 'public.project_conversation_messages', 'INSERT')
    ) then
      raise exception
        'REGRESSION: intermediate migration grants direct Conversation DML';
    end if;
  end if;
end;
$$;
