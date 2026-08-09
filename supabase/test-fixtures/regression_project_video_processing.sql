-- Contract proof for durable Project URL processing. Run against both the
-- representative legacy upgrade and an independent fresh migration replay.

begin;

insert into auth.users (id, is_anonymous)
values
  ('54000000-0000-4000-8000-000000000004', false),
  ('55000000-0000-4000-8000-000000000005', false)
on conflict (id) do update set is_anonymous = excluded.is_anonymous;

insert into public.user_subscriptions (user_id, stripe_customer_id, tier, status)
values (
  '54000000-0000-4000-8000-000000000004',
  'cus_project_url_processing',
  'pro',
  'active'
)
on conflict (user_id) do update set tier = excluded.tier, status = excluded.status;

insert into public.projects (id, workspace_id, name)
select 'a3000000-0000-4000-8000-000000000001', id, 'Project URL lifecycle'
from public.workspaces
where owner_id = '54000000-0000-4000-8000-000000000004';

insert into public.projects (id, workspace_id, name)
select 'a3000000-0000-4000-8000-000000000002', id, 'Project URL cap'
from public.workspaces
where owner_id = '54000000-0000-4000-8000-000000000004';

insert into public.projects (id, workspace_id, name)
select 'a3000000-0000-4000-8000-000000000003', id, 'Project URL recovery'
from public.workspaces
where owner_id = '54000000-0000-4000-8000-000000000004';

create temporary table project_url_results (
  label text primary key,
  result jsonb not null
) on commit drop;
grant select, insert on project_url_results to authenticated, service_role;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.project_videos'::regclass
      and conname = 'project_videos_processing_lease_consistent'
      and contype = 'c'
  )
  or not exists (
    select 1
    from pg_proc
    where oid = 'public.start_project_video_processing(uuid,text,bigint)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=""']
  )
  or not exists (
    select 1
    from pg_proc
    where oid = 'public.finalize_project_video_processing(uuid,uuid,uuid,text,text)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=""']
  )
  or not exists (
    select 1
    from pg_proc
    where oid = 'public.expire_stale_project_video_processing(uuid)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=""']
  ) then
    raise exception 'REGRESSION: Project Video processing constraints or hardened RPCs are missing';
  end if;

  if to_regprocedure(
    'public.transition_project_video_status(uuid,uuid,text,text,bigint)'
  ) is not null then
    raise exception 'REGRESSION: obsolete attempt-less status writer remains in the API catalog';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.start_project_video_processing(uuid,text,bigint)',
    'EXECUTE'
  )
  or has_function_privilege(
    'anon',
    'public.start_project_video_processing(uuid,text,bigint)',
    'EXECUTE'
  )
  or has_function_privilege(
    'authenticated',
    'public.finalize_project_video_processing(uuid,uuid,uuid,text,text)',
    'EXECUTE'
  )
  or not has_function_privilege(
    'service_role',
    'public.finalize_project_video_processing(uuid,uuid,uuid,text,text)',
    'EXECUTE'
  )
  or has_function_privilege(
    'authenticated',
    'public.expire_stale_project_video_processing(uuid)',
    'EXECUTE'
  )
  or not has_function_privilege(
    'service_role',
    'public.expire_stale_project_video_processing(uuid)',
    'EXECUTE'
  ) then
    raise exception 'REGRESSION: Project Video processing grants are not least privilege';
  end if;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '54000000-0000-4000-8000-000000000004',
  true
);

insert into project_url_results
values (
  'invalid',
  public.start_project_video_processing(
    'a3000000-0000-4000-8000-000000000001',
    'not-valid',
    0
  )
);

insert into project_url_results
values (
  'started',
  public.start_project_video_processing(
    'a3000000-0000-4000-8000-000000000001',
    'urltest0001',
    0
  )
);

insert into project_url_results
values (
  'duplicate_processing',
  public.start_project_video_processing(
    'a3000000-0000-4000-8000-000000000001',
    'urltest0001',
    0
  )
);

reset role;

do $$
declare
  started jsonb := (select result from project_url_results where label = 'started');
  duplicate jsonb := (select result from project_url_results where label = 'duplicate_processing');
