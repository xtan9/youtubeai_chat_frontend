-- Catalog Admission contract: private resources, idempotent Nomination,
-- high-priority durable work, deterministic Admission, and browser denial.
-- Run after both representative legacy and fresh migration replays.

begin;

do $$
begin
  if to_regclass('catalog_private.catalog_nominations') is null
    or to_regclass('catalog_private.catalog_admissions') is null
    or to_regclass('catalog_private.youtube_provider_evidence') is null
    or to_regclass('catalog_private.catalog_admission_dead_letters') is null
    or to_regclass('pgmq.q_catalog_admission') is null
  then
    raise exception 'REGRESSION: Catalog Admission durable resources are missing';
  end if;

  if has_schema_privilege('anon', 'catalog_private', 'USAGE')
    or has_schema_privilege('authenticated', 'catalog_private', 'USAGE')
    or has_table_privilege(
      'anon', 'catalog_private.catalog_nominations', 'SELECT'
    )
    or has_table_privilege(
      'authenticated', 'catalog_private.catalog_admissions', 'SELECT'
    )
    or has_table_privilege(
      'authenticated', 'catalog_private.youtube_provider_evidence', 'INSERT'
    )
    or has_table_privilege(
      'authenticated', 'pgmq.q_catalog_admission', 'SELECT'
    )
  then
    raise exception 'REGRESSION: Catalog or queue resources are browser-accessible';
  end if;

  if has_function_privilege(
      'anon',
      'public.request_catalog_nomination(text,text,text,text,text,text,double precision,timestamptz,text,boolean,text,boolean,text,timestamptz,timestamptz,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.claim_catalog_admission_work(integer,integer)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.claim_catalog_admission_work(integer,integer)',
      'EXECUTE'
    )
  then
    raise exception 'REGRESSION: Catalog worker RPC grants are not least privilege';
  end if;
end;
$$;

set local role service_role;

select public.request_catalog_nomination(
  'aaaaaaa0348',
  'Verified title',
  'channel-348',
  'Verified channel',
  'https://i.ytimg.com/vi/aaaaaaa0348/mqdefault.jpg',
  'en-US',
  123::double precision,
  '2025-01-02T03:04:05Z',
  'public',
  true,
  'none',
  false,
  'youtube_data_api_v3_videos_list',
  clock_timestamp(),
  clock_timestamp() + interval '24 hours',
  'trace-catalog-348'
);

-- Equivalent repeated Summary completion must reuse the same Nomination and
-- must not create another queue Message.
select public.request_catalog_nomination(
  'aaaaaaa0348',
  'Verified title',
  'channel-348',
  'Verified channel',
  null,
  'en-US',
  123::double precision,
  '2025-01-02T03:04:05Z',
  'public',
  true,
  'none',
  false,
  'youtube_data_api_v3_videos_list',
  clock_timestamp(),
  clock_timestamp() + interval '24 hours',
  'trace-catalog-duplicate'
);

-- Only the named normalized provider path is accepted. A caller cannot label
-- arbitrary metadata as approved evidence and create durable shared work.
select public.request_catalog_nomination(
  'eeeeeee0348', 'Untrusted title', 'channel-unsafe', 'Untrusted channel', null,
  'en', 60::double precision, '2025-01-02T03:04:05Z', 'public', true,
  'none', false, 'unsupported_provider', clock_timestamp(),
  clock_timestamp() + interval '24 hours', 'trace-unsafe-provider'
);

reset role;

do $$
declare
  nomination_count integer;
  message_count integer;
  payload jsonb;
begin
  select count(*) into nomination_count
  from catalog_private.catalog_nominations;
  select count(*) into message_count from pgmq.q_catalog_admission;
  select message into payload
  from pgmq.q_catalog_admission order by msg_id limit 1;

  if nomination_count <> 1 or message_count <> 1
    or exists (
      select 1 from public.videos where youtube_video_id = 'eeeeeee0348'
    )
  then
    raise exception 'REGRESSION: Nomination/enqueue is not idempotent: %, %',
      nomination_count, message_count;
  end if;
  if payload ->> 'priority' <> 'high'
    or payload ->> 'policy_version' <> 'catalog-admission-v1'
    or not (payload ? 'nomination_id')
    or not (payload ? 'idempotency_key')
    or payload ?| array[
      'user_id', 'session_id', 'history_id', 'youtube_url',
      'output_language', 'transcript', 'summary', 'request_content'
    ]
  then
    raise exception 'REGRESSION: admission queue payload is unsafe: %', payload;
  end if;
