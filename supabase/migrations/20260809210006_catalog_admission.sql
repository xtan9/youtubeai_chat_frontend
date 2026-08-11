-- Admit independently verified public Videos into the server-owned Catalog.
-- Shared resources live in an unexposed schema; public RPCs are thin
-- SECURITY INVOKER bridges executable only by service_role.

create extension if not exists pgmq cascade;

do $$
begin
  if to_regclass('pgmq.q_catalog_admission') is null then
    perform pgmq.create('catalog_admission');
  end if;
end;
$$;

alter table public.videos
  add column if not exists channel_id text,
  add column if not exists thumbnail_url text,
  add column if not exists default_language text,
  add column if not exists duration_seconds double precision,
  add column if not exists published_at timestamptz,
  add column if not exists privacy_status text,
  add column if not exists embeddable boolean,
  add column if not exists live_status text,
  add column if not exists age_restricted boolean,
  add column if not exists provider_evidence_path text,
  add column if not exists provider_verified_at timestamptz,
  add column if not exists provider_evidence_expires_at timestamptz,
  add column if not exists catalog_state text not null default 'inactive',
  add column if not exists catalog_inactive_reason text;

alter table public.videos
  drop constraint if exists videos_duration_seconds_check,
  add constraint videos_duration_seconds_check
    check (duration_seconds is null or duration_seconds >= 0),
  drop constraint if exists videos_privacy_status_check,
  add constraint videos_privacy_status_check
    check (privacy_status is null or privacy_status in ('public', 'private', 'unlisted')),
  drop constraint if exists videos_live_status_check,
  add constraint videos_live_status_check
    check (live_status is null or live_status in ('none', 'live', 'upcoming')),
  drop constraint if exists videos_catalog_state_check,
  add constraint videos_catalog_state_check
    check (catalog_state in ('inactive', 'active')),
  drop constraint if exists videos_catalog_inactive_reason_check,
  add constraint videos_catalog_inactive_reason_check check (
    catalog_inactive_reason is null or catalog_inactive_reason in (
      'not_public', 'not_embeddable', 'live', 'upcoming',
      'age_restricted', 'stale_evidence', 'unsupported_provider',
      'unavailable'
    )
  );

create schema if not exists catalog_private;
revoke all on schema catalog_private from public, anon, authenticated;
grant usage on schema catalog_private to service_role;

create table catalog_private.catalog_nominations (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null unique references public.videos(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'admitted', 'inactive', 'exhausted')),
  nominated_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  last_failure_code text
);

create table catalog_private.youtube_provider_evidence (
  id uuid primary key default gen_random_uuid(),
  nomination_id uuid not null
    references catalog_private.catalog_nominations(id) on delete restrict,
  video_id uuid not null references public.videos(id) on delete restrict,
  idempotency_key text not null unique,
  provider_outcome text not null
    check (provider_outcome in ('verified', 'absent')),
  provider_path text not null,
  youtube_video_id text not null,
  title text,
  channel_id text,
  channel_name text,
  thumbnail_url text,
  default_language text,
  duration_seconds double precision check (duration_seconds >= 0),
  published_at timestamptz,
  privacy_status text
    check (privacy_status in ('public', 'private', 'unlisted')),
  embeddable boolean,
  live_status text check (live_status in ('none', 'live', 'upcoming')),
  age_restricted boolean,
  provider_verified_at timestamptz not null,
  evidence_expires_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (evidence_expires_at > provider_verified_at),
  check (
    (
      provider_outcome = 'verified'
      and title is not null
      and channel_id is not null
      and channel_name is not null
      and duration_seconds is not null
      and published_at is not null
      and privacy_status is not null
      and embeddable is not null
      and live_status is not null
      and age_restricted is not null
    )
    or (
      provider_outcome = 'absent'
      and title is null
      and channel_id is null
      and channel_name is null
      and duration_seconds is null
      and published_at is null
      and privacy_status is null
      and embeddable is null
      and live_status is null
      and age_restricted is null
    )
  )
);

