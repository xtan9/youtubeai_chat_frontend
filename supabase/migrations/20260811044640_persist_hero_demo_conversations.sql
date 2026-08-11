create schema if not exists chat_private;
revoke all on schema chat_private from public, anon, authenticated, service_role;
grant usage on schema chat_private to service_role;

create table chat_private.hero_demo_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  youtube_video_id text not null
    check (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  last_activity_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, youtube_video_id)
);

create table chat_private.hero_demo_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  ordinal bigint generated always as identity unique,
  conversation_id uuid not null
    references chat_private.hero_demo_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 100000),
  created_at timestamptz not null default clock_timestamp()
);

create index hero_demo_conversations_anonymous_retention_idx
  on chat_private.hero_demo_conversations (last_activity_at, user_id);
create index hero_demo_conversation_messages_context_idx
  on chat_private.hero_demo_conversation_messages (conversation_id, ordinal desc);

alter table chat_private.hero_demo_conversations enable row level security;
alter table chat_private.hero_demo_conversation_messages enable row level security;
revoke all on table
  chat_private.hero_demo_conversations,
  chat_private.hero_demo_conversation_messages
from public, anon, authenticated, service_role;

create function chat_private.hero_demo_conversation_id(
  p_user_id uuid,
  p_youtube_video_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
begin
  if p_user_id is null
    or p_youtube_video_id !~ '^[A-Za-z0-9_-]{11}$'
    or not exists (select 1 from auth.users where id = p_user_id)
  then
    return null;
  end if;

  insert into chat_private.hero_demo_conversations (
    user_id, youtube_video_id
  ) values (
    p_user_id, p_youtube_video_id
  )
  on conflict (user_id, youtube_video_id) do update
    set last_activity_at = clock_timestamp()
  returning id into v_conversation_id;

  return v_conversation_id;
end;
$$;

create function chat_private.load_hero_demo_conversation(
  p_user_id uuid,
  p_youtube_video_id text,
  p_message_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  messages jsonb;
begin
  if p_user_id is null
    or p_youtube_video_id !~ '^[A-Za-z0-9_-]{11}$'
    or p_message_limit not between 1 and 16
  then
    return jsonb_build_object('outcome', 'invalid', 'messages', '[]'::jsonb);
  end if;

  select conversation.id into v_conversation_id
  from chat_private.hero_demo_conversations as conversation
  join auth.users as owner on owner.id = conversation.user_id
  where conversation.user_id = p_user_id
    and conversation.youtube_video_id = p_youtube_video_id
    and (
      not owner.is_anonymous
      or conversation.last_activity_at >= clock_timestamp() - interval '30 days'
    );

  if v_conversation_id is null then
    delete from chat_private.hero_demo_conversations as conversation
    using auth.users as owner
    where conversation.user_id = p_user_id
      and conversation.youtube_video_id = p_youtube_video_id
      and owner.id = conversation.user_id
      and owner.is_anonymous
      and conversation.last_activity_at < clock_timestamp() - interval '30 days';
    return jsonb_build_object('outcome', 'ready', 'messages', '[]'::jsonb);
  end if;

  update chat_private.hero_demo_conversations
  set last_activity_at = clock_timestamp()
  where id = v_conversation_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', selected.id,
      'role', selected.role,
      'content', selected.content,
      'createdAt', selected.created_at
    ) order by selected.ordinal
  ), '[]'::jsonb)
  into messages
  from (
    select message.id, message.ordinal, message.role,
      message.content, message.created_at
    from chat_private.hero_demo_conversation_messages as message
    where message.conversation_id = v_conversation_id
    order by message.ordinal desc
    limit p_message_limit
  ) as selected;

  return jsonb_build_object('outcome', 'ready', 'messages', messages);
end;
$$;

