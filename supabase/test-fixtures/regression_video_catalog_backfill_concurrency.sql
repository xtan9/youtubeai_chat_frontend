-- Real-session races for duplicate backfill scheduling, queue claiming, and
-- processing-budget reservation. All assertions stay at opaque worker seams.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;

delete from pgmq.q_catalog_backfill;
delete from pgmq.a_catalog_backfill;
delete from catalog_private.catalog_backfill_dead_letters;
delete from catalog_private.catalog_backfill_jobs;
delete from catalog_private.catalog_processing_budget_reservations
where work_type = 'recommendation_assessment';
delete from catalog_private.catalog_processing_budget_windows
where work_type = 'recommendation_assessment';
delete from public.summaries
where id = '35600000-0000-4000-8000-000000000012';
delete from public.videos where youtube_video_id = 'Bf356AaBbC2';

set role service_role;
insert into public.videos (
  id, youtube_url, youtube_video_id, url_hash, title
) values (
  '35600000-0000-4000-8000-000000000011',
  'https://www.youtube.com/watch?v=Bf356AaBbC2',
  'Bf356AaBbC2',
  'Bf356AaBbC2',
  'Concurrent backfill source'
);
insert into public.summaries (
  id, video_id, summary, transcript_source, output_language
) values (
  '35600000-0000-4000-8000-000000000012',
  '35600000-0000-4000-8000-000000000011',
  'Concurrent successful summary',
  'auto_captions',
  'en'
);
reset role;

do $$
declare
  connection_string text := format(
    'host=127.0.0.1 port=5432 dbname=%I user=%I password=postgres',
    current_database(), current_user
  );
  first_result jsonb;
  second_result jsonb;
begin
  perform extensions.dblink_connect('catalog_backfill_schedule_one', connection_string);
  perform extensions.dblink_connect('catalog_backfill_schedule_two', connection_string);
  perform extensions.dblink_send_query(
    'catalog_backfill_schedule_one',
    'select catalog_private.schedule_catalog_backfill(1)'
  );
  perform extensions.dblink_send_query(
    'catalog_backfill_schedule_two',
    'select catalog_private.schedule_catalog_backfill(1)'
  );
  select raced.result into first_result
  from extensions.dblink_get_result('catalog_backfill_schedule_one')
    as raced(result jsonb);
  perform cleared.result
  from extensions.dblink_get_result('catalog_backfill_schedule_one')
    as cleared(result jsonb);
  select raced.result into second_result
  from extensions.dblink_get_result('catalog_backfill_schedule_two')
    as raced(result jsonb);
  perform cleared.result
  from extensions.dblink_get_result('catalog_backfill_schedule_two')
    as cleared(result jsonb);
  perform extensions.dblink_disconnect('catalog_backfill_schedule_one');
  perform extensions.dblink_disconnect('catalog_backfill_schedule_two');

  if (first_result ->> 'scheduled')::integer
      + (second_result ->> 'scheduled')::integer <> 1
    or (select count(*) from catalog_private.catalog_backfill_jobs) <> 1
  then
    raise exception 'REGRESSION: concurrent backfill scheduling duplicated work: %, %',
      first_result, second_result;
  end if;
end;
$$;

do $$
declare
  connection_string text := format(
    'host=127.0.0.1 port=5432 dbname=%I user=%I password=postgres',
    current_database(), current_user
  );
  first_claims integer;
  second_claims integer;
