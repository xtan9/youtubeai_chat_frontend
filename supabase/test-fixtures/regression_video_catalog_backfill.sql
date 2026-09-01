-- Summary-only cold-start backfill, bounded processing budgets, poison-message
-- isolation, and content-free operational observability.

begin;

do $$
begin
  if to_regclass('catalog_private.catalog_backfill_jobs') is null
    or to_regclass('catalog_private.catalog_backfill_dead_letters') is null
    or to_regclass('catalog_private.catalog_processing_policies') is null
    or to_regclass('catalog_private.catalog_processing_budget_reservations') is null
    or to_regclass('catalog_private.catalog_worker_outcomes') is null
    or to_regclass('catalog_private.catalog_retention_policy') is null
    or to_regclass('pgmq.q_catalog_backfill') is null
  then
    raise exception 'REGRESSION: Video Catalog backfill resources are missing';
  end if;

  if has_schema_privilege('anon', 'catalog_private', 'USAGE')
    or has_schema_privilege('authenticated', 'catalog_private', 'USAGE')
    or has_table_privilege(
      'anon', 'catalog_private.catalog_backfill_jobs', 'SELECT'
    )
    or has_table_privilege(
      'authenticated', 'catalog_private.catalog_backfill_dead_letters', 'SELECT'
    )
    or has_table_privilege('authenticated', 'pgmq.q_catalog_backfill', 'SELECT')
  then
    raise exception 'REGRESSION: backfill resources are browser-accessible';
  end if;

  if has_function_privilege(
      'anon', 'public.schedule_catalog_backfill(integer)', 'EXECUTE'
    )
    or has_function_privilege(
      'authenticated', 'public.read_catalog_operational_metrics()', 'EXECUTE'
    )
    or not has_function_privilege(
      'service_role', 'public.schedule_catalog_backfill(integer)', 'EXECUTE'
    )
    or not has_function_privilege(
      'service_role', 'public.purge_catalog_audit(integer)', 'EXECUTE'
    )
  then
    raise exception 'REGRESSION: backfill RPC grants are not least privilege';
  end if;
end;
$$;

set local role service_role;

insert into public.videos (
  id, youtube_url, youtube_video_id, url_hash, title
) values (
  '35600000-0000-4000-8000-000000000001',
  'https://www.youtube.com/watch?v=Bf356AaBbC1',
  'Bf356AaBbC1',
  'Bf356AaBbC1',
  'Backfill source title'
);

insert into public.summaries (
  id, video_id, summary, transcript_source, output_language
) values (
  '35600000-0000-4000-8000-000000000002',
  '35600000-0000-4000-8000-000000000001',
  'A successful summary used only as an opaque backfill source.',
  'auto_captions',
  'en'
);

select public.schedule_catalog_backfill(20);
reset role;

do $$
declare
  payload jsonb;
  job_count integer;
begin
  select count(*) into job_count
  from catalog_private.catalog_backfill_jobs
  where video_id = '35600000-0000-4000-8000-000000000001';
  select message into payload
  from pgmq.q_catalog_backfill
  where message ->> 'video_id' = '35600000-0000-4000-8000-000000000001';

  if job_count <> 1
    or payload ->> 'youtube_video_id' <> 'Bf356AaBbC1'
    or payload ->> 'priority' <> 'cold_start'
    or payload ->> 'policy_version' <> 'catalog-backfill-v1'
    or not (payload ? 'summary_id')
    or not (payload ? 'backfill_job_id')
    or not (payload ? 'idempotency_key')
    or (select count(*) from jsonb_object_keys(payload)) <> 8
    or payload ?| array[
      'user_id', 'learner_id', 'session_id', 'history_id', 'youtube_url',
      'transcript', 'summary', 'request_content', 'title', 'channel_name'
    ]
  then
    raise exception 'REGRESSION: unsafe or duplicate backfill payload: %', payload;
  end if;
end;
$$;

-- A repeat scheduler run sees the durable per-Video idempotency fence.
set local role service_role;
select public.schedule_catalog_backfill(20);
reset role;

