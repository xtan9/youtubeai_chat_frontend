-- Hero Demo Video conversation contract: identity/demo isolation, bounded
-- context, in-place anonymous conversion, and retention independent of quota.

begin;

insert into auth.users (id, is_anonymous) values
  ('37600000-0000-4000-8000-000000000001', true),
  ('37600000-0000-4000-8000-000000000002', true)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

set local role service_role;

-- Establish retained Anonymous Trial usage before touching visible history.
select public.reserve_anonymous_trial_chat_message(
  '37600000-0000-4000-8000-000000000001'
);

select public.append_hero_demo_chat_turn(
  '37600000-0000-4000-8000-000000000001', 'Hrbq66XqtCo',
  'How does alpha begin?', 'It begins with alpha evidence.'
);
select public.append_hero_demo_chat_turn(
  '37600000-0000-4000-8000-000000000001', 'nm1TxQj9IsQ',
  'How does beta begin?', 'It begins with beta evidence.'
);
select public.append_hero_demo_chat_turn(
  '37600000-0000-4000-8000-000000000002', 'Hrbq66XqtCo',
  'What did the other learner ask?', 'Only this learner can see this turn.'
);

create temporary table demo_a_history as
select public.load_hero_demo_conversation(
  '37600000-0000-4000-8000-000000000001', 'Hrbq66XqtCo', 16
) as result;
create temporary table demo_b_history as
select public.load_hero_demo_conversation(
  '37600000-0000-4000-8000-000000000001', 'nm1TxQj9IsQ', 16
) as result;
create temporary table other_identity_history as
select public.load_hero_demo_conversation(
  '37600000-0000-4000-8000-000000000002', 'Hrbq66XqtCo', 16
) as result;

reset role;

do $$
begin
  if jsonb_array_length((select result -> 'messages' from demo_a_history)) <> 2
    or (select result -> 'messages' -> 0 ->> 'content' from demo_a_history)
      <> 'How does alpha begin?'
    or jsonb_array_length((select result -> 'messages' from demo_b_history)) <> 2
    or (select result -> 'messages' -> 0 ->> 'content' from demo_b_history)
      <> 'How does beta begin?'
    or (select result -> 'messages' -> 0 ->> 'content' from other_identity_history)
      <> 'What did the other learner ask?'
  then
    raise exception 'REGRESSION: Hero Demo histories crossed identity/demo boundaries';
  end if;
end;
$$;

-- Conversion links an identity to the same auth user. No message ownership is
-- copied or rewritten, and existing Anonymous Trial usage remains separate.
update auth.users
set is_anonymous = false
where id = '37600000-0000-4000-8000-000000000001';

set local role service_role;
create temporary table converted_history as
select public.load_hero_demo_conversation(
  '37600000-0000-4000-8000-000000000001', 'Hrbq66XqtCo', 16
) as result;
create temporary table converted_registered_allowances as
select youtube_video_id,
  public.get_registered_free_hero_demo_chat_allowance(
    '37600000-0000-4000-8000-000000000001', youtube_video_id
  ) as result
from (values ('Hrbq66XqtCo'), ('nm1TxQj9IsQ')) as demos(youtube_video_id);
select public.clear_hero_demo_conversation(
  '37600000-0000-4000-8000-000000000001', 'Hrbq66XqtCo'
);
create temporary table cleared_history as
select public.load_hero_demo_conversation(
  '37600000-0000-4000-8000-000000000001', 'Hrbq66XqtCo', 16
) as result;
create temporary table quota_after_clear as
select public.get_anonymous_trial_chat_allowance(
  '37600000-0000-4000-8000-000000000001'
) as result;
reset role;

do $$
begin
  if jsonb_array_length((select result -> 'messages' from converted_history)) <> 2
    or exists (
      select 1
      from converted_registered_allowances
      where result <> '{"outcome":"available","remainingMessages":5}'::jsonb
    )
    or (select count(*) from converted_registered_allowances) <> 2
    or jsonb_array_length((select result -> 'messages' from cleared_history)) <> 0
    or (select result ->> 'remainingMessages' from quota_after_clear)::integer <> 4
    or exists (
      select 1
      from chat_private.hero_demo_conversation_messages as message
      join chat_private.hero_demo_conversations as conversation
        on conversation.id = message.conversation_id
      where conversation.user_id <> '37600000-0000-4000-8000-000000000002'
        and conversation.youtube_video_id = 'Hrbq66XqtCo'
    )
  then
    raise exception 'REGRESSION: conversion did not preserve history and grant fresh per-demo Registered Free allowance';
  end if;
end;
$$;

-- Anonymous inactivity expiry removes only visible history. The durable usage
-- ledger is deliberately retained and cannot be reset by cleanup.
update chat_private.hero_demo_conversations
set last_activity_at = clock_timestamp() - interval '29 days'
where user_id = '37600000-0000-4000-8000-000000000002';

set local role service_role;
select public.load_hero_demo_conversation(
  '37600000-0000-4000-8000-000000000002', 'Hrbq66XqtCo', 16
);
reset role;

do $$
begin
  if (select last_activity_at < clock_timestamp() - interval '1 minute'
      from chat_private.hero_demo_conversations
      where user_id = '37600000-0000-4000-8000-000000000002'
        and youtube_video_id = 'Hrbq66XqtCo') then
    raise exception 'REGRESSION: returning to history did not refresh activity';
  end if;
end;
$$;

update chat_private.hero_demo_conversations
set last_activity_at = clock_timestamp() - interval '31 days'
where user_id = '37600000-0000-4000-8000-000000000002';

set local role service_role;
create temporary table cleanup_result as
select public.cleanup_inactive_anonymous_demo_conversations(500) as result;
create temporary table expired_history as
select public.load_hero_demo_conversation(
  '37600000-0000-4000-8000-000000000002', 'Hrbq66XqtCo', 16
) as result;
reset role;

do $$
begin
  if (select result ->> 'deletedConversations' from cleanup_result)::integer <> 1
    or jsonb_array_length((select result -> 'messages' from expired_history)) <> 0
    or (select messages_reserved from public.anonymous_trial_ledgers
        where user_id = '37600000-0000-4000-8000-000000000001') <> 1
  then
    raise exception 'REGRESSION: anonymous retention cleanup changed quota';
  end if;
end;
$$;

-- The browser roles cannot enumerate or mutate another Learner's history.
do $$
begin
  if has_schema_privilege('anon', 'chat_private', 'usage')
    or has_schema_privilege('authenticated', 'chat_private', 'usage')
    or has_table_privilege('service_role', 'chat_private.hero_demo_conversations', 'insert')
    or has_function_privilege(
      'service_role',
      'chat_private.load_hero_demo_conversation(uuid,text,integer)',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.load_hero_demo_conversation(uuid,text,integer)',
      'execute'
    )
  then
    raise exception 'REGRESSION: Hero Demo history bypasses server ownership boundary';
  end if;
end;
$$;

do $$
begin
  if not has_function_privilege(
       'service_role',
       'public.cleanup_inactive_anonymous_demo_conversations(integer)',
       'execute'
     ) or has_function_privilege(
       'authenticated',
       'public.cleanup_inactive_anonymous_demo_conversations(integer)',
       'execute'
     ) then
    raise exception 'REGRESSION: cleanup bridge grants drifted';
  end if;
end;
$$;

rollback;
