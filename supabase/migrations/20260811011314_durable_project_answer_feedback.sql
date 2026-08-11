-- One immutable, content-free feedback decision per durable Grounded Answer.

create table public.project_answer_feedback (
  answer_id uuid primary key
    references public.project_conversation_messages(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null,
  user_message_id uuid not null
    references public.project_conversation_messages(id) on delete cascade,
  message_ordinal bigint not null check (message_ordinal between 1 and 1000000),
  rating text not null check (rating in ('helpful', 'not_helpful')),
  created_at timestamptz not null default now(),
  constraint project_answer_feedback_project_ordinal_key
    unique (project_id, message_ordinal)
);

alter table public.project_answer_feedback enable row level security;
revoke all on table public.project_answer_feedback
  from public, anon, authenticated, service_role;

create function public.record_project_answer_feedback(
  p_project_id uuid,
  p_answer_id uuid,
  p_rating text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_user_id uuid := auth.uid();
  project_owner_id uuid;
  canonical_user_message_id uuid;
  canonical_ordinal bigint;
  inserted_answer_id uuid;
  durable_rating text;
begin
  if request_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if p_rating not in ('helpful', 'not_helpful') then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  select
    workspaces.owner_id,
    answers.in_reply_to_message_id,
    ordinals.message_ordinal
  into project_owner_id, canonical_user_message_id, canonical_ordinal
  from public.project_conversation_messages as answers
  join public.project_conversations as conversations
    on conversations.id = answers.conversation_id
  join public.projects
    on projects.id = conversations.project_id
  join public.workspaces
    on workspaces.id = projects.workspace_id
  join public.project_conversation_messages as questions
    on questions.id = answers.in_reply_to_message_id
    and questions.conversation_id = answers.conversation_id
    and questions.role = 'user'
  join public.project_message_analytics_ordinals as ordinals
    on ordinals.user_message_id = questions.id
    and ordinals.project_id = projects.id
  where projects.id = p_project_id
    and answers.id = p_answer_id
    and answers.role = 'assistant'
    and answers.completed_at is not null;

  if project_owner_id is null or project_owner_id <> request_user_id then
    return jsonb_build_object('outcome', 'missing');
  end if;

  insert into public.project_answer_feedback (
    answer_id,
    project_id,
    owner_id,
    user_message_id,
    message_ordinal,
    rating
  ) values (
    p_answer_id,
    p_project_id,
    request_user_id,
    canonical_user_message_id,
    canonical_ordinal,
    p_rating
  )
  on conflict (answer_id) do nothing
  returning answer_id into inserted_answer_id;

  if inserted_answer_id is not null then
    return jsonb_build_object(
      'outcome', 'recorded',
      'rating', p_rating,
      'messageOrdinal', canonical_ordinal
    );
  end if;

  select feedback.rating, feedback.message_ordinal
  into durable_rating, canonical_ordinal
  from public.project_answer_feedback as feedback
  where feedback.answer_id = p_answer_id;

  return jsonb_build_object(
    'outcome', case
      when durable_rating = p_rating then 'deduplicated'
      else 'conflict'
    end,
    'rating', durable_rating,
    'messageOrdinal', canonical_ordinal
  );
end;
$$;

revoke all on function public.record_project_answer_feedback(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_project_answer_feedback(uuid, uuid, text)
  to authenticated;

create or replace function project_private.with_project_message_analytics_ordinal(
  p_message jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  canonical_ordinal bigint;
  canonical_user_message_id uuid;
  canonical_answer_id uuid;
  feedback_rating text;
  enriched_message jsonb;
begin
  begin
    canonical_answer_id := case
      when p_message ->> 'role' = 'assistant'
        then (p_message ->> 'id')::uuid
      else null
    end;
    canonical_user_message_id := case
      when p_message ->> 'role' = 'user'
        then (p_message ->> 'id')::uuid
      else (p_message ->> 'inReplyToMessageId')::uuid
    end;
  exception when invalid_text_representation then
    return p_message;
  end;

  select ordinals.message_ordinal into canonical_ordinal
  from public.project_message_analytics_ordinals as ordinals
  where ordinals.user_message_id = canonical_user_message_id;

  if canonical_ordinal not between 1 and 1000000 then
    return p_message;
  end if;

  enriched_message := p_message || jsonb_build_object(
    'messageOrdinal', canonical_ordinal
  );
  if canonical_answer_id is null then return enriched_message; end if;

  select feedback.rating into feedback_rating
  from public.project_answer_feedback as feedback
  where feedback.answer_id = canonical_answer_id;

  return case
    when feedback_rating is null then enriched_message
    else enriched_message || jsonb_build_object(
      'feedbackRating', feedback_rating
    )
  end;
end;
$$;

revoke execute on function
  project_private.with_project_message_analytics_ordinal(jsonb)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