begin
  perform extensions.dblink_connect('catalog_backfill_claim_one', connection_string);
  perform extensions.dblink_connect('catalog_backfill_claim_two', connection_string);
  perform extensions.dblink_send_query(
    'catalog_backfill_claim_one',
    'select count(*)::integer from catalog_private.claim_catalog_backfill_work(1, 120)'
  );
  perform extensions.dblink_send_query(
    'catalog_backfill_claim_two',
    'select count(*)::integer from catalog_private.claim_catalog_backfill_work(1, 120)'
  );
  select raced.claim_count into first_claims
  from extensions.dblink_get_result('catalog_backfill_claim_one')
    as raced(claim_count integer);
  select raced.claim_count into second_claims
  from extensions.dblink_get_result('catalog_backfill_claim_two')
    as raced(claim_count integer);
  perform extensions.dblink_disconnect('catalog_backfill_claim_one');
  perform extensions.dblink_disconnect('catalog_backfill_claim_two');

  if first_claims + second_claims <> 1
    or greatest(first_claims, second_claims) <> 1
  then
    raise exception 'REGRESSION: duplicate backfill queue claim: %, %',
      first_claims, second_claims;
  end if;
end;
$$;

set role service_role;
select public.complete_catalog_backfill_work(
  (select msg_id from pgmq.q_catalog_backfill),
  (select id from catalog_private.catalog_backfill_jobs limit 1),
  (select idempotency_key from catalog_private.catalog_backfill_jobs limit 1),
  'skipped',
  'unavailable'
);
select public.configure_catalog_processing_policy(
  'recommendation_assessment', 'recommendation-assessment-race-v1',
  2, 0, 4, 2, 4, 1, 120
);
reset role;

do $$
declare
  connection_string text := format(
    'host=127.0.0.1 port=5432 dbname=%I user=%I password=postgres',
    current_database(), current_user
  );
  connection_name text;
  fingerprint text;
  result jsonb;
  reserved_count integer := 0;
  exhausted_count integer := 0;
  connection_index integer;
begin
  for connection_index in 1..3 loop
    connection_name := 'catalog_budget_race_' || connection_index::text;
    fingerprint := repeat(connection_index::text, 64);
    perform extensions.dblink_connect(connection_name, connection_string);
    perform extensions.dblink_send_query(
      connection_name,
      format(
        $$select catalog_private.reserve_catalog_processing_budget(
          'recommendation_assessment', current_date, %L, 1, 0
        )$$,
        fingerprint
      )
    );
  end loop;

  for connection_index in 1..3 loop
    connection_name := 'catalog_budget_race_' || connection_index::text;
    select raced.result into result
    from extensions.dblink_get_result(connection_name) as raced(result jsonb);
    perform cleared.result
    from extensions.dblink_get_result(connection_name) as cleared(result jsonb);
    if result ->> 'outcome' = 'reserved' then
      reserved_count := reserved_count + 1;
    elsif result ->> 'outcome' = 'budget_exhausted' then
      exhausted_count := exhausted_count + 1;
    else
      raise exception 'unexpected concurrent processing budget result: %', result;
    end if;
    perform extensions.dblink_disconnect(connection_name);
  end loop;

  if reserved_count <> 2 or exhausted_count <> 1 then
    raise exception 'REGRESSION: concurrent processing budget was not bounded: %, %',
      reserved_count, exhausted_count;
  end if;
end;
$$;

set role service_role;
select public.settle_catalog_processing_budget(repeat('1', 64), 'released', 0, 0);
select public.settle_catalog_processing_budget(repeat('2', 64), 'released', 0, 0);
select public.configure_catalog_processing_policy(
  'recommendation_assessment', 'recommendation-assessment-v1',
  100, 500000, 4, 1, 4, 30, 120
);
reset role;

delete from pgmq.q_catalog_backfill;
delete from pgmq.a_catalog_backfill;
delete from catalog_private.catalog_backfill_dead_letters;
delete from catalog_private.catalog_backfill_jobs;
delete from catalog_private.catalog_processing_budget_reservations
where work_type = 'recommendation_assessment';
delete from catalog_private.catalog_processing_budget_windows
where work_type = 'recommendation_assessment';
delete from public.summaries
where id = '35600000-0000-4000-8000-000000000012';
delete from public.videos where youtube_video_id = 'Bf356AaBbC2';