do $$
begin
  if (
    select count(*)
    from catalog_private.catalog_backfill_jobs
    where video_id = '35600000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'REGRESSION: duplicate backfill job was created';
  end if;
end;
$$;

set local role service_role;
create temporary table claimed_backfill_work as
select * from public.claim_catalog_backfill_work(1, 120);
reset role;

set local role service_role;
select public.complete_catalog_backfill_work(
  (select msg_id from claimed_backfill_work),
  (select backfill_job_id from claimed_backfill_work),
  (select idempotency_key from claimed_backfill_work),
  'skipped',
  'unavailable'
);
reset role;

set local role service_role;
select public.complete_catalog_backfill_work(
  (select msg_id from claimed_backfill_work),
  (select backfill_job_id from claimed_backfill_work),
  (select idempotency_key from claimed_backfill_work),
  'skipped',
  'unavailable'
);
reset role;

do $$
begin
  if not exists (
    select 1
    from catalog_private.catalog_backfill_jobs
    where video_id = '35600000-0000-4000-8000-000000000001'
      and status = 'skipped'
      and last_outcome = 'skipped'
  ) or exists (
    select 1
    from pgmq.q_catalog_backfill
    where message ->> 'video_id' = '35600000-0000-4000-8000-000000000001'
  ) then
    raise exception 'REGRESSION: backfill completion was not idempotent';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  first_reservation jsonb;
  duplicate_reservation jsonb;
  exhausted_reservation jsonb;
begin
  first_reservation := public.reserve_catalog_processing_budget(
    'recommendation_assessment', current_date, repeat('1', 64), 2, 0
  );
  duplicate_reservation := public.reserve_catalog_processing_budget(
    'recommendation_assessment', current_date, repeat('1', 64), 2, 0
  );
  exhausted_reservation := public.reserve_catalog_processing_budget(
    'recommendation_assessment', current_date, repeat('2', 64), 101, 0
  );
  if first_reservation ->> 'outcome' <> 'reserved'
    or duplicate_reservation ->> 'outcome' <> 'already_reserved'
    or exhausted_reservation ->> 'outcome' <> 'budget_exhausted'
  then
    raise exception 'REGRESSION: processing budget reservation contract failed: %, %, %',
      first_reservation, duplicate_reservation, exhausted_reservation;
  end if;
  if (public.settle_catalog_processing_budget(
      repeat('1', 64), 'released', 0, 0
    ) ->> 'outcome') <> 'released'
  then
    raise exception 'REGRESSION: processing budget settlement failed';
  end if;
end;
$$;
reset role;

select pgmq.send('catalog_backfill', '{"poison":true}'::jsonb, 0);
set local role service_role;
create temporary table poison_backfill_work as
select * from public.claim_catalog_backfill_work(1, 120);
reset role;
set local role service_role;
select public.fail_catalog_backfill_work(
  (select msg_id from poison_backfill_work),
  null,
  'invalid_message',
  1,
  1
);
reset role;

do $$
begin
  if (select count(*) from pgmq.q_catalog_backfill) <> 0
    or not exists (
      select 1
      from catalog_private.catalog_backfill_dead_letters
      where failure_code = 'invalid_message'
    )
  then
    raise exception 'REGRESSION: poison backfill message was not isolated';
  end if;
end;
$$;

set local role service_role;
select public.record_catalog_worker_outcome(
  'catalog_backfill', 1, 0, 0, 0, 1, 0, 0, 0, 0
);
reset role;

set local role service_role;
do $$
declare
  metrics jsonb;
  configuration jsonb;
begin
  metrics := public.read_catalog_operational_metrics();
  configuration := public.read_catalog_processing_configuration();
  if not (metrics ? 'queues')
    or not (metrics ? 'freshness')
    or not (metrics ? 'setCoverage')
    or not (metrics ? 'budgets')
    or not (configuration @> '[{"workType":"discovery"}]'::jsonb)
    or not (configuration @> '[{"workType":"semantic_profile"}]'::jsonb)
    or not (configuration @> '[{"workType":"recommendation_assessment"}]'::jsonb)
    or not (configuration @> '[{"workType":"recommendation_set_rebuild"}]'::jsonb)
  then
    raise exception 'REGRESSION: content-free catalog metrics/configuration incomplete';
  end if;
end;
$$;
reset role;

set local role service_role;
select public.configure_catalog_retention(29);
reset role;

do $$
begin
  if (select audit_retention_days from catalog_private.catalog_retention_policy
      where singleton) <> 30 then
    raise exception 'REGRESSION: audit retention floor was bypassed';
  end if;
end;
$$;

reset role;
rollback;
