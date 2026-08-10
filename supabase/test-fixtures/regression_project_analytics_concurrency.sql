-- Two real PostgreSQL connections prove that Project activation follows the
-- durable action occurrence time, not best-effort after() callback arrival.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

begin;

insert into auth.users (id, is_anonymous)
values ('fa000000-0000-4000-8000-000000000001', false)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

insert into public.projects (id, workspace_id, name, created_at)
select
  'fa100000-0000-4000-8000-000000000001',
  id,
  'Analytics concurrency fixture',
  clock_timestamp() - interval '10 minutes'
from public.workspaces
where owner_id = 'fa000000-0000-4000-8000-000000000001';

insert into public.project_source_sets (project_id, revision)
values ('fa100000-0000-4000-8000-000000000001', 2);

insert into public.videos (
  id, youtube_url, url_hash, title, channel_name, language
) values
  (
    'fa200000-0000-4000-8000-000000000001',
    'https://www.youtube.com/watch?v=analytcs001',
    'analytics-concurrency-1',
    'Analytics concurrency one',
    null,
    'en'
  ),
  (
    'fa200000-0000-4000-8000-000000000002',
    'https://www.youtube.com/watch?v=analytcs002',
    'analytics-concurrency-2',
    'Analytics concurrency two',
    null,
    'en'
  );

insert into public.video_transcripts (
  video_id, transcript_source, language, segments
)
select
  id,
  'manual_captions',
  'en',
  '[{"text":"Concurrency fixture","start":0,"duration":2}]'::jsonb
from public.videos
where id in (
  'fa200000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000002'
);

insert into public.summaries (
  video_id, summary, transcript_source, output_language
)
select id, 'Concurrency fixture', 'manual_captions', null
from public.videos
where id in (
  'fa200000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000002'
);

insert into public.project_videos (
  project_id, video_id, position, status, status_updated_at
) values
  (
    'fa100000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000001',
    1,
    'ready',
    clock_timestamp() - interval '2 minutes'
  ),
  (
    'fa100000-0000-4000-8000-000000000001',
    'fa200000-0000-4000-8000-000000000002',
    2,
    'ready',
    clock_timestamp() - interval '2 minutes'
  );

commit;

do $$
declare
  connection_string text := 'dbname=' || current_database();
  delayed_earlier jsonb;
  arrived_first jsonb;
  claim_earlier jsonb;
  claim_later jsonb;
  ack_earlier jsonb;
  ack_later jsonb;
  final_state public.project_analytics_state%rowtype;
  outbox_versions bigint[];
  outbox_kinds text[];
  outbox_times timestamptz[];
  claimed_versions bigint[];
  delivered_count integer;