end;
$$;

set local role service_role;

create temporary table claimed_catalog_work as
select * from public.claim_catalog_admission_work(1, 60);

do $$
begin
  if (select count(*) from claimed_catalog_work) <> 1
    or (select priority from claimed_catalog_work) <> 'high'
    or (select read_count from claimed_catalog_work) <> 1
  then
    raise exception 'REGRESSION: bounded Catalog work claim failed';
  end if;
end;
$$;

select public.complete_catalog_admission_work(
  (select msg_id from claimed_catalog_work),
  (select nomination_id from claimed_catalog_work),
  (select idempotency_key from claimed_catalog_work),
  'verified',
  'youtube_data_api_v3_videos_list',
  'Verified title refreshed',
  'channel-348',
  'Verified channel refreshed',
  'https://i.ytimg.com/vi/aaaaaaa0348/hqdefault.jpg',
  'en-US',
  123::double precision,
  '2025-01-02T03:04:05Z',
  'public',
  true,
  'none',
  false,
  clock_timestamp(),
  clock_timestamp() + interval '24 hours',
  'catalog-admission-v1'
);

-- Idempotent redelivery after the queue Message is archived must return the
-- same durable decision rather than producing another version.
select public.complete_catalog_admission_work(
  (select msg_id from claimed_catalog_work),
  (select nomination_id from claimed_catalog_work),
  (select idempotency_key from claimed_catalog_work),
  'verified',
  'youtube_data_api_v3_videos_list',
  'Verified title refreshed',
  'channel-348',
  'Verified channel refreshed',
  null,
  'en-US',
  123::double precision,
  '2025-01-02T03:04:05Z',
  'public',
  true,
  'none',
  false,
  clock_timestamp(),
  clock_timestamp() + interval '24 hours',
  'catalog-admission-v1'
);

reset role;

do $$
declare
  admission_count integer;
  evidence_count integer;
  active_state text;
begin
  select count(*) into admission_count
  from catalog_private.catalog_admissions;
  select count(*) into evidence_count
  from catalog_private.youtube_provider_evidence;
  select catalog_state into active_state
  from public.videos where youtube_video_id = 'aaaaaaa0348';

  if admission_count <> 1 or evidence_count <> 1
    or active_state <> 'active'
    or exists (select 1 from pgmq.q_catalog_admission)
    or not exists (select 1 from pgmq.a_catalog_admission)
  then
    raise exception 'REGRESSION: Admission commit/archive/redelivery drifted';
  end if;
end;
$$;

-- A gate that changes between Nomination and the worker refresh records a
-- versioned inactive decision without deleting the learner's History identity.
set local role service_role;
select public.request_catalog_nomination(
  'bbbbbbb0348', 'Second title', 'channel-349', 'Second channel', null,
  'en', 60::double precision, '2025-02-02T03:04:05Z', 'public', true,
  'none', false, 'youtube_data_api_v3_videos_list', clock_timestamp(),
  clock_timestamp() + interval '24 hours',
  'trace-inactive-348'
);
reset role;

insert into auth.users (id, is_anonymous)
values ('34800000-0000-4000-8000-000000000001', false);
insert into public.user_video_history (user_id, video_id)
select '34800000-0000-4000-8000-000000000001', id
from public.videos where youtube_video_id = 'bbbbbbb0348';

