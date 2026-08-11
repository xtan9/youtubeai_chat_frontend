-- Keep the existing Catalog Admission evidence fresh without introducing any
-- Profile, Discovery, Assessment, or Recommendation Set behavior. Expired
-- Videos fail closed before their existing Nomination is re-enqueued through
-- the ordinary Catalog Admission queue.

create or replace function catalog_private.schedule_catalog_admission_refresh(
  p_batch_size integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  refresh_idempotency_key text;
  queue_message_id bigint;
  invalidated_count integer := 0;
  scheduled_count integer := 0;
begin
  for candidate in
    select
      video.id as video_id,
      video.catalog_state,
      nomination.id as nomination_id,
      nomination.status as nomination_status,
      admission.id as admission_id,
      admission.decision as admission_decision,
      admission.policy_version
    from public.videos as video
    join catalog_private.catalog_nominations as nomination
      on nomination.video_id = video.id
    left join lateral (
      select current_admission.id,
             current_admission.decision,
             current_admission.policy_version
      from catalog_private.catalog_admissions as current_admission
      where current_admission.video_id = video.id
      order by current_admission.decided_at desc, current_admission.id desc
      limit 1
    ) as admission on true
    where video.provider_evidence_expires_at is not null
      and video.provider_evidence_expires_at <= clock_timestamp()
      and (
        video.catalog_state = 'active'
        or (
          video.catalog_state = 'inactive'
          and video.catalog_inactive_reason = 'stale_evidence'
          and nomination.status = 'admitted'
        )
      )
    order by video.provider_evidence_expires_at, video.id
    limit least(greatest(coalesce(p_batch_size, 4), 1), 20)
    for update of video, nomination skip locked
  loop
    if candidate.catalog_state = 'active' then
      update public.videos
      set catalog_state = 'inactive',
          catalog_inactive_reason = 'stale_evidence'
      where id = candidate.video_id;
      invalidated_count := invalidated_count + 1;
    end if;

    if candidate.nomination_status <> 'admitted'
      or candidate.admission_id is null
      or candidate.admission_decision <> 'admitted'
      or candidate.policy_version <> 'catalog-admission-v1'
    then
      continue;
    end if;

    refresh_idempotency_key :=
      candidate.nomination_id::text
      || ':catalog-admission-v1:refresh:'
      || candidate.admission_id::text;

    select send into queue_message_id
    from pgmq.send(
      'catalog_admission',
      jsonb_build_object(
        'nomination_id', candidate.nomination_id,
        'policy_version', 'catalog-admission-v1',
        'idempotency_key', refresh_idempotency_key,
        'priority', 'high',
        'trace_id', 'catalog-refresh:' || candidate.nomination_id::text
      ),
      0
    );
    if queue_message_id is null then
      raise exception 'Catalog Admission refresh queue write failed';
    end if;

    update catalog_private.catalog_nominations
    set status = 'pending',
        decided_at = null,
        last_failure_code = null
    where id = candidate.nomination_id
      and status = 'admitted';
    if not found then
      raise exception 'Catalog Nomination refresh transition failed';
    end if;

    scheduled_count := scheduled_count + 1;
  end loop;

  return jsonb_build_object(
    'outcome', 'scheduled',
    'invalidated', invalidated_count,
    'scheduled', scheduled_count
  );
end;
$$;

create or replace function public.schedule_catalog_admission_refresh(
  p_batch_size integer
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
  return catalog_private.schedule_catalog_admission_refresh(p_batch_size);
end;
$$;

revoke all on function catalog_private.schedule_catalog_admission_refresh(integer)
  from public, anon, authenticated, service_role;
grant execute on function catalog_private.schedule_catalog_admission_refresh(integer)
  to service_role;

revoke all on function public.schedule_catalog_admission_refresh(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.schedule_catalog_admission_refresh(integer)
  to service_role;

notify pgrst, 'reload schema';
