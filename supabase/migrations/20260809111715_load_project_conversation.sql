-- Load the latest bounded window of the owned default Conversation without
-- exposing completion attempt tokens or raw Evidence Snapshot passage text.

create function public.load_default_project_conversation(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  researcher_id uuid := auth.uid();
  request_role text := current_setting('role', true);
  request_jwt jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_conversation_id uuid;
  messages jsonb := '[]'::jsonb;
  messages_used integer := 0;
  owner_tier text;
  unlimited boolean := false;
begin
  if request_role <> 'authenticated' or researcher_id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;

  if not exists (
    select 1
    from public.projects
    join public.workspaces on workspaces.id = projects.workspace_id
    where projects.id = p_project_id
      and workspaces.owner_id = researcher_id
  ) then
    return jsonb_build_object('outcome', 'missing');
  end if;

  select tier
  into owner_tier
  from public.user_subscriptions
  where user_id = researcher_id;

  unlimited := coalesce(owner_tier, 'free') = 'pro'
    or (
      request_jwt ->> 'sub' = researcher_id::text
      and request_jwt @> '{
        "app_metadata": {
          "is_smoke_account": true,
          "smoke_entitlement": "pro"
        }
      }'::jsonb
    );

  select id
  into v_conversation_id
  from public.project_conversations
  where project_id = p_project_id
    and kind = 'default';

  if v_conversation_id is not null then
    select count(*)::integer
    into messages_used
    from public.project_conversation_messages
    where project_conversation_messages.conversation_id = v_conversation_id
      and role = 'user';

    select coalesce(jsonb_agg(message order by created_at, id), '[]'::jsonb)
    into messages
    from (
      select
        jsonb_build_object(
          'id', project_conversation_messages.id,
          'inReplyToMessageId', project_conversation_messages.in_reply_to_message_id,
          'role', project_conversation_messages.role,
          'content', project_conversation_messages.content,
          'answerClassification', project_conversation_messages.answer_classification,
          'sourceSetRevision', project_conversation_messages.source_set_revision,
          'sourceManifest', project_conversation_messages.source_manifest,
          'sourceCoverage', project_conversation_messages.source_coverage,
          'citationDiagnostics', project_conversation_messages.citation_diagnostics,
          'createdAt', project_conversation_messages.created_at
        ) as message,
        project_conversation_messages.created_at,
        project_conversation_messages.id
      from public.project_conversation_messages
      where project_conversation_messages.conversation_id = v_conversation_id
      order by project_conversation_messages.created_at desc,
        project_conversation_messages.id desc
      limit 100
    ) as recent;
  end if;

  return jsonb_build_object(
    'outcome', 'ready',
    'conversationId', v_conversation_id,
    'messages', messages,
    'messagesUsed', messages_used,
    'messagesLimit', case when unlimited then null else 5 end,
    'tier', case when unlimited then 'pro' else 'free' end
  );
end;
$$;

revoke all on function public.load_default_project_conversation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.load_default_project_conversation(uuid)
  to authenticated;

notify pgrst, 'reload schema';
