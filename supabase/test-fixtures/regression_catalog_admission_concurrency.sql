-- Real two-session proof that overlapping authenticated workers cannot claim
-- the same Catalog Admission Message while its visibility lease is active.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

delete from pgmq.q_catalog_admission;
delete from pgmq.a_catalog_admission;
delete from catalog_private.catalog_admission_dead_letters;
delete from catalog_private.catalog_admissions;
delete from catalog_private.youtube_provider_evidence;
delete from catalog_private.catalog_nominations;
delete from public.videos where youtube_video_id = 'LeaseRace48';

set role service_role;
select public.request_catalog_nomination(
  'LeaseRace48', 'Concurrent lease title', 'channel-lease-348',
  'Concurrent lease channel', null, 'en', 60::double precision,
  '2025-05-02T03:04:05Z', 'public', true, 'none', false,
  'youtube_data_api_v3_videos_list', clock_timestamp(),
  clock_timestamp() + interval '24 hours', 'trace-concurrent-lease-348'
);
reset role;

do $$
declare
  connection_string text := format(
    'host=127.0.0.1 port=5432 dbname=%I user=%I password=postgres',
    current_database(),
    current_user
  );
  first_claims integer;
  second_claims integer;
begin
  perform dblink_connect('catalog_worker_one', connection_string);
  perform dblink_connect('catalog_worker_two', connection_string);

  perform dblink_send_query(
    'catalog_worker_one',
    $query$
      select count(*)::integer
      from catalog_private.claim_catalog_admission_work(1, 120)
    $query$
  );
  perform dblink_send_query(
    'catalog_worker_two',
    $query$
      select count(*)::integer
      from catalog_private.claim_catalog_admission_work(1, 120)
    $query$
  );

  select claim_count into first_claims
  from dblink_get_result('catalog_worker_one') as raced(claim_count integer);
  select claim_count into second_claims
  from dblink_get_result('catalog_worker_two') as raced(claim_count integer);

  if first_claims + second_claims <> 1
    or greatest(first_claims, second_claims) <> 1
  then
    raise exception
      'REGRESSION: concurrent workers claimed Catalog Message %, % times',
      first_claims,
      second_claims;
  end if;

  perform dblink_disconnect('catalog_worker_one');
  perform dblink_disconnect('catalog_worker_two');
end;
$$;

delete from pgmq.q_catalog_admission;
delete from pgmq.a_catalog_admission;
delete from catalog_private.catalog_admission_dead_letters;
delete from catalog_private.catalog_admissions;
delete from catalog_private.youtube_provider_evidence;
delete from catalog_private.catalog_nominations;
delete from public.videos where youtube_video_id = 'LeaseRace48';

reset search_path;