begin
  if (select result->>'outcome' from project_url_results where label = 'invalid') <> 'invalid_video'
    or exists (select 1 from public.videos where url_hash = 'not-valid')
    or started->>'outcome' <> 'started'
    or started->>'ownsProcessing' <> 'true'
    or duplicate->>'outcome' <> 'already_processing'
    or duplicate->>'ownsProcessing' <> 'false'
    or duplicate->>'revision' <> started->>'revision'
    or (select count(*) from public.project_videos
        where project_id = 'a3000000-0000-4000-8000-000000000001') <> 1
  then
    raise exception 'REGRESSION: invalid or duplicate processing reservation changed membership';
  end if;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '55000000-0000-4000-8000-000000000005',
  true
);
insert into project_url_results
values (
  'attacker',
  public.start_project_video_processing(
    'a3000000-0000-4000-8000-000000000001',
    'urltest0002',
    1
  )
);
reset role;

do $$
begin
  if (select result->>'outcome' from project_url_results where label = 'attacker') <> 'missing'
    or exists (select 1 from public.videos where url_hash = 'urltest0002') then
    raise exception 'REGRESSION: non-owner processing request leaked or created canonical state';
  end if;
end;
$$;

set local role service_role;
insert into project_url_results
select
  'evidence_missing',
  public.finalize_project_video_processing(
    'a3000000-0000-4000-8000-000000000001',
    (result->>'videoId')::uuid,
    (result->>'attemptId')::uuid,
    'ready',
    null
  )
from project_url_results
where label = 'started';
reset role;

do $$
declare
  target_video_id uuid := (
    select (result->>'videoId')::uuid
    from project_url_results
    where label = 'started'
  );
begin
  if (select result->>'outcome' from project_url_results where label = 'evidence_missing') <> 'evidence_missing'
    or (select status from public.project_videos
        where project_id = 'a3000000-0000-4000-8000-000000000001'
          and video_id = target_video_id) <> 'processing' then
    raise exception 'REGRESSION: membership became ready without durable evidence';
  end if;

  insert into public.video_transcripts (video_id, transcript_source, language, segments)
  values (
    target_video_id,
    'manual_captions',
    'en',
    '[{"text":"Durable Project transcript","start":0,"duration":5}]'::jsonb
  );
  insert into public.summaries (video_id, summary, transcript_source, output_language)
  values (target_video_id, 'Durable Project summary', 'manual_captions', null);
end;
$$;

set local role service_role;
insert into project_url_results
select
  'wrong_attempt',
  public.finalize_project_video_processing(
    'a3000000-0000-4000-8000-000000000001',
    (result->>'videoId')::uuid,
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'ready',
    null
  )
from project_url_results
where label = 'started';

insert into project_url_results
select
  'ready',
  public.finalize_project_video_processing(
    'a3000000-0000-4000-8000-000000000001',
    (result->>'videoId')::uuid,
    (result->>'attemptId')::uuid,
    'ready',
    null
  )
from project_url_results
where label = 'started';
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '54000000-0000-4000-8000-000000000004',
  true
);
insert into project_url_results
values (
  'duplicate_ready',
  public.start_project_video_processing(
    'a3000000-0000-4000-8000-000000000001',
    'urltest0001',
    2
  )
);
reset role;

do $$
begin
  if (select result->>'outcome' from project_url_results where label = 'wrong_attempt') <> 'stale_attempt'
    or (select result->>'outcome' from project_url_results where label = 'ready') <> 'transitioned'
    or (select result->>'outcome' from project_url_results where label = 'duplicate_ready') <> 'already_ready'
    or (select status from public.project_videos
        where project_id = 'a3000000-0000-4000-8000-000000000001') <> 'ready'
  then
    raise exception 'REGRESSION: attempt fencing, ready transition, or cache reuse failed';
  end if;
end;
$$;

-- Fill a separate Source Set. The rejected sixth URL must not even create a
-- canonical videos row: cap/revision is checked before that insert.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '54000000-0000-4000-8000-000000000004',
  true
);
insert into project_url_results
select
  'cap_' || ordinal,
  public.start_project_video_processing(
    'a3000000-0000-4000-8000-000000000002',
    'urlcap0000' || ordinal,
    ordinal - 1
  )
from generate_series(1, 5) ordinal;
insert into project_url_results
values (
  'cap_rejected',
  public.start_project_video_processing(
    'a3000000-0000-4000-8000-000000000002',
    'urlcap00006',
    5
  )
);
reset role;

do $$
begin
  if (select result->>'outcome' from project_url_results where label = 'cap_rejected') <> 'limit_reached'
    or (select count(*) from public.project_videos
        where project_id = 'a3000000-0000-4000-8000-000000000002') <> 5
    or exists (select 1 from public.videos where url_hash = 'urlcap00006') then
    raise exception 'REGRESSION: universal cap produced a canonical or membership side effect';
  end if;