set local role service_role;
create temporary table inactive_catalog_work as
select * from public.claim_catalog_admission_work(1, 60);
select public.complete_catalog_admission_work(
  (select msg_id from inactive_catalog_work),
  (select nomination_id from inactive_catalog_work),
  (select idempotency_key from inactive_catalog_work),
  'verified',
  'youtube_data_api_v3_videos_list', 'Second title', 'channel-349',
  'Second channel', null, 'en', 60::double precision,
  '2025-02-02T03:04:05Z', 'public', false, 'none', false,
  clock_timestamp(), clock_timestamp() + interval '24 hours',
  'catalog-admission-v1'
);
reset role;

do $$
begin
  if not exists (
    select 1 from public.videos
    where youtube_video_id = 'bbbbbbb0348'
      and catalog_state = 'inactive'
      and catalog_inactive_reason = 'not_embeddable'
  ) or not exists (
    select 1 from public.user_video_history as history
    join public.videos as video on video.id = history.video_id
    where history.user_id = '34800000-0000-4000-8000-000000000001'
      and video.youtube_video_id = 'bbbbbbb0348'
  ) then
    raise exception 'REGRESSION: failed Admission gate deleted or activated History identity';
  end if;
end;
$$;

-- An authoritative empty provider result is a terminal unavailable gate, not
-- a retryable schema failure. Preserve the last verified display identity and
-- History link while recording a versioned inactive Admission.
set local role service_role;
select public.request_catalog_nomination(
  'zzzzzzz0348', 'Deleted title', 'channel-352', 'Deleted channel', null,
  'en', 60::double precision, '2025-05-02T03:04:05Z', 'public', true,
  'none', false, 'youtube_data_api_v3_videos_list', clock_timestamp(),
  clock_timestamp() + interval '24 hours', 'trace-absent-348'
);
reset role;

insert into public.user_video_history (user_id, video_id)
select '34800000-0000-4000-8000-000000000001', id
from public.videos where youtube_video_id = 'zzzzzzz0348';

set local role service_role;
create temporary table absent_catalog_work as
select * from public.claim_catalog_admission_work(1, 60);
select public.complete_catalog_admission_work(
  (select msg_id from absent_catalog_work),
  (select nomination_id from absent_catalog_work),
  (select idempotency_key from absent_catalog_work),
  'absent', 'youtube_data_api_v3_videos_list',
  null, null, null, null, null, null, null, null, null, null, null,
  clock_timestamp(), clock_timestamp() + interval '24 hours',
  'catalog-admission-v1'
);
reset role;

do $$
begin
  if not exists (
    select 1 from public.videos
    where youtube_video_id = 'zzzzzzz0348'
      and title = 'Deleted title'
      and channel_name = 'Deleted channel'
      and catalog_state = 'inactive'
      and catalog_inactive_reason = 'unavailable'
  ) or not exists (
    select 1 from public.user_video_history as history
    join public.videos as video on video.id = history.video_id
    where history.user_id = '34800000-0000-4000-8000-000000000001'
      and video.youtube_video_id = 'zzzzzzz0348'
  ) or not exists (
    select 1
    from catalog_private.catalog_admissions as admission
    join catalog_private.youtube_provider_evidence as evidence
      on evidence.id = admission.provider_evidence_id
    where admission.video_id = (
      select id from public.videos where youtube_video_id = 'zzzzzzz0348'
    )
      and admission.decision = 'inactive'
      and admission.reason_code = 'unavailable'
      and evidence.provider_outcome = 'absent'
  ) then
    raise exception 'REGRESSION: authoritative absence did not preserve a governed Inactive Video';
  end if;
end;
$$;

-- Retry uses visibility backoff; exhaustion archives the Message only after a
-- durable dead letter and does not block later work.
set local role service_role;
select public.request_catalog_nomination(
  'ccccccc0348', 'Retry title', 'channel-350', 'Retry channel', null,
  'en', 60::double precision, '2025-03-02T03:04:05Z', 'public', true,
  'none', false, 'youtube_data_api_v3_videos_list', clock_timestamp(),
  clock_timestamp() + interval '24 hours',
  'trace-retry-348'
);
create temporary table retry_catalog_work as
select * from public.claim_catalog_admission_work(1, 60);
select public.fail_catalog_admission_work(
  (select msg_id from retry_catalog_work),
  (select nomination_id from retry_catalog_work),
  'provider_timeout', 2, 1
);
reset role;

