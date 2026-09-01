-- Backfill and maintain the shared Video Catalog without importing learner
-- identity or Summary content into durable worker payloads.
--
-- The backfill is deliberately a first-class queue. It enumerates only the
-- canonical Video identity and a successful Summary's opaque id, then uses
-- the same provider verification and Catalog Admission boundary as ordinary
-- work. All operational configuration and metrics below are content-free.

create extension if not exists pgmq cascade;

do $$
begin
  if to_regclass('pgmq.q_catalog_backfill') is null then
    perform pgmq.create('catalog_backfill');
  end if;
end;
$$;

-- The queue API is server-only.  Keep the queue schema hidden from browser
-- roles while allowing the service-role-owned worker contracts to call PGMQ.
grant usage on schema pgmq to service_role;

create table catalog_private.catalog_backfill_jobs (
  id uuid primary key default gen_random_uuid(),
  summary_id uuid not null references public.summaries(id) on delete restrict,
  video_id uuid not null references public.videos(id) on delete restrict,
  youtube_video_id text not null check (
    youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'
  ),
  idempotency_key text not null unique,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'completed', 'skipped', 'exhausted')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  last_failure_code text check (
    last_failure_code is null or last_failure_code in (
      'provider_timeout', 'provider_non_ok', 'provider_schema',
      'provider_error', 'worker_error', 'invalid_message'
    )
  ),
  last_outcome text check (
    last_outcome is null or last_outcome in (
      'nominated', 'already_enqueued', 'skipped'
    )
  ),
  queue_message_id bigint,
  created_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  completed_at timestamptz,
  unique (video_id)
);

create index catalog_backfill_jobs_status_idx
  on catalog_private.catalog_backfill_jobs (status, created_at, id);
create index catalog_backfill_jobs_summary_idx
  on catalog_private.catalog_backfill_jobs (summary_id);