create index youtube_provider_evidence_video_freshness_idx
  on catalog_private.youtube_provider_evidence (
    video_id, evidence_expires_at desc
  );

create table catalog_private.catalog_admissions (
  id uuid primary key default gen_random_uuid(),
  nomination_id uuid not null
    references catalog_private.catalog_nominations(id) on delete restrict,
  video_id uuid not null references public.videos(id) on delete restrict,
  provider_evidence_id uuid not null
    references catalog_private.youtube_provider_evidence(id) on delete restrict,
  idempotency_key text not null unique,
  policy_version text not null,
  decision text not null check (decision in ('admitted', 'inactive')),
  reason_code text check (
    reason_code is null or reason_code in (
      'not_public', 'not_embeddable', 'live', 'upcoming',
      'age_restricted', 'stale_evidence', 'unsupported_provider',
      'unavailable'
    )
  ),
  decided_at timestamptz not null default clock_timestamp(),
  check (
    (decision = 'admitted' and reason_code is null)
    or (decision = 'inactive' and reason_code is not null)
  )
);

create index catalog_admissions_video_decided_idx
  on catalog_private.catalog_admissions (video_id, decided_at desc);

create table catalog_private.catalog_admission_dead_letters (
  id uuid primary key default gen_random_uuid(),
  queue_message_id bigint not null unique,
  nomination_id uuid references catalog_private.catalog_nominations(id)
    on delete restrict,
  idempotency_key text,
  attempts integer not null check (attempts > 0),
  failure_code text not null check (
    failure_code in (
      'provider_timeout', 'provider_non_ok', 'provider_schema',
      'provider_error', 'worker_error', 'invalid_message'
    )
  ),
  exhausted_at timestamptz not null default clock_timestamp()
);

alter table catalog_private.catalog_nominations enable row level security;
alter table catalog_private.youtube_provider_evidence enable row level security;
alter table catalog_private.catalog_admissions enable row level security;
alter table catalog_private.catalog_admission_dead_letters enable row level security;
alter table pgmq.q_catalog_admission enable row level security;
alter table pgmq.a_catalog_admission enable row level security;

revoke all on all tables in schema catalog_private
  from public, anon, authenticated, service_role;
revoke all on table pgmq.q_catalog_admission, pgmq.a_catalog_admission
  from public, anon, authenticated, service_role;

create policy catalog_admission_queue_service
  on pgmq.q_catalog_admission for all to service_role
  using (true) with check (true);
create policy catalog_admission_archive_service
  on pgmq.a_catalog_admission for all to service_role
  using (true) with check (true);

revoke all on all functions in schema pgmq
  from public, anon, authenticated;
revoke all on schema pgmq from public, anon, authenticated;

