-- Canonical Project-wide user-turn ordinals are durable and content-free.
-- They do not shift when a thread is cleared/deleted, and the trigger's
-- transaction advisory lock makes assignment independent of thread or caller.

begin;

-- Fence every insert before taking the backfill snapshot. Inserts already in
-- flight commit before this lock is granted; later inserts wait for the trigger.
lock table public.project_conversation_messages in share row exclusive mode;
create table public.project_message_analytics_ordinals (
  user_message_id uuid primary key
    references public.project_conversation_messages(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  message_ordinal bigint not null check (message_ordinal > 0),
  created_at timestamptz not null default now(),
  constraint project_message_analytics_ordinals_project_key
    unique (project_id, message_ordinal)
);

alter table public.project_message_analytics_ordinals enable row level security;
revoke all on table public.project_message_analytics_ordinals
  from public, anon, authenticated, service_role;

insert into public.project_message_analytics_ordinals (
  user_message_id,
  project_id,
  message_ordinal,
  created_at
)
select
  ordered.user_message_id,
  ordered.project_id,
  ordered.message_ordinal,
  ordered.created_at
from (
  select
    messages.id as user_message_id,
    conversations.project_id,
    row_number() over (
      partition by conversations.project_id
      order by messages.created_at, messages.id
    )::bigint as message_ordinal,
    messages.created_at
  from public.project_conversation_messages as messages
  join public.project_conversations as conversations
    on conversations.id = messages.conversation_id
  where messages.role = 'user'
) as ordered;

create or replace function project_private.stamp_project_message_analytics_ordinal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owning_project_id uuid;
  next_ordinal bigint;
begin
  if new.role <> 'user' then return new; end if;

  select conversations.project_id
  into owning_project_id
  from public.project_conversations as conversations
  where conversations.id = new.conversation_id;
  if owning_project_id is null then return new; end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'project-message-analytics-ordinal:' || owning_project_id::text,
      0
    )
  );
  select coalesce(max(ordinals.message_ordinal), 0) + 1
  into next_ordinal
  from public.project_message_analytics_ordinals as ordinals
  where ordinals.project_id = owning_project_id;

  insert into public.project_message_analytics_ordinals (
    user_message_id,
    project_id,
    message_ordinal,
    created_at
  ) values (
    new.id,
    owning_project_id,
    next_ordinal,
    new.created_at
  ) on conflict (user_message_id) do nothing;
  return new;
end;
$$;

revoke execute on function project_private.stamp_project_message_analytics_ordinal()
  from public, anon, authenticated, service_role;

create trigger stamp_project_message_analytics_ordinal
after insert on public.project_conversation_messages
for each row
when (new.role = 'user')
execute function project_private.stamp_project_message_analytics_ordinal();

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
begin
  begin
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

  if canonical_ordinal between 1 and 1000000 then
    return p_message || jsonb_build_object(
      'messageOrdinal', canonical_ordinal
    );
  end if;
  return p_message;
end;
$$;

revoke execute on function
  project_private.with_project_message_analytics_ordinal(jsonb)
  from public, anon, authenticated, service_role;

commit;