-- Advance only this task fixture's Message visibility to exercise redelivery
-- without sleeping; assertions remain at the owned worker RPC boundary.
select * from pgmq.set_vt(
  'catalog_admission', (select msg_id from retry_catalog_work), 0
);

set local role service_role;
create temporary table retried_catalog_work as
select * from public.claim_catalog_admission_work(1, 60);
select public.fail_catalog_admission_work(
  (select msg_id from retried_catalog_work),
  (select nomination_id from retried_catalog_work),
  'provider_timeout', 2, 1
);
reset role;

do $$
begin
  if not exists (
    select 1 from catalog_private.catalog_admission_dead_letters
    where queue_message_id = (select msg_id from retry_catalog_work)
      and attempts = 2 and failure_code = 'provider_timeout'
  ) or not exists (
    select 1 from catalog_private.catalog_nominations
    where id = (select nomination_id from retry_catalog_work)
      and status = 'exhausted'
  ) or exists (
    select 1 from pgmq.q_catalog_admission
    where msg_id = (select msg_id from retry_catalog_work)
  ) then
    raise exception 'REGRESSION: retry exhaustion/dead-letter transition failed';
  end if;
end;
$$;

-- A malformed queue payload is bounded and archived behind a durable dead
-- letter. Repeating the terminal call is idempotent and does not copy request
-- or learner content into the dead-letter record.
create temporary table poison_message as
select send as msg_id
from pgmq.send(
  'catalog_admission',
  jsonb_build_object('priority', 'high', 'policy_version', 'invalid'),
  0
);
set local role service_role;
create temporary table poison_catalog_work as
select * from public.claim_catalog_admission_work(1, 60);
select public.fail_catalog_admission_work(
  (select msg_id from poison_catalog_work),
  (select nomination_id from poison_catalog_work),
  'invalid_message', 1, 1
);
select public.fail_catalog_admission_work(
  (select msg_id from poison_catalog_work),
  (select nomination_id from poison_catalog_work),
  'invalid_message', 1, 1
);
reset role;

do $$
begin
  if (select count(*) from poison_catalog_work) <> 1
    or (select nomination_id from poison_catalog_work) is not null
    or (select count(*) from catalog_private.catalog_admission_dead_letters
        where queue_message_id = (select msg_id from poison_message)) <> 1
    or exists (
      select 1 from pgmq.q_catalog_admission
      where msg_id = (select msg_id from poison_message)
    )
    or not exists (
      select 1 from pgmq.a_catalog_admission
      where msg_id = (select msg_id from poison_message)
    )
    or exists (
      select 1 from catalog_private.catalog_admission_dead_letters
      where queue_message_id = (select msg_id from poison_message)
        and (
          idempotency_key is not null
          or nomination_id is not null
          or failure_code <> 'invalid_message'
        )
    )
  then
    raise exception 'REGRESSION: poison Message was not bounded privately/idempotently';
  end if;
end;
$$;

-- A leased Message is invisible to a competing worker until its visibility
-- timeout. This is the concurrency seam used by scheduled worker overlap.
set local role service_role;
select public.request_catalog_nomination(
  'ddddddd0348', 'Lease title', 'channel-351', 'Lease channel', null,
  'en', 60::double precision, '2025-04-02T03:04:05Z', 'public', true,
  'none', false, 'youtube_data_api_v3_videos_list', clock_timestamp(),
  clock_timestamp() + interval '24 hours',
  'trace-lease-348'
);
create temporary table first_catalog_lease as
select * from public.claim_catalog_admission_work(1, 60);
create temporary table competing_catalog_lease as
select * from public.claim_catalog_admission_work(1, 60);
reset role;

do $$
begin
  if (select count(*) from first_catalog_lease) <> 1
    or (select count(*) from competing_catalog_lease) <> 0
  then
    raise exception 'REGRESSION: competing workers claimed the same leased Message';
  end if;
end;
$$;

rollback;