create or replace function catalog_private.request_catalog_nomination(
  p_youtube_video_id text,
  p_title text,
  p_channel_id text,
  p_channel_name text,
  p_thumbnail_url text,
  p_default_language text,
  p_duration_seconds double precision,
  p_published_at timestamptz,
  p_privacy_status text,
  p_embeddable boolean,
  p_live_status text,
  p_age_restricted boolean,
  p_provider_path text,
  p_provider_verified_at timestamptz,
  p_evidence_expires_at timestamptz,
  p_trace_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_video_id uuid;
  nomination_id uuid;
  queue_message_id bigint;
  idempotency_key text;
begin
  if p_youtube_video_id is null
    or p_youtube_video_id !~ '^[A-Za-z0-9_-]{11}$'
    or nullif(btrim(p_title), '') is null
    or nullif(btrim(p_channel_id), '') is null
    or nullif(btrim(p_channel_name), '') is null
    or p_duration_seconds is null
    or p_duration_seconds < 0
    or p_published_at is null
    or p_privacy_status is distinct from 'public'
    or p_embeddable is distinct from true
    or p_live_status is distinct from 'none'
    or p_age_restricted is distinct from false
    or p_provider_path is distinct from 'youtube_data_api_v3_videos_list'
    or p_provider_verified_at is null
    or p_provider_verified_at > clock_timestamp() + interval '5 minutes'
    or p_evidence_expires_at is null
    or p_evidence_expires_at <= p_provider_verified_at
    or p_evidence_expires_at <= clock_timestamp()
    or p_trace_id is null
    or p_trace_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$'
  then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'ineligible');
  end if;

  insert into public.videos (
    youtube_url, youtube_video_id, title, channel_id, channel_name,
    thumbnail_url, default_language, duration_seconds, published_at,
    privacy_status, embeddable, live_status, age_restricted,
    provider_evidence_path, provider_verified_at,
    provider_evidence_expires_at
  ) values (
    'https://www.youtube.com/watch?v=' || p_youtube_video_id,
    p_youtube_video_id, p_title, p_channel_id, p_channel_name,
    p_thumbnail_url, p_default_language, p_duration_seconds, p_published_at,
    p_privacy_status, p_embeddable, p_live_status, p_age_restricted,
    p_provider_path, p_provider_verified_at,
    p_evidence_expires_at
  )
  on conflict (youtube_video_id) do update set
    title = excluded.title,
    channel_id = excluded.channel_id,
    channel_name = excluded.channel_name,
    thumbnail_url = coalesce(excluded.thumbnail_url, public.videos.thumbnail_url),
    default_language = coalesce(excluded.default_language, public.videos.default_language),
    duration_seconds = excluded.duration_seconds,
    published_at = excluded.published_at,
    privacy_status = excluded.privacy_status,
    embeddable = excluded.embeddable,
    live_status = excluded.live_status,
    age_restricted = excluded.age_restricted,
    provider_evidence_path = excluded.provider_evidence_path,
    provider_verified_at = excluded.provider_verified_at,
    provider_evidence_expires_at = excluded.provider_evidence_expires_at
  returning id into canonical_video_id;

  insert into catalog_private.catalog_nominations (video_id)
  values (canonical_video_id)
  on conflict (video_id) do nothing
  returning id into nomination_id;

  if nomination_id is null then
    select id into nomination_id
    from catalog_private.catalog_nominations
    where video_id = canonical_video_id;
    return jsonb_build_object(
      'outcome', 'already_enqueued', 'nominationId', nomination_id
    );
  end if;

  idempotency_key := nomination_id::text || ':catalog-admission-v1';
  select send into queue_message_id
  from pgmq.send(
    'catalog_admission',
    jsonb_build_object(
      'nomination_id', nomination_id,
      'policy_version', 'catalog-admission-v1',
      'idempotency_key', idempotency_key,
      'priority', 'high',
      'trace_id', p_trace_id
    ),
    0
  );

  return jsonb_build_object(
    'outcome', 'enqueued',
    'nominationId', nomination_id,
    'queueMessageId', queue_message_id
  );
end;
$$;