end;
$$;

-- Prove failure -> retry uses the same membership and removal preserves the
-- ready source already in the Project.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '54000000-0000-4000-8000-000000000004',
  true
);
insert into project_url_results
values (
  'failure_started',
  public.start_project_video_processing(
    'a3000000-0000-4000-8000-000000000001',
    'urltest0003',
    2
  )
);
reset role;

set local role service_role;
insert into project_url_results
select
  'failed',
  public.finalize_project_video_processing(
    'a3000000-0000-4000-8000-000000000001',
    (result->>'videoId')::uuid,
    (result->>'attemptId')::uuid,
    'failed',
    'summary_processing'
  )
from project_url_results
where label = 'failure_started';
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '54000000-0000-4000-8000-000000000004',
  true
);
insert into project_url_results
values (
  'retry',
  public.start_project_video_processing(
    'a3000000-0000-4000-8000-000000000001',
    'urltest0003',
    4
  )
);
reset role;

set local role service_role;
insert into project_url_results
select
  'retry_failed',
  public.finalize_project_video_processing(
    'a3000000-0000-4000-8000-000000000001',
    (result->>'videoId')::uuid,
    (select (result->>'attemptId')::uuid from project_url_results where label = 'retry'),
    'failed',
    'summary_processing'
  )
from project_url_results
where label = 'failure_started';
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '54000000-0000-4000-8000-000000000004',
  true
);
insert into project_url_results
select
  'removed',
  public.remove_project_video(
    'a3000000-0000-4000-8000-000000000001',
    (result->>'videoId')::uuid,
    6
  )
from project_url_results
where label = 'failure_started';
reset role;

do $$
begin
  if (select result->>'outcome' from project_url_results where label = 'failed') <> 'transitioned'
    or (select result->>'outcome' from project_url_results where label = 'retry') <> 'retry_started'
    or (select result->>'attemptId' from project_url_results where label = 'retry')
       = (select result->>'attemptId' from project_url_results where label = 'failure_started')
    or (select result->>'outcome' from project_url_results where label = 'removed') <> 'removed'
    or (select count(*) from public.project_videos
        where project_id = 'a3000000-0000-4000-8000-000000000001') <> 1
    or (select status from public.project_videos
        where project_id = 'a3000000-0000-4000-8000-000000000001') <> 'ready'
  then
    raise exception 'REGRESSION: failed retry/removal duplicated or removed another source';
  end if;
end;
$$;

-- A stale lease is classified and can be retried; the old invocation cannot
-- finalize the newer retry because its attempt token no longer matches.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '54000000-0000-4000-8000-000000000004',
  true
);
insert into project_url_results
values (
  'stale_started',
  public.start_project_video_processing(
    'a3000000-0000-4000-8000-000000000003',
    'urltest0004',
    0
  )
);
reset role;

update public.project_videos
set status_updated_at = now() - interval '7 minutes'
where project_id = 'a3000000-0000-4000-8000-000000000003';

set local role service_role;
insert into project_url_results
values (
  'expired',
  public.expire_stale_project_video_processing(
    'a3000000-0000-4000-8000-000000000003'
  )
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '54000000-0000-4000-8000-000000000004',
  true
);
insert into project_url_results
values (
  'stale_retry',
  public.start_project_video_processing(
    'a3000000-0000-4000-8000-000000000003',
    'urltest0004',
    2
  )
);
reset role;

set local role service_role;
insert into project_url_results
select
  'old_finalize',
  public.finalize_project_video_processing(
    'a3000000-0000-4000-8000-000000000003',
    (result->>'videoId')::uuid,
    (result->>'attemptId')::uuid,
    'failed',
    'summary_processing'
  )
from project_url_results
where label = 'stale_started';
reset role;

do $$
begin
  if (select result->>'outcome' from project_url_results where label = 'expired') <> 'expired'
    or (select result->>'expiredCount' from project_url_results where label = 'expired') <> '1'
    or (select result->>'outcome' from project_url_results where label = 'stale_retry') <> 'retry_started'
    or (select result->>'outcome' from project_url_results where label = 'old_finalize') <> 'stale_attempt'
    or (select status from public.project_videos
        where project_id = 'a3000000-0000-4000-8000-000000000003') <> 'processing'
  then
    raise exception 'REGRESSION: stale processing recovery or attempt fencing failed';
  end if;
end;
$$;

rollback;