create table catalog_private.catalog_backfill_dead_letters (
  id uuid primary key default gen_random_uuid(),
  queue_message_id bigint not null unique,
  backfill_job_id uuid references catalog_private.catalog_backfill_jobs(id)
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

alter table catalog_private.catalog_backfill_jobs enable row level security;
alter table catalog_private.catalog_backfill_dead_letters enable row level security;
alter table pgmq.q_catalog_backfill enable row level security;
alter table pgmq.a_catalog_backfill enable row level security;

revoke all on table catalog_private.catalog_backfill_jobs
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.catalog_backfill_dead_letters
  from public, anon, authenticated, service_role;
revoke all on table pgmq.q_catalog_backfill, pgmq.a_catalog_backfill
  from public, anon, authenticated, service_role;

create policy catalog_backfill_queue_service
  on pgmq.q_catalog_backfill for all to service_role
  using (true) with check (true);
create policy catalog_backfill_archive_service
  on pgmq.a_catalog_backfill for all to service_role
  using (true) with check (true);

create or replace function catalog_private.schedule_catalog_backfill(
  p_batch_size integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate record;
  backfill_job_id uuid;
  job_idempotency_key text;
  sent_message_id bigint;
  scheduled_count integer := 0;
  inserted_count integer;
begin
  -- Serialize scheduler transactions so the candidate snapshot, idempotent
  -- job insert, and queue write form one duplicate-free scheduling decision.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('catalog-backfill-scheduler-v1', 0)
  );

  -- A Summary row is the only source of cold-start demand. There is no
  -- popularity, trending, learner, or raw-content input in this selection.
  for candidate in
    select
      summary_row.id as summary_id,
      video.id as video_id,
      video.youtube_video_id
    from public.summaries as summary_row
    join public.videos as video on video.id = summary_row.video_id
    where btrim(coalesce(summary_row.summary, '')) <> ''
      and video.youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'
      and not exists (
        select 1
        from public.summaries as newer_summary
        where newer_summary.video_id = summary_row.video_id
          and btrim(coalesce(newer_summary.summary, '')) <> ''
          and (
            newer_summary.created_at > summary_row.created_at
            or (
              newer_summary.created_at = summary_row.created_at
              and newer_summary.id > summary_row.id
            )
          )
      )
      and not exists (
        select 1
        from catalog_private.catalog_backfill_jobs as existing_job
        where existing_job.video_id = video.id
      )
    order by summary_row.created_at asc, summary_row.id asc
    limit least(greatest(coalesce(p_batch_size, 4), 1), 20)
    for update of summary_row skip locked
  loop
    backfill_job_id := gen_random_uuid();
    job_idempotency_key := backfill_job_id::text || ':catalog-backfill-v1';
    insert into catalog_private.catalog_backfill_jobs (
      id,
      summary_id,
      video_id,
      youtube_video_id,
      idempotency_key
    ) values (
      backfill_job_id,
      candidate.summary_id,
      candidate.video_id,
      candidate.youtube_video_id,
      job_idempotency_key
    )
    on conflict (video_id) do nothing
    returning id into backfill_job_id;

    get diagnostics inserted_count = row_count;
    if inserted_count = 0 then
      continue;
    end if;

    select send into sent_message_id
    from pgmq.send(
      'catalog_backfill',
      jsonb_build_object(
        'backfill_job_id', backfill_job_id,
        'summary_id', candidate.summary_id,
        'video_id', candidate.video_id,
        'youtube_video_id', candidate.youtube_video_id,
        'policy_version', 'catalog-backfill-v1',
        'idempotency_key', job_idempotency_key,
        'priority', 'cold_start',
        'trace_id', 'catalog-backfill:' || backfill_job_id::text
      ),
      0
    );
    if sent_message_id is null then
      raise exception 'Catalog backfill queue write failed';
    end if;

    update catalog_private.catalog_backfill_jobs
    set queue_message_id = sent_message_id
    where id = backfill_job_id;
    scheduled_count := scheduled_count + 1;
  end loop;

  return jsonb_build_object(
    'outcome', 'scheduled',
    'scheduled', scheduled_count
  );
end;
$$;

create or replace function catalog_private.claim_catalog_backfill_work(
  p_batch_size integer,
  p_visibility_timeout_seconds integer
)
returns table (
  msg_id bigint,
  read_count integer,
  backfill_job_id uuid,
  summary_id uuid,
  video_id uuid,
  youtube_video_id text,
  idempotency_key text,
  policy_version text,
  priority text,
  trace_id text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  message record;
  parsed_job_id uuid;
  parsed_summary_id uuid;
  parsed_video_id uuid;
begin
  for message in
    select *
    from pgmq.read(
      'catalog_backfill',
      least(greatest(coalesce(p_visibility_timeout_seconds, 120), 30), 900),
      least(greatest(coalesce(p_batch_size, 4), 1), 20)
    ) as queued_message
    order by queued_message.msg_id
  loop
    parsed_job_id := case
      when message.message ->> 'backfill_job_id'
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (message.message ->> 'backfill_job_id')::uuid
      else null
    end;
    parsed_summary_id := case
      when message.message ->> 'summary_id'
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (message.message ->> 'summary_id')::uuid
      else null
    end;
    parsed_video_id := case
      when message.message ->> 'video_id'
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (message.message ->> 'video_id')::uuid
      else null
    end;

    if parsed_job_id is not null then
      update catalog_private.catalog_backfill_jobs
      set status = case
            when status in ('completed', 'skipped', 'exhausted') then status
            else 'processing'
          end,
          attempts = greatest(attempts, message.read_ct),
          claimed_at = clock_timestamp()
      where id = parsed_job_id;
    end if;

    return query select
      message.msg_id,
      message.read_ct,
      parsed_job_id,
      parsed_summary_id,
      parsed_video_id,
      message.message ->> 'youtube_video_id',
      message.message ->> 'idempotency_key',
      message.message ->> 'policy_version',
      message.message ->> 'priority',
      message.message ->> 'trace_id';
  end loop;
end;
$$;

create or replace function catalog_private.complete_catalog_backfill_work(
  p_msg_id bigint,
  p_backfill_job_id uuid,
  p_idempotency_key text,
  p_outcome text,
  p_reason_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  job_row catalog_private.catalog_backfill_jobs%rowtype;
  archived boolean;
begin
  if p_outcome not in ('nominated', 'already_enqueued', 'skipped') then
    raise exception 'Unsupported Catalog backfill outcome';
  end if;
  if p_outcome = 'skipped' and p_reason_code not in (
    'not_public', 'not_embeddable', 'live', 'upcoming', 'age_restricted',
    'stale_evidence', 'unsupported_provider', 'unavailable'
  ) then
    raise exception 'Skipped Catalog backfill work requires a reason';
  end if;
  if p_outcome <> 'skipped' and p_reason_code is not null then
    raise exception 'Successful Catalog backfill work cannot have a reason';
  end if;

  select * into job_row
  from catalog_private.catalog_backfill_jobs
  where id = p_backfill_job_id
  for update;
  if job_row.id is null then
    raise exception 'Catalog backfill job does not exist';
  end if;
  if job_row.idempotency_key is distinct from p_idempotency_key then
    raise exception 'Catalog backfill idempotency key mismatch';
  end if;
  if job_row.queue_message_id is not null
    and job_row.queue_message_id <> p_msg_id
  then
    raise exception 'Catalog backfill queue message mismatch';
  end if;

  if job_row.status in ('completed', 'skipped', 'exhausted') then
    -- A worker may be replaying a message after another attempt committed
    -- the terminal state. Acknowledge the replay too; archiving is naturally
    -- idempotent because PGMQ returns false when the message is already gone.
    perform pgmq.archive('catalog_backfill', p_msg_id);
    return jsonb_build_object(
      'outcome', 'already_completed',
      'backfillJobId', p_backfill_job_id
    );
  end if;

  update catalog_private.catalog_backfill_jobs
  set status = case when p_outcome = 'skipped' then 'skipped' else 'completed' end,
      last_outcome = p_outcome,
      last_failure_code = null,
      completed_at = clock_timestamp()
  where id = p_backfill_job_id;

  select pgmq.archive('catalog_backfill', p_msg_id) into archived;
  if not coalesce(archived, false) then
    raise exception 'Catalog backfill queue archive failed';
  end if;

  return jsonb_build_object(
    'outcome', p_outcome,
    'reasonCode', p_reason_code,
    'backfillJobId', p_backfill_job_id
  );
end;
$$;

create or replace function catalog_private.fail_catalog_backfill_work(
  p_msg_id bigint,
  p_backfill_job_id uuid,
  p_failure_code text,
  p_max_attempts integer,
  p_base_delay_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  queue_attempts integer;
  message_payload jsonb;
  retry_delay integer;
  archived boolean;
  resolved_job_id uuid;
begin
  if p_failure_code not in (
    'provider_timeout', 'provider_non_ok', 'provider_schema',
    'provider_error', 'worker_error', 'invalid_message'
  ) then
    raise exception 'Unsupported Catalog backfill failure code';
  end if;

  select read_ct, message into queue_attempts, message_payload
  from pgmq.q_catalog_backfill
  where msg_id = p_msg_id;
  if queue_attempts is null then
    return jsonb_build_object('outcome', 'missing');
  end if;

  resolved_job_id := null;
  if p_backfill_job_id is not null
    and exists (
      select 1 from catalog_private.catalog_backfill_jobs
      where id = p_backfill_job_id
    )
  then
    resolved_job_id := p_backfill_job_id;
  end if;

  if queue_attempts >= least(greatest(coalesce(p_max_attempts, 4), 1), 10) then
    insert into catalog_private.catalog_backfill_dead_letters (
      queue_message_id,
      backfill_job_id,
      idempotency_key,
      attempts,
      failure_code
    ) values (
      p_msg_id,
      resolved_job_id,
      message_payload ->> 'idempotency_key',
      queue_attempts,
      p_failure_code
    ) on conflict (queue_message_id) do nothing;

    update catalog_private.catalog_backfill_jobs
    set status = 'exhausted',
        attempts = greatest(
          queue_attempts, catalog_private.catalog_backfill_jobs.attempts
        ),
        last_failure_code = p_failure_code,
        completed_at = clock_timestamp()
    where id = resolved_job_id;

    select pgmq.archive('catalog_backfill', p_msg_id) into archived;
    if not coalesce(archived, false) then
      raise exception 'Catalog backfill dead-letter archive failed';
    end if;
    return jsonb_build_object(
      'outcome', 'exhausted', 'attempts', queue_attempts
    );
  end if;

  retry_delay := least(
    greatest(coalesce(p_base_delay_seconds, 30), 1)
      * power(2, greatest(queue_attempts - 1, 0))::integer,
    3600
  );
  perform * from pgmq.set_vt('catalog_backfill', p_msg_id, retry_delay);
  update catalog_private.catalog_backfill_jobs
  set status = 'pending',
      attempts = greatest(
        queue_attempts, catalog_private.catalog_backfill_jobs.attempts
      ),
      last_failure_code = p_failure_code
  where id = resolved_job_id;
  return jsonb_build_object(
    'outcome', 'retry_scheduled',
    'attempts', queue_attempts,
    'retryAfterSeconds', retry_delay
  );
end;
$$;

create or replace function catalog_private.requeue_catalog_nomination(
  p_youtube_video_id text,
  p_trace_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  video_row record;
  nomination_row catalog_private.catalog_nominations%rowtype;
  latest_verified_at timestamptz;
  idempotency_key text;
  sent_message_id bigint;
begin
  if p_youtube_video_id is null
    or p_youtube_video_id !~ '^[A-Za-z0-9_-]{11}$'
    or p_trace_id is null
    or p_trace_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$'
  then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'input');
  end if;

  select video.* into video_row
  from public.videos as video
  where video.youtube_video_id = p_youtube_video_id
  for update;
  if video_row.id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;

  select * into nomination_row
  from catalog_private.catalog_nominations
  where video_id = video_row.id
  for update;
  if nomination_row.id is null then
    return jsonb_build_object('outcome', 'missing');
  end if;
  if nomination_row.status = 'pending' then
    return jsonb_build_object(
      'outcome', 'already_enqueued', 'nominationId', nomination_row.id
    );
  end if;

  select evidence.provider_verified_at into latest_verified_at
  from catalog_private.catalog_admissions as admission
  join catalog_private.youtube_provider_evidence as evidence
    on evidence.id = admission.provider_evidence_id
  where admission.video_id = video_row.id
  order by admission.decided_at desc, admission.id desc
  limit 1;

  if nomination_row.status = 'admitted'
    and video_row.catalog_state = 'active'
    and video_row.provider_verified_at is not null
    and video_row.provider_evidence_expires_at > clock_timestamp()
    and latest_verified_at is not null
    and video_row.provider_verified_at <= latest_verified_at
  then
    return jsonb_build_object(
      'outcome', 'already_enqueued', 'nominationId', nomination_row.id
    );
  end if;

  idempotency_key := nomination_row.id::text
    || ':catalog-admission-v1:reverify:'
    || md5(
      coalesce(video_row.provider_verified_at::text, '')
      || ':' || coalesce(video_row.provider_evidence_expires_at::text, '')
    );

  if exists (
    select 1
    from pgmq.q_catalog_admission as queued_message
    where queued_message.message ->> 'idempotency_key' = idempotency_key
  ) then
    return jsonb_build_object(
      'outcome', 'already_enqueued', 'nominationId', nomination_row.id
    );
  end if;

  select send into sent_message_id
  from pgmq.send(
    'catalog_admission',
    jsonb_build_object(
      'nomination_id', nomination_row.id,
      'policy_version', 'catalog-admission-v1',
      'idempotency_key', idempotency_key,
      'priority', 'high',
      'trace_id', p_trace_id
    ),
    0
  );
  if sent_message_id is null then
    raise exception 'Catalog revalidation queue write failed';
  end if;

  update catalog_private.catalog_nominations
  set status = 'pending',
      decided_at = null,
      last_failure_code = null
  where id = nomination_row.id;

  return jsonb_build_object(
    'outcome', 'enqueued',
    'nominationId', nomination_row.id,
    'queueMessageId', sent_message_id
  );
end;
$$;

-- One configuration row per independently budgeted pipeline. These defaults
-- are conservative and can be replaced only through the service-role RPC.
create table catalog_private.catalog_processing_policies (
  work_type text primary key check (work_type in (
    'catalog_backfill', 'catalog_admission', 'discovery',
    'semantic_profile', 'recommendation_assessment', 'recommendation_set_rebuild'
  )),
  policy_version text not null check (
    btrim(policy_version) <> '' and policy_version = btrim(policy_version)
  ),
  max_daily_units bigint not null check (max_daily_units > 0),
  max_daily_micro_usd bigint not null check (max_daily_micro_usd >= 0),
  batch_size integer not null check (batch_size between 1 and 100),
  concurrency integer not null check (concurrency between 1 and 32),
  max_attempts integer not null check (max_attempts between 1 and 10),
  base_backoff_seconds integer not null check (base_backoff_seconds between 1 and 3600),
  visibility_timeout_seconds integer not null check (
    visibility_timeout_seconds between 30 and 900
  ),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

insert into catalog_private.catalog_processing_policies (
  work_type, policy_version, max_daily_units, max_daily_micro_usd,
  batch_size, concurrency, max_attempts, base_backoff_seconds,
  visibility_timeout_seconds
) values
  ('catalog_backfill', 'catalog-backfill-v1', 5000, 100000, 4, 1, 4, 30, 120),
  ('catalog_admission', 'catalog-admission-v1', 5000, 100000, 4, 1, 4, 30, 120),
  ('discovery', 'discovery-processing-v1', 1000, 500000, 4, 1, 4, 60, 120),
  ('semantic_profile', 'semantic-profile-v1', 100, 500000, 4, 1, 4, 30, 120),
  ('recommendation_assessment', 'recommendation-assessment-v1', 100, 500000, 4, 1, 4, 30, 120),
  ('recommendation_set_rebuild', 'recommendation-set-rebuild-v1', 100, 100000, 4, 1, 4, 30, 120)
on conflict (work_type) do nothing;

create table catalog_private.catalog_processing_budget_windows (
  work_type text not null references catalog_private.catalog_processing_policies(work_type)
    on delete restrict,
  budget_day date not null,
  max_units bigint not null check (max_units > 0),
  max_micro_usd bigint not null check (max_micro_usd >= 0),
  reserved_units bigint not null default 0 check (reserved_units >= 0),
  reserved_micro_usd bigint not null default 0 check (reserved_micro_usd >= 0),
  consumed_units bigint not null default 0 check (consumed_units >= 0),
  consumed_micro_usd bigint not null default 0 check (consumed_micro_usd >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (work_type, budget_day),
  check (reserved_units <= max_units),
  check (reserved_micro_usd <= max_micro_usd),
  check (consumed_units <= max_units),
  check (consumed_micro_usd <= max_micro_usd)
);

create table catalog_private.catalog_processing_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  work_type text not null,
  budget_day date not null,
  reservation_fingerprint text not null unique check (
    reservation_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  units bigint not null check (units > 0),
  estimated_micro_usd bigint not null check (estimated_micro_usd >= 0),
  status text not null default 'reserved' check (
    status in ('reserved', 'settled', 'released')
  ),
  actual_units bigint check (actual_units is null or actual_units >= 0),
  actual_micro_usd bigint check (
    actual_micro_usd is null or actual_micro_usd >= 0
  ),
  created_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  foreign key (work_type, budget_day)
    references catalog_private.catalog_processing_budget_windows(work_type, budget_day)
    on delete restrict
);

create index catalog_processing_budget_reservations_window_idx
  on catalog_private.catalog_processing_budget_reservations (work_type, budget_day, status);

alter table catalog_private.catalog_processing_policies enable row level security;
alter table catalog_private.catalog_processing_budget_windows enable row level security;
alter table catalog_private.catalog_processing_budget_reservations enable row level security;
revoke all on table catalog_private.catalog_processing_policies
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.catalog_processing_budget_windows
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.catalog_processing_budget_reservations
  from public, anon, authenticated, service_role;

create or replace function catalog_private.configure_catalog_processing_policy(
  p_work_type text,
  p_policy_version text,
  p_max_daily_units bigint,
  p_max_daily_micro_usd bigint,
  p_batch_size integer,
  p_concurrency integer,
  p_max_attempts integer,
  p_base_backoff_seconds integer,
  p_visibility_timeout_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  policy_row catalog_private.catalog_processing_policies%rowtype;
begin
  if p_work_type not in (
    'catalog_backfill', 'catalog_admission', 'discovery',
    'semantic_profile', 'recommendation_assessment', 'recommendation_set_rebuild'
  )
    or btrim(coalesce(p_policy_version, '')) = ''
    or p_max_daily_units is null or p_max_daily_units <= 0
    or p_max_daily_micro_usd is null or p_max_daily_micro_usd < 0
    or p_batch_size is null or p_batch_size not between 1 and 100
    or p_concurrency is null or p_concurrency not between 1 and 32
    or p_max_attempts is null or p_max_attempts not between 1 and 10
    or p_base_backoff_seconds is null
      or p_base_backoff_seconds not between 1 and 3600
    or p_visibility_timeout_seconds is null
      or p_visibility_timeout_seconds not between 30 and 900
  then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'input');
  end if;

  insert into catalog_private.catalog_processing_policies (
    work_type, policy_version, max_daily_units, max_daily_micro_usd,
    batch_size, concurrency, max_attempts, base_backoff_seconds,
    visibility_timeout_seconds
  ) values (
    p_work_type, btrim(p_policy_version), p_max_daily_units,
    p_max_daily_micro_usd, p_batch_size, p_concurrency, p_max_attempts,
    p_base_backoff_seconds, p_visibility_timeout_seconds
  ) on conflict (work_type) do update set
    policy_version = excluded.policy_version,
    max_daily_units = excluded.max_daily_units,
    max_daily_micro_usd = excluded.max_daily_micro_usd,
    batch_size = excluded.batch_size,
    concurrency = excluded.concurrency,
    max_attempts = excluded.max_attempts,
    base_backoff_seconds = excluded.base_backoff_seconds,
    visibility_timeout_seconds = excluded.visibility_timeout_seconds,
    updated_at = clock_timestamp()
  returning * into policy_row;

  return jsonb_build_object(
    'outcome', 'configured',
    'workType', policy_row.work_type,
    'policyVersion', policy_row.policy_version,
    'batchSize', policy_row.batch_size,
    'concurrency', policy_row.concurrency,
    'maxAttempts', policy_row.max_attempts,
    'baseBackoffSeconds', policy_row.base_backoff_seconds,
    'visibilityTimeoutSeconds', policy_row.visibility_timeout_seconds,
    'maxDailyUnits', policy_row.max_daily_units,
    'maxDailyMicroUsd', policy_row.max_daily_micro_usd
  );
end;
$$;

create or replace function catalog_private.reserve_catalog_processing_budget(
  p_work_type text,
  p_budget_day date,
  p_reservation_fingerprint text,
  p_units bigint,
  p_estimated_micro_usd bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  policy_row catalog_private.catalog_processing_policies%rowtype;
  window_row catalog_private.catalog_processing_budget_windows%rowtype;
  reservation_row catalog_private.catalog_processing_budget_reservations%rowtype;
begin
  if p_budget_day is null or p_budget_day <> current_date then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'budget_day');
  end if;
  if p_reservation_fingerprint is null
    or p_reservation_fingerprint !~ '^[a-f0-9]{64}$'
    or p_units is null or p_units <= 0
    or p_estimated_micro_usd is null or p_estimated_micro_usd < 0
  then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'input');
  end if;

  select * into policy_row
  from catalog_private.catalog_processing_policies
  where work_type = p_work_type and status = 'active'
  for update;
  if policy_row.work_type is null then
    return jsonb_build_object('outcome', 'budget_unconfigured');
  end if;

  select * into reservation_row
  from catalog_private.catalog_processing_budget_reservations
  where reservation_fingerprint = p_reservation_fingerprint;
  if reservation_row.id is not null then
    if reservation_row.work_type = p_work_type
      and reservation_row.budget_day = p_budget_day
      and reservation_row.units = p_units
      and reservation_row.estimated_micro_usd = p_estimated_micro_usd
    then
      return jsonb_build_object(
        'outcome', case when reservation_row.status = 'reserved'
          then 'already_reserved' else 'already_settled' end,
        'reservationId', reservation_row.id
      );
    end if;
    return jsonb_build_object('outcome', 'reservation_conflict');
  end if;

  insert into catalog_private.catalog_processing_budget_windows (
    work_type, budget_day, max_units, max_micro_usd
  ) values (
    policy_row.work_type, p_budget_day,
    policy_row.max_daily_units, policy_row.max_daily_micro_usd
  ) on conflict (work_type, budget_day) do nothing;

  select * into window_row
  from catalog_private.catalog_processing_budget_windows
  where work_type = p_work_type and budget_day = p_budget_day
  for update;

  if p_units > window_row.max_units - window_row.reserved_units
    or p_estimated_micro_usd >
      window_row.max_micro_usd - window_row.reserved_micro_usd
  then
    return jsonb_build_object(
      'outcome', 'budget_exhausted',
      'remainingUnits', window_row.max_units - window_row.reserved_units,
      'remainingMicroUsd', window_row.max_micro_usd - window_row.reserved_micro_usd
    );
  end if;

  insert into catalog_private.catalog_processing_budget_reservations (
    work_type, budget_day, reservation_fingerprint, units,
    estimated_micro_usd
  ) values (
    p_work_type, p_budget_day, p_reservation_fingerprint, p_units,
    p_estimated_micro_usd
  ) returning * into reservation_row;

  update catalog_private.catalog_processing_budget_windows
  set reserved_units = reserved_units + p_units,
      reserved_micro_usd = reserved_micro_usd + p_estimated_micro_usd,
      updated_at = clock_timestamp()
  where work_type = p_work_type and budget_day = p_budget_day;

  return jsonb_build_object(
    'outcome', 'reserved',
    'reservationId', reservation_row.id,
    'remainingUnits', window_row.max_units - window_row.reserved_units - p_units,
    'remainingMicroUsd', window_row.max_micro_usd
      - window_row.reserved_micro_usd - p_estimated_micro_usd
  );
end;
$$;

create or replace function catalog_private.settle_catalog_processing_budget(
  p_reservation_fingerprint text,
  p_outcome text,
  p_actual_units bigint,
  p_actual_micro_usd bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  reservation_row catalog_private.catalog_processing_budget_reservations%rowtype;
  window_row catalog_private.catalog_processing_budget_windows%rowtype;
  settled_units bigint;
  settled_micro_usd bigint;
begin
  if p_outcome not in ('settled', 'released')
    or p_actual_units is null or p_actual_units < 0
    or p_actual_micro_usd is null or p_actual_micro_usd < 0
  then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'input');
  end if;

  select * into reservation_row
  from catalog_private.catalog_processing_budget_reservations
  where reservation_fingerprint = p_reservation_fingerprint
  for update;
  if reservation_row.id is null then
    return jsonb_build_object('outcome', 'reservation_missing');
  end if;
  if reservation_row.status <> 'reserved' then
    return jsonb_build_object(
      'outcome', 'already_settled',
      'reservationId', reservation_row.id
    );
  end if;

  settled_units := case when p_outcome = 'settled' then p_actual_units else 0 end;
  settled_micro_usd := case
    when p_outcome = 'settled' then p_actual_micro_usd else 0 end;

  select * into window_row
  from catalog_private.catalog_processing_budget_windows
  where work_type = reservation_row.work_type
    and budget_day = reservation_row.budget_day
  for update;
  if window_row.work_type is null then
    raise exception 'Catalog processing budget window does not exist';
  end if;
  if window_row.consumed_units + settled_units > window_row.max_units
    or window_row.consumed_micro_usd + settled_micro_usd > window_row.max_micro_usd
  then
    raise exception 'Catalog processing budget settlement exceeds configured limit';
  end if;

  update catalog_private.catalog_processing_budget_windows as budget_window
  set reserved_units = budget_window.reserved_units
        - reservation_row.units,
      reserved_micro_usd = budget_window.reserved_micro_usd
        - reservation_row.estimated_micro_usd,
      consumed_units = budget_window.consumed_units
        + settled_units,
      consumed_micro_usd = budget_window.consumed_micro_usd
        + settled_micro_usd,
      updated_at = clock_timestamp()
  where work_type = reservation_row.work_type
    and budget_day = reservation_row.budget_day;

  update catalog_private.catalog_processing_budget_reservations
  set status = p_outcome,
      actual_units = settled_units,
      actual_micro_usd = settled_micro_usd,
      settled_at = clock_timestamp()
  where id = reservation_row.id;

  return jsonb_build_object(
    'outcome', p_outcome,
    'reservationId', reservation_row.id,
    'actualUnits', settled_units,
    'actualMicroUsd', settled_micro_usd
  );
end;
$$;

create table catalog_private.catalog_worker_outcomes (
  worker_kind text not null check (worker_kind in (
    'catalog_backfill', 'catalog_admission', 'discovery',
    'semantic_profile', 'recommendation_assessment', 'recommendation_set_rebuild'
  )),
  observed_day date not null,
  claimed bigint not null default 0 check (claimed >= 0),
  completed bigint not null default 0 check (completed >= 0),
  nominated bigint not null default 0 check (nominated >= 0),
  already_enqueued bigint not null default 0 check (already_enqueued >= 0),
  skipped bigint not null default 0 check (skipped >= 0),
  deferred bigint not null default 0 check (deferred >= 0),
  obsolete bigint not null default 0 check (obsolete >= 0),
  retried bigint not null default 0 check (retried >= 0),
  exhausted bigint not null default 0 check (exhausted >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (worker_kind, observed_day)
);

alter table catalog_private.catalog_worker_outcomes enable row level security;
revoke all on table catalog_private.catalog_worker_outcomes
  from public, anon, authenticated, service_role;

create or replace function catalog_private.record_catalog_worker_outcome(
  p_worker_kind text,
  p_claimed bigint,
  p_completed bigint,
  p_nominated bigint,
  p_already_enqueued bigint,
  p_skipped bigint,
  p_deferred bigint,
  p_obsolete bigint,
  p_retried bigint,
  p_exhausted bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  outcome_row catalog_private.catalog_worker_outcomes%rowtype;
begin
  if p_worker_kind not in (
    'catalog_backfill', 'catalog_admission', 'discovery',
    'semantic_profile', 'recommendation_assessment', 'recommendation_set_rebuild'
  )
    or greatest(
      coalesce(p_claimed, -1), coalesce(p_completed, -1),
      coalesce(p_nominated, -1), coalesce(p_already_enqueued, -1),
      coalesce(p_skipped, -1), coalesce(p_deferred, -1),
      coalesce(p_obsolete, -1), coalesce(p_retried, -1),
      coalesce(p_exhausted, -1)
    ) < 0
  then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'input');
  end if;

  insert into catalog_private.catalog_worker_outcomes (
    worker_kind, observed_day, claimed, completed, nominated,
    already_enqueued, skipped, deferred, obsolete, retried, exhausted
  ) values (
    p_worker_kind, current_date, p_claimed, p_completed, p_nominated,
    p_already_enqueued, p_skipped, p_deferred, p_obsolete, p_retried,
    p_exhausted
  ) on conflict (worker_kind, observed_day) do update set
    claimed = catalog_private.catalog_worker_outcomes.claimed + excluded.claimed,
    completed = catalog_private.catalog_worker_outcomes.completed + excluded.completed,
    nominated = catalog_private.catalog_worker_outcomes.nominated + excluded.nominated,
    already_enqueued = catalog_private.catalog_worker_outcomes.already_enqueued
      + excluded.already_enqueued,
    skipped = catalog_private.catalog_worker_outcomes.skipped + excluded.skipped,
    deferred = catalog_private.catalog_worker_outcomes.deferred + excluded.deferred,
    obsolete = catalog_private.catalog_worker_outcomes.obsolete + excluded.obsolete,
    retried = catalog_private.catalog_worker_outcomes.retried + excluded.retried,
    exhausted = catalog_private.catalog_worker_outcomes.exhausted + excluded.exhausted,
    updated_at = clock_timestamp()
  returning * into outcome_row;

  return jsonb_build_object(
    'outcome', 'recorded',
    'workerKind', outcome_row.worker_kind,
    'observedDay', outcome_row.observed_day
  );
end;
$$;

create table catalog_private.catalog_retention_policy (
  singleton boolean primary key default true check (singleton),
  audit_retention_days integer not null default 30 check (audit_retention_days >= 30),
  updated_at timestamptz not null default clock_timestamp()
);

insert into catalog_private.catalog_retention_policy (singleton)
values (true)
on conflict (singleton) do nothing;

alter table catalog_private.catalog_retention_policy enable row level security;
revoke all on table catalog_private.catalog_retention_policy
  from public, anon, authenticated, service_role;

create or replace function catalog_private.configure_catalog_retention(
  p_audit_retention_days integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_audit_retention_days is null or p_audit_retention_days < 30 then
    return jsonb_build_object('outcome', 'rejected', 'reason', 'retention_floor');
  end if;
  update catalog_private.catalog_retention_policy
  set audit_retention_days = p_audit_retention_days,
      updated_at = clock_timestamp()
  where singleton;
  return jsonb_build_object(
    'outcome', 'configured',
    'auditRetentionDays', p_audit_retention_days
  );
end;
$$;

-- The retention worker is the sole controlled deletion path for versioned
-- recommendation artifacts. It uses the audit cutoff, never provider expiry,
-- and never deletes a public Video. History therefore remains a hard foreign
-- key guard even if a future Video purge is added separately.
create or replace function catalog_private.purge_catalog_audit(
  p_batch_size integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  retention_days integer;
  cutoff timestamptz;
  target_set_ids uuid[];
  target_set_id uuid;
  deleted_rows integer;
  purged_reviews integer := 0;
  purged_ready_reads integer := 0;
  purged_recommendations integer := 0;
  purged_sets integer := 0;
  purged_assessments integer := 0;
  purged_pair_evidence integer := 0;
  purged_profiles integer := 0;
  purged_admissions integer := 0;
  purged_provider_evidence integer := 0;
  purged_backfill_dead_letters integer := 0;
  purged_backfill_jobs integer := 0;
  purged_quality_reports integer := 0;
  batch_size integer := least(greatest(coalesce(p_batch_size, 100), 1), 1000);
begin
  select audit_retention_days into retention_days
  from catalog_private.catalog_retention_policy
  where singleton;
  if retention_days is null then
    raise exception 'Catalog retention policy is not configured';
  end if;
  cutoff := clock_timestamp() - make_interval(days => retention_days);

  -- The scheduler is normally single-flight, but the lock also makes manual
  -- retries safe when two maintenance invocations overlap.
  perform pg_advisory_xact_lock(hashtext('catalog-audit-purge'));

  -- This transaction-local marker is recognized only by the immutable-fact
  -- triggers, so ordinary callers cannot rewrite or delete historical facts.
  perform set_config('catalog_private.retention_purge', 'on', true);

  select coalesce(array_agg(recommendation_set.id), '{}'::uuid[])
  into target_set_ids
  from (
    select recommendation_set.id
    from catalog_private.recommendation_sets as recommendation_set
    where recommendation_set.status = 'superseded'
      and recommendation_set.superseded_at < cutoff
    order by recommendation_set.superseded_at, recommendation_set.id
    limit batch_size
  ) as recommendation_set;

  if cardinality(target_set_ids) > 0 then
    -- Superseded sets point at their successor. Delete an old chain from
    -- oldest to newest so each child reference is gone before its successor
    -- is removed; a single unordered DELETE can violate that FK.
    for target_set_id in
      select recommendation_set.id
      from catalog_private.recommendation_sets as recommendation_set
      where recommendation_set.id = any(target_set_ids)
      order by recommendation_set.superseded_at, recommendation_set.id
    loop
      delete from catalog_private.recommendation_reviews
      where recommendation_set_id = target_set_id;
      get diagnostics deleted_rows = row_count;
      purged_reviews := purged_reviews + deleted_rows;

      delete from catalog_private.recommendation_ready_read_events
      where recommendation_set_id = target_set_id;
      get diagnostics deleted_rows = row_count;
      purged_ready_reads := purged_ready_reads + deleted_rows;

      delete from catalog_private.recommendations
      where recommendation_set_id = target_set_id;
      get diagnostics deleted_rows = row_count;
      purged_recommendations := purged_recommendations + deleted_rows;

      delete from catalog_private.recommendation_sets
      where id = target_set_id;
      get diagnostics deleted_rows = row_count;
      purged_sets := purged_sets + deleted_rows;
    end loop;
  end if;

  delete from catalog_private.recommendation_quality_reports as report
  where report.computed_at < cutoff
    and not exists (
      select 1
      from catalog_private.recommendation_rollout_controls as control
      where control.approved_quality_report_id = report.id
    );
  get diagnostics purged_quality_reports = row_count;

  delete from catalog_private.recommendation_assessments as assessment
  where assessment.created_at < cutoff
    and not exists (
      select 1
      from catalog_private.recommendations as recommendation
      where recommendation.recommendation_assessment_id = assessment.id
    );
  get diagnostics purged_assessments = row_count;

  delete from catalog_private.recommendation_candidate_pair_evidence as pair_evidence
  where pair_evidence.created_at < cutoff
    and not exists (
      select 1
      from catalog_private.recommendations as recommendation
      where recommendation.candidate_pair_evidence_id = pair_evidence.id
    )
    and not exists (
      select 1
      from catalog_private.recommendation_assessments as assessment
      where assessment.candidate_pair_evidence_id = pair_evidence.id
    );
  get diagnostics purged_pair_evidence = row_count;

  delete from catalog_private.semantic_profile_versions as profile
  where profile.status = 'superseded'
    and profile.superseded_at < cutoff
    and not exists (
      select 1
      from catalog_private.recommendation_candidate_pair_evidence as pair_evidence
      where pair_evidence.source_profile_id = profile.id
         or pair_evidence.candidate_profile_id = profile.id
    )
    and not exists (
      select 1
      from catalog_private.recommendation_assessments as assessment
      where assessment.source_profile_id = profile.id
         or assessment.candidate_profile_id = profile.id
    )
    and not exists (
      select 1
      from catalog_private.recommendation_sets as recommendation_set
      where recommendation_set.source_profile_id = profile.id
    );
  get diagnostics purged_profiles = row_count;

  delete from catalog_private.catalog_admissions as admission
  where admission.decided_at < cutoff
    and exists (
      select 1
      from catalog_private.catalog_admissions as newer_admission
      where newer_admission.video_id = admission.video_id
        and (
          newer_admission.decided_at > admission.decided_at
          or (
            newer_admission.decided_at = admission.decided_at
            and newer_admission.id > admission.id
          )
        )
    )
    and not exists (
      select 1
      from catalog_private.recommendation_candidate_pair_evidence as pair_evidence
      where pair_evidence.source_catalog_admission_id = admission.id
         or pair_evidence.candidate_catalog_admission_id = admission.id
    )
    and not exists (
      select 1
      from catalog_private.recommendation_assessments as assessment
      where assessment.source_catalog_admission_id = admission.id
         or assessment.candidate_catalog_admission_id = admission.id
    )
    and not exists (
      select 1
      from catalog_private.recommendation_sets as recommendation_set
      where recommendation_set.source_catalog_admission_id = admission.id
    )
    and not exists (
      select 1
      from catalog_private.recommendations as recommendation
      where recommendation.candidate_catalog_admission_id = admission.id
    );
  get diagnostics purged_admissions = row_count;

  delete from catalog_private.youtube_provider_evidence as evidence
  where evidence.recorded_at < cutoff
    and not exists (
      select 1
      from catalog_private.catalog_admissions as admission
      where admission.provider_evidence_id = evidence.id
    );
  get diagnostics purged_provider_evidence = row_count;

  delete from catalog_private.catalog_backfill_dead_letters
  where exhausted_at < cutoff;
  get diagnostics purged_backfill_dead_letters = row_count;

  delete from catalog_private.catalog_backfill_jobs as job
  where job.created_at < cutoff
    and job.status in ('completed', 'skipped', 'exhausted')
    and not exists (
      select 1
      from catalog_private.catalog_backfill_dead_letters as dead_letter
      where dead_letter.backfill_job_id = job.id
    );
  get diagnostics purged_backfill_jobs = row_count;

  return jsonb_build_object(
    'outcome', 'purged',
    'auditRetentionDays', retention_days,
    'purgedReviews', purged_reviews,
    'purgedReadyReads', purged_ready_reads,
    'purgedRecommendations', purged_recommendations,
    'purgedSets', purged_sets,
    'purgedQualityReports', purged_quality_reports,
    'purgedAssessments', purged_assessments,
    'purgedPairEvidence', purged_pair_evidence,
    'purgedProfiles', purged_profiles,
    'purgedAdmissions', purged_admissions,
    'purgedProviderEvidence', purged_provider_evidence,
    'purgedBackfillDeadLetters', purged_backfill_dead_letters,
    'purgedBackfillJobs', purged_backfill_jobs
  );
end;
$$;

-- Existing immutable tables explicitly allow only this guarded, service-owned
-- retention path to delete rows after the configured audit window.
create or replace function catalog_private.reject_recommendation_assessment_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('catalog_private.retention_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'Recommendation Assessments are immutable';
end;
$$;

create or replace function catalog_private.reject_recommendation_candidate_pair_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('catalog_private.retention_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'Recommendation Candidate pair evidence is immutable';
end;
$$;

create or replace function catalog_private.reject_recommendation_review_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('catalog_private.retention_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'Recommendation Reviews are immutable';
end;
$$;

create or replace function catalog_private.reject_recommendation_quality_report_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('catalog_private.retention_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'Recommendation quality reports are immutable';
end;
$$;

create or replace function catalog_private.reject_published_recommendation_member_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('catalog_private.retention_purge', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and exists (
      select 1
      from catalog_private.recommendation_sets as recommendation_set
      where recommendation_set.id = old.recommendation_set_id
        and recommendation_set.status in ('current', 'superseded')
    )
  then
    raise exception 'Published Recommendation Set members are immutable';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and exists (
      select 1
      from catalog_private.recommendation_sets as recommendation_set
      where recommendation_set.id = new.recommendation_set_id
        and recommendation_set.status in ('current', 'superseded')
    )
  then
    raise exception 'Published Recommendation Set members are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function catalog_private.read_catalog_processing_configuration()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'workType', policy.work_type,
        'policyVersion', policy.policy_version,
        'batchSize', policy.batch_size,
        'concurrency', policy.concurrency,
        'maxAttempts', policy.max_attempts,
        'baseBackoffSeconds', policy.base_backoff_seconds,
        'visibilityTimeoutSeconds', policy.visibility_timeout_seconds,
        'maxDailyUnits', policy.max_daily_units,
        'maxDailyMicroUsd', policy.max_daily_micro_usd,
        'budgetDay', current_date,
        'reservedUnits', coalesce(budget_window.reserved_units, 0),
        'reservedMicroUsd', coalesce(budget_window.reserved_micro_usd, 0),
        'consumedUnits', coalesce(budget_window.consumed_units, 0),
        'consumedMicroUsd', coalesce(budget_window.consumed_micro_usd, 0)
      ) order by policy.work_type
    ),
    '[]'::jsonb
  )
  from catalog_private.catalog_processing_policies as policy
  left join catalog_private.catalog_processing_budget_windows as budget_window
    on budget_window.work_type = policy.work_type
   and budget_window.budget_day = current_date
  where policy.status = 'active';
$$;

create or replace function catalog_private.read_catalog_operational_metrics()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'queues', coalesce((
      select jsonb_agg(queue_metrics order by queue_metrics ->> 'queue')
      from (
        select jsonb_build_object(
          'queue', 'catalog_admission',
          'depth', count(*)::bigint,
          'oldestAgeSeconds', coalesce(
            extract(epoch from clock_timestamp() - min(enqueued_at))::bigint, 0
          ),
          'attempts', coalesce(sum(read_ct), 0)::bigint,
          'deadLetters', (select count(*)::bigint
            from catalog_private.catalog_admission_dead_letters)
        ) as queue_metrics
        from pgmq.q_catalog_admission
        union all
        select jsonb_build_object(
          'queue', 'catalog_backfill',
          'depth', count(*)::bigint,
          'oldestAgeSeconds', coalesce(
            extract(epoch from clock_timestamp() - min(enqueued_at))::bigint, 0
          ),
          'attempts', coalesce(sum(read_ct), 0)::bigint,
          'deadLetters', (select count(*)::bigint
            from catalog_private.catalog_backfill_dead_letters)
        )
        from pgmq.q_catalog_backfill
        union all
        select jsonb_build_object(
          'queue', 'semantic_profile',
          'depth', count(*)::bigint,
          'oldestAgeSeconds', coalesce(
            extract(epoch from clock_timestamp() - min(enqueued_at))::bigint, 0
          ),
          'attempts', coalesce(sum(read_ct), 0)::bigint,
          'deadLetters', (
            select count(*)::bigint
            from catalog_private.semantic_profile_requests
            where status = 'exhausted'
          )
        )
        from pgmq.q_semantic_profile
      ) as queue_rows
    ), '[]'::jsonb),
    'workerOutcomes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'workerKind', outcome.worker_kind,
          'observedDay', outcome.observed_day,
          'claimed', outcome.claimed,
          'completed', outcome.completed,
          'nominated', outcome.nominated,
          'alreadyEnqueued', outcome.already_enqueued,
          'skipped', outcome.skipped,
          'deferred', outcome.deferred,
          'obsolete', outcome.obsolete,
          'retried', outcome.retried,
          'exhausted', outcome.exhausted,
          'updatedAt', outcome.updated_at
        ) order by outcome.observed_day desc, outcome.worker_kind
      )
      from catalog_private.catalog_worker_outcomes as outcome
      where outcome.observed_day >= current_date - 30
    ), '[]'::jsonb),
    'freshness', jsonb_build_object(
      'activeVideos', (select count(*)::bigint from public.videos where catalog_state = 'active'),
      'inactiveVideos', (select count(*)::bigint from public.videos where catalog_state = 'inactive'),
      'expiredActiveVideos', (select count(*)::bigint from public.videos
        where catalog_state = 'active'
          and provider_evidence_expires_at <= clock_timestamp()),
      'staleInactiveVideos', (select count(*)::bigint from public.videos
        where catalog_state = 'inactive' and catalog_inactive_reason = 'stale_evidence')
    ),
    'setCoverage', jsonb_build_object(
      'currentSets', (select count(*)::bigint
        from catalog_private.recommendation_sets where status = 'current'),
      'currentItems', (select count(*)::bigint
        from catalog_private.recommendations as recommendation
        join catalog_private.recommendation_sets as recommendation_set
          on recommendation_set.id = recommendation.recommendation_set_id
        where recommendation_set.status = 'current'),
      'minimumCurrentSetItems', coalesce((select min(item_count)::bigint
        from catalog_private.recommendation_sets where status = 'current'), 0),
      'maximumCurrentSetItems', coalesce((select max(item_count)::bigint
        from catalog_private.recommendation_sets where status = 'current'), 0)
    ),
    'budgets', catalog_private.read_catalog_processing_configuration()
  );
$$;

-- Thin service-role bridges keep the private schema and queue inaccessible to
-- browser roles while allowing the scheduler to use only bounded contracts.
create or replace function public.schedule_catalog_backfill(p_batch_size integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.schedule_catalog_backfill(p_batch_size);
end;
$$;

create or replace function public.claim_catalog_backfill_work(
  p_batch_size integer,
  p_visibility_timeout_seconds integer
)
returns table (
  msg_id bigint,
  read_count integer,
  backfill_job_id uuid,
  summary_id uuid,
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
  return query select * from catalog_private.claim_catalog_backfill_work(
    p_batch_size, p_visibility_timeout_seconds
  );
end;
$$;

create or replace function public.complete_catalog_backfill_work(
  p_msg_id bigint,
  p_backfill_job_id uuid,
  p_idempotency_key text,
  p_outcome text,
  p_reason_code text
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
  return catalog_private.complete_catalog_backfill_work(
    p_msg_id, p_backfill_job_id, p_idempotency_key, p_outcome, p_reason_code
  );
end;
$$;

create or replace function public.fail_catalog_backfill_work(
  p_msg_id bigint,
  p_backfill_job_id uuid,
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
  return catalog_private.fail_catalog_backfill_work(
    p_msg_id, p_backfill_job_id, p_failure_code,
    p_max_attempts, p_base_delay_seconds
  );
end;
$$;

create or replace function public.requeue_catalog_nomination(
  p_youtube_video_id text,
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
  return catalog_private.requeue_catalog_nomination(
    p_youtube_video_id, p_trace_id
  );
end;
$$;

create or replace function public.configure_catalog_processing_policy(
  p_work_type text,
  p_policy_version text,
  p_max_daily_units bigint,
  p_max_daily_micro_usd bigint,
  p_batch_size integer,
  p_concurrency integer,
  p_max_attempts integer,
  p_base_backoff_seconds integer,
  p_visibility_timeout_seconds integer
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
  return catalog_private.configure_catalog_processing_policy(
    p_work_type, p_policy_version, p_max_daily_units, p_max_daily_micro_usd,
    p_batch_size, p_concurrency, p_max_attempts, p_base_backoff_seconds,
    p_visibility_timeout_seconds
  );
end;
$$;

create or replace function public.reserve_catalog_processing_budget(
  p_work_type text,
  p_budget_day date,
  p_reservation_fingerprint text,
  p_units bigint,
  p_estimated_micro_usd bigint
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
  return catalog_private.reserve_catalog_processing_budget(
    p_work_type, p_budget_day, p_reservation_fingerprint,
    p_units, p_estimated_micro_usd
  );
end;
$$;

create or replace function public.settle_catalog_processing_budget(
  p_reservation_fingerprint text,
  p_outcome text,
  p_actual_units bigint,
  p_actual_micro_usd bigint
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
  return catalog_private.settle_catalog_processing_budget(
    p_reservation_fingerprint, p_outcome, p_actual_units, p_actual_micro_usd
  );
end;
$$;

create or replace function public.record_catalog_worker_outcome(
  p_worker_kind text,
  p_claimed bigint,
  p_completed bigint,
  p_nominated bigint,
  p_already_enqueued bigint,
  p_skipped bigint,
  p_deferred bigint,
  p_obsolete bigint,
  p_retried bigint,
  p_exhausted bigint
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
  return catalog_private.record_catalog_worker_outcome(
    p_worker_kind, p_claimed, p_completed, p_nominated, p_already_enqueued,
    p_skipped, p_deferred, p_obsolete, p_retried, p_exhausted
  );
end;
$$;

create or replace function public.configure_catalog_retention(
  p_audit_retention_days integer
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
  return catalog_private.configure_catalog_retention(p_audit_retention_days);
end;
$$;

create or replace function public.purge_catalog_audit(p_batch_size integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.purge_catalog_audit(p_batch_size);
end;
$$;

create or replace function public.read_catalog_processing_configuration()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.read_catalog_processing_configuration();
end;
$$;

create or replace function public.read_catalog_operational_metrics()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.read_catalog_operational_metrics();
end;
$$;

grant execute on function catalog_private.schedule_catalog_backfill(integer)
  to service_role;
grant execute on function catalog_private.claim_catalog_backfill_work(integer, integer)
  to service_role;
grant execute on function catalog_private.complete_catalog_backfill_work(
  bigint, uuid, text, text, text
) to service_role;
grant execute on function catalog_private.fail_catalog_backfill_work(
  bigint, uuid, text, integer, integer
) to service_role;
grant execute on function catalog_private.requeue_catalog_nomination(text, text)
  to service_role;
grant execute on function catalog_private.configure_catalog_processing_policy(
  text, text, bigint, bigint, integer, integer, integer, integer, integer
) to service_role;
grant execute on function catalog_private.reserve_catalog_processing_budget(
  text, date, text, bigint, bigint
) to service_role;
grant execute on function catalog_private.settle_catalog_processing_budget(
  text, text, bigint, bigint
) to service_role;
grant execute on function catalog_private.record_catalog_worker_outcome(
  text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint
) to service_role;
grant execute on function catalog_private.configure_catalog_retention(integer)
  to service_role;
grant execute on function catalog_private.purge_catalog_audit(integer)
  to service_role;
grant execute on function catalog_private.read_catalog_processing_configuration()
  to service_role;
grant execute on function catalog_private.read_catalog_operational_metrics()
  to service_role;

revoke all on function public.schedule_catalog_backfill(integer)
  from public, anon, authenticated;
revoke all on function public.claim_catalog_backfill_work(integer, integer)
  from public, anon, authenticated;
revoke all on function public.complete_catalog_backfill_work(
  bigint, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.fail_catalog_backfill_work(
  bigint, uuid, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.requeue_catalog_nomination(text, text)
  from public, anon, authenticated;
revoke all on function public.configure_catalog_processing_policy(
  text, text, bigint, bigint, integer, integer, integer, integer, integer
) from public, anon, authenticated;
revoke all on function public.reserve_catalog_processing_budget(
  text, date, text, bigint, bigint
) from public, anon, authenticated;
revoke all on function public.settle_catalog_processing_budget(
  text, text, bigint, bigint
) from public, anon, authenticated;
revoke all on function public.record_catalog_worker_outcome(
  text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint
) from public, anon, authenticated;
revoke all on function public.configure_catalog_retention(integer)
  from public, anon, authenticated;
revoke all on function public.purge_catalog_audit(integer)
  from public, anon, authenticated;
revoke all on function public.read_catalog_processing_configuration()
  from public, anon, authenticated;
revoke all on function public.read_catalog_operational_metrics()
  from public, anon, authenticated;

grant execute on function public.schedule_catalog_backfill(integer) to service_role;
grant execute on function public.claim_catalog_backfill_work(integer, integer)
  to service_role;
grant execute on function public.complete_catalog_backfill_work(
  bigint, uuid, text, text, text
) to service_role;
grant execute on function public.fail_catalog_backfill_work(
  bigint, uuid, text, integer, integer
) to service_role;
grant execute on function public.requeue_catalog_nomination(text, text)
  to service_role;
grant execute on function public.configure_catalog_processing_policy(
  text, text, bigint, bigint, integer, integer, integer, integer, integer
) to service_role;
grant execute on function public.reserve_catalog_processing_budget(
  text, date, text, bigint, bigint
) to service_role;
grant execute on function public.settle_catalog_processing_budget(
  text, text, bigint, bigint
) to service_role;
grant execute on function public.record_catalog_worker_outcome(
  text, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint
) to service_role;
grant execute on function public.configure_catalog_retention(integer)
  to service_role;
grant execute on function public.purge_catalog_audit(integer)
  to service_role;
grant execute on function public.read_catalog_processing_configuration()
  to service_role;
grant execute on function public.read_catalog_operational_metrics()
  to service_role;

notify pgrst, 'reload schema';
