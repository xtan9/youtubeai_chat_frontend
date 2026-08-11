create table public.registered_free_hero_demo_ledgers (
  user_id uuid not null references auth.users(id) on delete restrict,
  youtube_video_id text not null
    check (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  messages_admitted integer not null default 0
    check (messages_admitted between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, youtube_video_id)
);

alter table public.registered_free_hero_demo_ledgers enable row level security;

create policy registered_free_hero_demo_ledgers_service_role
  on public.registered_free_hero_demo_ledgers
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.registered_free_hero_demo_ledgers
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.registered_free_hero_demo_ledgers
  to service_role;

create function public.get_registered_free_hero_demo_chat_allowance(
  p_user_id uuid,
  p_youtube_video_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_count integer;
begin
  if p_youtube_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'Invalid canonical YouTube Video identity'
      using errcode = '22023';
  end if;

  select messages_admitted
  into current_count
  from public.registered_free_hero_demo_ledgers
  where user_id = p_user_id
    and youtube_video_id = p_youtube_video_id;

  return jsonb_build_object(
    'outcome', 'available',
    'remainingMessages', greatest(0, 5 - coalesce(current_count, 0))
  );
end;
$$;

create function public.admit_registered_free_hero_demo_chat_message(
  p_user_id uuid,
  p_youtube_video_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_count integer;
begin
  if p_youtube_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'Invalid canonical YouTube Video identity'
      using errcode = '22023';
  end if;

  insert into public.registered_free_hero_demo_ledgers (
    user_id,
    youtube_video_id
  )
  values (p_user_id, p_youtube_video_id)
  on conflict (user_id, youtube_video_id) do nothing;

  select messages_admitted
  into current_count
  from public.registered_free_hero_demo_ledgers
  where user_id = p_user_id
    and youtube_video_id = p_youtube_video_id
  for update;

  if current_count >= 5 then
    return jsonb_build_object(
      'outcome', 'exhausted',
      'remainingMessages', 0
    );
  end if;

  current_count := current_count + 1;
  update public.registered_free_hero_demo_ledgers
  set messages_admitted = current_count,
      updated_at = clock_timestamp()
  where user_id = p_user_id
    and youtube_video_id = p_youtube_video_id;

  return jsonb_build_object(
    'outcome', 'admitted',
    'remainingMessages', 5 - current_count
  );
end;
$$;

revoke all on function public.get_registered_free_hero_demo_chat_allowance(uuid, text)
  from public, anon, authenticated;
revoke all on function public.admit_registered_free_hero_demo_chat_message(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_registered_free_hero_demo_chat_allowance(uuid, text)
  to service_role;
grant execute on function public.admit_registered_free_hero_demo_chat_message(uuid, text)
  to service_role;