create or replace function public.request_catalog_nomination(
  p_youtube_video_id text,
  p_title text,
  p_channel_id text,
  p_channel_name text,
  p_thumbnail_url text,
  p_default_language text,
  p_duration_seconds double precision,
  p_published_at timestamptz,
  p_privacy_status text,
  p_embeddable boolean,
  p_live_status text,
  p_age_restricted boolean,
  p_provider_path text,
  p_provider_verified_at timestamptz,
  p_evidence_expires_at timestamptz,
  p_trace_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.request_catalog_nomination(
    p_youtube_video_id, p_title, p_channel_id, p_channel_name,
    p_thumbnail_url, p_default_language, p_duration_seconds, p_published_at,
    p_privacy_status, p_embeddable, p_live_status, p_age_restricted,
    p_provider_path, p_provider_verified_at, p_evidence_expires_at, p_trace_id
  );
end;
$$;

create or replace function catalog_private.claim_catalog_admission_work(
  p_batch_size integer,
  p_visibility_timeout_seconds integer
)
returns table (
  msg_id bigint,
  read_count integer,
  nomination_id uuid,
  video_id uuid,
  youtube_video_id text,
  idempotency_key text,
  policy_version text,
  priority text,
  trace_id text
)
language sql
volatile
security definer
set search_path = ''
as $$
  select
    message.msg_id,
    message.read_ct,
    nomination.id,
    nomination.video_id,
    video.youtube_video_id,
    message.message ->> 'idempotency_key',
    message.message ->> 'policy_version',
    message.message ->> 'priority',
    message.message ->> 'trace_id'
  from pgmq.read(
    'catalog_admission',
    least(greatest(coalesce(p_visibility_timeout_seconds, 120), 30), 900),
    least(greatest(coalesce(p_batch_size, 5), 1), 20)
  ) as message
  left join catalog_private.catalog_nominations as nomination
    on nomination.id = case
      when message.message ->> 'nomination_id'
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (message.message ->> 'nomination_id')::uuid
      else null
    end
  left join public.videos as video on video.id = nomination.video_id
  order by message.msg_id;
$$;

create or replace function public.claim_catalog_admission_work(
  p_batch_size integer,
  p_visibility_timeout_seconds integer
)
returns table (
  msg_id bigint,
  read_count integer,
  nomination_id uuid,
  video_id uuid,
  youtube_video_id text,
  idempotency_key text,
  policy_version text,
  priority text,
  trace_id text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return query select * from catalog_private.claim_catalog_admission_work(
    p_batch_size, p_visibility_timeout_seconds
  );
end;
$$;

create or replace function catalog_private.complete_catalog_admission_work(
  p_msg_id bigint,
  p_nomination_id uuid,
  p_idempotency_key text,
  p_provider_outcome text,
  p_provider_path text,
  p_title text,
  p_channel_id text,
  p_channel_name text,
  p_thumbnail_url text,
  p_default_language text,
  p_duration_seconds double precision,
  p_published_at timestamptz,
  p_privacy_status text,
  p_embeddable boolean,
  p_live_status text,
  p_age_restricted boolean,
  p_provider_verified_at timestamptz,
  p_evidence_expires_at timestamptz,
  p_policy_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_video_id uuid;
  target_youtube_video_id text;
  evidence_id uuid;
  admission_id uuid;
  decision text;
  reason_code text;
  archived boolean;
begin
  select nomination.video_id, video.youtube_video_id
  into target_video_id, target_youtube_video_id
  from catalog_private.catalog_nominations as nomination
  join public.videos as video on video.id = nomination.video_id
  where nomination.id = p_nomination_id;
  if target_video_id is null then
    raise exception 'Catalog Nomination does not exist';
  end if;

  select id into admission_id
  from catalog_private.catalog_admissions
  where idempotency_key = p_idempotency_key;
  if admission_id is not null then
    perform pgmq.archive('catalog_admission', p_msg_id);
    return jsonb_build_object(
      'outcome', 'already_completed', 'admissionId', admission_id
    );
  end if;

  reason_code := case
    when p_provider_path <> 'youtube_data_api_v3_videos_list'
      then 'unsupported_provider'
    when p_provider_verified_at > clock_timestamp() + interval '5 minutes'
      or p_evidence_expires_at <= clock_timestamp()
      then 'stale_evidence'
    when p_provider_outcome = 'absent' then 'unavailable'
    when p_privacy_status <> 'public' then 'not_public'
    when not p_embeddable then 'not_embeddable'
    when p_live_status = 'live' then 'live'
    when p_live_status = 'upcoming' then 'upcoming'
    when p_age_restricted then 'age_restricted'
    else null
  end;
  decision := case when reason_code is null then 'admitted' else 'inactive' end;

  insert into catalog_private.youtube_provider_evidence (
    nomination_id, video_id, idempotency_key, provider_outcome, provider_path,
    youtube_video_id, title, channel_id, channel_name, thumbnail_url,
    default_language, duration_seconds, published_at, privacy_status,
    embeddable, live_status, age_restricted, provider_verified_at,
    evidence_expires_at
  ) values (
    p_nomination_id, target_video_id, p_idempotency_key, p_provider_outcome,
    p_provider_path,
    target_youtube_video_id, p_title, p_channel_id, p_channel_name,
    p_thumbnail_url, p_default_language, p_duration_seconds, p_published_at,
    p_privacy_status, p_embeddable, p_live_status, p_age_restricted,
    p_provider_verified_at, p_evidence_expires_at
  )
  on conflict (idempotency_key) do update set
    idempotency_key = excluded.idempotency_key
  returning id into evidence_id;

  insert into catalog_private.catalog_admissions (
    nomination_id, video_id, provider_evidence_id, idempotency_key,
    policy_version, decision, reason_code
  ) values (
    p_nomination_id, target_video_id, evidence_id, p_idempotency_key,
    p_policy_version, decision, reason_code
  )
  returning id into admission_id;

  update public.videos set
    title = coalesce(p_title, title),
    channel_id = coalesce(p_channel_id, channel_id),
    channel_name = coalesce(p_channel_name, channel_name),
    thumbnail_url = coalesce(p_thumbnail_url, thumbnail_url),
    default_language = coalesce(p_default_language, default_language),
    duration_seconds = coalesce(p_duration_seconds, duration_seconds),
    published_at = coalesce(p_published_at, published_at),
    privacy_status = coalesce(p_privacy_status, privacy_status),
    embeddable = coalesce(p_embeddable, embeddable),
    live_status = coalesce(p_live_status, live_status),
    age_restricted = coalesce(p_age_restricted, age_restricted),
    provider_evidence_path = p_provider_path,
    provider_verified_at = p_provider_verified_at,
    provider_evidence_expires_at = p_evidence_expires_at,
    catalog_state = case when decision = 'admitted' then 'active' else 'inactive' end,
    catalog_inactive_reason = reason_code
  where id = target_video_id;

  update catalog_private.catalog_nominations set
    status = case when decision = 'admitted' then 'admitted' else 'inactive' end,
    decided_at = clock_timestamp(),
    last_failure_code = null
  where id = p_nomination_id;

  select pgmq.archive('catalog_admission', p_msg_id) into archived;
  if not coalesce(archived, false) then
    raise exception 'Catalog Admission queue archive failed';
  end if;

  return jsonb_build_object(
    'outcome', decision, 'admissionId', admission_id,
    'reasonCode', reason_code
  );
end;
$$;

create or replace function public.complete_catalog_admission_work(
  p_msg_id bigint,
  p_nomination_id uuid,
  p_idempotency_key text,
  p_provider_outcome text,
  p_provider_path text,
  p_title text,
  p_channel_id text,
  p_channel_name text,
  p_thumbnail_url text,
  p_default_language text,
  p_duration_seconds double precision,
  p_published_at timestamptz,
  p_privacy_status text,
  p_embeddable boolean,
  p_live_status text,
  p_age_restricted boolean,
  p_provider_verified_at timestamptz,
  p_evidence_expires_at timestamptz,
  p_policy_version text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.complete_catalog_admission_work(
    p_msg_id, p_nomination_id, p_idempotency_key, p_provider_outcome,
    p_provider_path,
    p_title, p_channel_id, p_channel_name, p_thumbnail_url,
    p_default_language, p_duration_seconds, p_published_at,
    p_privacy_status, p_embeddable, p_live_status, p_age_restricted,
    p_provider_verified_at, p_evidence_expires_at, p_policy_version
  );
end;
$$;

create or replace function catalog_private.fail_catalog_admission_work(
  p_msg_id bigint,
  p_nomination_id uuid,
  p_failure_code text,
  p_max_attempts integer,
  p_base_delay_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempts integer;
  message_payload jsonb;
  retry_delay integer;
  archived boolean;
begin
  if p_failure_code not in (
    'provider_timeout', 'provider_non_ok', 'provider_schema',
    'provider_error', 'worker_error', 'invalid_message'
  ) then
    raise exception 'Unsupported Catalog worker failure code';
  end if;

  select read_ct, message into attempts, message_payload
  from pgmq.q_catalog_admission where msg_id = p_msg_id;
  if attempts is null then
    return jsonb_build_object('outcome', 'missing');
  end if;

  if attempts >= least(greatest(coalesce(p_max_attempts, 4), 1), 10) then
    insert into catalog_private.catalog_admission_dead_letters (
      queue_message_id, nomination_id, idempotency_key, attempts, failure_code
    ) values (
      p_msg_id, p_nomination_id, message_payload ->> 'idempotency_key',
      attempts, p_failure_code
    ) on conflict (queue_message_id) do nothing;

    update catalog_private.catalog_nominations set
      status = 'exhausted',
      decided_at = clock_timestamp(),
      last_failure_code = p_failure_code
    where id = p_nomination_id;

    select pgmq.archive('catalog_admission', p_msg_id) into archived;
    if not coalesce(archived, false) then
      raise exception 'Catalog dead-letter archive failed';
    end if;
    return jsonb_build_object('outcome', 'exhausted', 'attempts', attempts);
  end if;

  retry_delay := least(
    greatest(coalesce(p_base_delay_seconds, 30), 1)
      * power(2, greatest(attempts - 1, 0))::integer,
    3600
  );
  perform * from pgmq.set_vt('catalog_admission', p_msg_id, retry_delay);
  update catalog_private.catalog_nominations set
    last_failure_code = p_failure_code
  where id = p_nomination_id;
  return jsonb_build_object(
    'outcome', 'retry_scheduled', 'attempts', attempts,
    'retryAfterSeconds', retry_delay
  );
end;
$$;

create or replace function public.fail_catalog_admission_work(
  p_msg_id bigint,
  p_nomination_id uuid,
  p_failure_code text,
  p_max_attempts integer,
  p_base_delay_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.fail_catalog_admission_work(
    p_msg_id, p_nomination_id, p_failure_code,
    p_max_attempts, p_base_delay_seconds
  );
end;
$$;

revoke all on all functions in schema catalog_private
  from public, anon, authenticated, service_role;
grant execute on function catalog_private.request_catalog_nomination(
  text,text,text,text,text,text,double precision,timestamptz,text,boolean,
  text,boolean,text,timestamptz,timestamptz,text
) to service_role;
grant execute on function catalog_private.claim_catalog_admission_work(integer,integer)
  to service_role;
grant execute on function catalog_private.complete_catalog_admission_work(
  bigint,uuid,text,text,text,text,text,text,text,text,double precision,timestamptz,
  text,boolean,text,boolean,timestamptz,timestamptz,text
) to service_role;
grant execute on function catalog_private.fail_catalog_admission_work(
  bigint,uuid,text,integer,integer
) to service_role;

revoke all on function public.request_catalog_nomination(
  text,text,text,text,text,text,double precision,timestamptz,text,boolean,
  text,boolean,text,timestamptz,timestamptz,text
) from public, anon, authenticated, service_role;
grant execute on function public.request_catalog_nomination(
  text,text,text,text,text,text,double precision,timestamptz,text,boolean,
  text,boolean,text,timestamptz,timestamptz,text
) to service_role;
revoke all on function public.claim_catalog_admission_work(integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_catalog_admission_work(integer,integer)
  to service_role;
revoke all on function public.complete_catalog_admission_work(
  bigint,uuid,text,text,text,text,text,text,text,text,double precision,timestamptz,
  text,boolean,text,boolean,timestamptz,timestamptz,text
) from public, anon, authenticated, service_role;
grant execute on function public.complete_catalog_admission_work(
  bigint,uuid,text,text,text,text,text,text,text,text,double precision,timestamptz,
  text,boolean,text,boolean,timestamptz,timestamptz,text
) to service_role;
revoke all on function public.fail_catalog_admission_work(
  bigint,uuid,text,integer,integer
) from public, anon, authenticated, service_role;
grant execute on function public.fail_catalog_admission_work(
  bigint,uuid,text,integer,integer
) to service_role;

notify pgrst, 'reload schema';