begin
  perform dblink_connect('analytics_earlier', connection_string);
  perform dblink_connect('analytics_later', connection_string);
  perform dblink_exec('analytics_earlier', 'set role service_role');
  perform dblink_exec('analytics_later', 'set role service_role');

  perform dblink_send_query(
    'analytics_earlier',
    $query$
      with pause as materialized (select pg_sleep(0.3))
      select public.record_project_analytics_transition(
        'fa100000-0000-4000-8000-000000000001',
        'fa000000-0000-4000-8000-000000000001',
        'search',
        clock_timestamp() - interval '1 minute'
      ) from pause
    $query$
  );
  perform dblink_send_query(
    'analytics_later',
    $query$
      select public.record_project_analytics_transition(
        'fa100000-0000-4000-8000-000000000001',
        'fa000000-0000-4000-8000-000000000001',
        'message',
        clock_timestamp() - interval '30 seconds'
      )
    $query$
  );

  select result into arrived_first
  from dblink_get_result('analytics_later') as raced(result jsonb);
  select result into delayed_earlier
  from dblink_get_result('analytics_earlier') as raced(result jsonb);
  perform result
  from dblink_get_result('analytics_later') as cleared(result jsonb);
  perform result
  from dblink_get_result('analytics_earlier') as cleared(result jsonb);

  select * into final_state
  from public.project_analytics_state
    where project_id = 'fa100000-0000-4000-8000-000000000001';

  select
    array_agg(activation_revision order by activation_revision),
    array_agg(activation_kind order by activation_revision),
    array_agg(activated_at order by activation_revision)
  into outbox_versions, outbox_kinds, outbox_times
  from public.project_activation_outbox
  where project_id = 'fa100000-0000-4000-8000-000000000001';

  if arrived_first ->> 'outcome' <> 'activated'
    or arrived_first ->> 'activationKind' <> 'message'
    or delayed_earlier ->> 'outcome' <> 'already_activated'
    or delayed_earlier ->> 'activationKind' <> 'search'
    or final_state.first_qualifying_activity_kind <> 'search'
    or final_state.activation_kind <> 'search'
    or final_state.activation_revision <> 2
    or final_state.activated_at is distinct from
      final_state.first_qualifying_activity_at
    or outbox_versions <> array[1, 2]::bigint[]
    or outbox_kinds <> array['message', 'search']::text[]
    or outbox_times[2] is distinct from final_state.activated_at then
    raise exception
      'REGRESSION: action/outbox order lost (first %, delayed %, state %, versions %, kinds %, times %)',
      arrived_first, delayed_earlier, row_to_json(final_state),
      outbox_versions, outbox_kinds, outbox_times;
  end if;

  -- Two delivery workers can never own the same immutable revision.
  perform dblink_send_query(
    'analytics_earlier',
    'select public.claim_project_activation_exports(1)'
  );
  perform dblink_send_query(
    'analytics_later',
    'select public.claim_project_activation_exports(1)'
  );
  select result into claim_earlier
  from dblink_get_result('analytics_earlier') as claimed(result jsonb);
  select result into claim_later
  from dblink_get_result('analytics_later') as claimed(result jsonb);
  perform result
  from dblink_get_result('analytics_earlier') as cleared(result jsonb);
  perform result
  from dblink_get_result('analytics_later') as cleared(result jsonb);

  claimed_versions := array[
    (claim_earlier #>> '{exports,0,activationRevision}')::bigint,
    (claim_later #>> '{exports,0,activationRevision}')::bigint
  ];
  select array_agg(version order by version)
  into claimed_versions
  from unnest(claimed_versions) as claimed(version);
  if claimed_versions <> array[1, 2]::bigint[]
    or claim_earlier #>> '{exports,0,leaseToken}' =
      claim_later #>> '{exports,0,leaseToken}' then
    raise exception
      'REGRESSION: concurrent outbox workers duplicated a lease (a %, b %)',
      claim_earlier, claim_later;
  end if;

  select result into ack_earlier
  from dblink(
    'analytics_earlier',
    format(
      'select public.ack_project_activation_export(%L::uuid, %s, %L::uuid)',
      claim_earlier #>> '{exports,0,projectId}',
      claim_earlier #>> '{exports,0,activationRevision}',
      claim_earlier #>> '{exports,0,leaseToken}'
    )
  ) as acknowledged(result jsonb);
  select result into ack_later
  from dblink(
    'analytics_later',
    format(
      'select public.ack_project_activation_export(%L::uuid, %s, %L::uuid)',
      claim_later #>> '{exports,0,projectId}',
      claim_later #>> '{exports,0,activationRevision}',
      claim_later #>> '{exports,0,leaseToken}'
    )
  ) as acknowledged(result jsonb);
  select count(*)::integer into delivered_count
  from public.project_activation_outbox
  where project_id = 'fa100000-0000-4000-8000-000000000001'
    and delivered_at is not null;
  if ack_earlier ->> 'outcome' <> 'acknowledged'
    or ack_later ->> 'outcome' <> 'acknowledged'
    or delivered_count <> 2 then
    raise exception
      'REGRESSION: activation export acknowledgement diverged (a %, b %, delivered %)',
      ack_earlier, ack_later, delivered_count;
  end if;

  perform dblink_disconnect('analytics_earlier');
  perform dblink_disconnect('analytics_later');
end;
$$;

delete from auth.users
where id = 'fa000000-0000-4000-8000-000000000001';

delete from public.videos
where id in (
  'fa200000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000002'
);

reset search_path;