create function chat_private.append_hero_demo_chat_turn(
  p_user_id uuid,
  p_youtube_video_id text,
  p_user_message text,
  p_assistant_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
begin
  if length(p_user_message) not between 1 and 100000
    or length(p_assistant_message) not between 1 and 100000
  then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  v_conversation_id := chat_private.hero_demo_conversation_id(
    p_user_id, p_youtube_video_id
  );
  if v_conversation_id is null then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  insert into chat_private.hero_demo_conversation_messages (
    conversation_id, role, content
  ) values
    (v_conversation_id, 'user', p_user_message),
    (v_conversation_id, 'assistant', p_assistant_message);

  return jsonb_build_object('outcome', 'stored');
end;
$$;

create function chat_private.append_hero_demo_chat_user_message(
  p_user_id uuid,
  p_youtube_video_id text,
  p_user_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
begin
  if length(p_user_message) not between 1 and 100000 then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  v_conversation_id := chat_private.hero_demo_conversation_id(
    p_user_id, p_youtube_video_id
  );
  if v_conversation_id is null then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  insert into chat_private.hero_demo_conversation_messages (
    conversation_id, role, content
  ) values (v_conversation_id, 'user', p_user_message);

  return jsonb_build_object('outcome', 'stored');
end;
$$;

create function chat_private.clear_hero_demo_conversation(
  p_user_id uuid,
  p_youtube_video_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if p_user_id is null or p_youtube_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  delete from chat_private.hero_demo_conversations
  where user_id = p_user_id and youtube_video_id = p_youtube_video_id;
  get diagnostics deleted_count = row_count;
  return jsonb_build_object('outcome', 'cleared', 'deletedConversations', deleted_count);
end;
$$;

create function chat_private.cleanup_inactive_anonymous_demo_conversations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from chat_private.hero_demo_conversations as conversation
  using auth.users as owner
  where owner.id = conversation.user_id
    and owner.is_anonymous
    and conversation.last_activity_at < clock_timestamp() - interval '30 days';
  get diagnostics deleted_count = row_count;
  return jsonb_build_object(
    'outcome', 'cleaned',
    'deletedConversations', deleted_count
  );
end;
$$;

create function public.load_hero_demo_conversation(
  p_user_id uuid,
  p_youtube_video_id text,
  p_message_limit integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_setting('role', true) <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return chat_private.load_hero_demo_conversation(
    p_user_id, p_youtube_video_id, p_message_limit
  );
end;
$$;

create function public.append_hero_demo_chat_turn(
  p_user_id uuid,
  p_youtube_video_id text,
  p_user_message text,
  p_assistant_message text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_setting('role', true) <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return chat_private.append_hero_demo_chat_turn(
    p_user_id, p_youtube_video_id, p_user_message, p_assistant_message
  );
end;
$$;

create function public.append_hero_demo_chat_user_message(
  p_user_id uuid,
  p_youtube_video_id text,
  p_user_message text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_setting('role', true) <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return chat_private.append_hero_demo_chat_user_message(
    p_user_id, p_youtube_video_id, p_user_message
  );
end;
$$;

create function public.clear_hero_demo_conversation(
  p_user_id uuid,
  p_youtube_video_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_setting('role', true) <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return chat_private.clear_hero_demo_conversation(
    p_user_id, p_youtube_video_id
  );
end;
$$;

create function public.cleanup_inactive_anonymous_demo_conversations()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_setting('role', true) <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return chat_private.cleanup_inactive_anonymous_demo_conversations();
end;
$$;

revoke all on all functions in schema chat_private
from public, anon, authenticated, service_role;
grant execute on all functions in schema chat_private to service_role;

revoke all on function public.load_hero_demo_conversation(uuid,text,integer)
from public, anon, authenticated, service_role;
revoke all on function public.append_hero_demo_chat_turn(uuid,text,text,text)
from public, anon, authenticated, service_role;
revoke all on function public.append_hero_demo_chat_user_message(uuid,text,text)
from public, anon, authenticated, service_role;
revoke all on function public.clear_hero_demo_conversation(uuid,text)
from public, anon, authenticated, service_role;
revoke all on function public.cleanup_inactive_anonymous_demo_conversations()
from public, anon, authenticated, service_role;

grant execute on function public.load_hero_demo_conversation(uuid,text,integer)
to service_role;
grant execute on function public.append_hero_demo_chat_turn(uuid,text,text,text)
to service_role;
grant execute on function public.append_hero_demo_chat_user_message(uuid,text,text)
to service_role;
grant execute on function public.clear_hero_demo_conversation(uuid,text)
to service_role;
grant execute on function public.cleanup_inactive_anonymous_demo_conversations()
to service_role;

notify pgrst, 'reload schema';
