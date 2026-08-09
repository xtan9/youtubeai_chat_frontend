-- Complete only the processing lease owned by the caller. Evidence readiness
-- is rechecked in the database before a membership becomes groundable.

create function public.finalize_project_video_processing(
  p_project_id uuid,
  p_video_id uuid,
  p_attempt_id uuid,
  p_status text,
  p_failure_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision bigint;
  current_status text;
  current_attempt_id uuid;
begin
  perform 1
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'missing');
  end if;

  select revision
  into current_revision
  from public.project_source_sets
  where project_id = p_project_id
  for update;

  if current_revision is null then
    return jsonb_build_object('outcome', 'membership_missing', 'revision', 0);
  end if;

  select status, processing_attempt_id
  into current_status, current_attempt_id
  from public.project_videos
  where project_id = p_project_id
    and video_id = p_video_id
  for update;

  if current_status is null then
    return jsonb_build_object(
      'outcome', 'membership_missing',
      'revision', current_revision
    );
  end if;

  if current_status <> 'processing'
    or current_attempt_id is distinct from p_attempt_id then
    return jsonb_build_object(
      'outcome', 'stale_attempt',
      'revision', current_revision
    );
  end if;

  if p_status is null
    or p_status not in ('ready', 'failed')
    or (p_status = 'failed' and (
      p_failure_code is null
      or p_failure_code <> lower(btrim(p_failure_code))
      or p_failure_code !~ '^[a-z0-9_]{1,64}$'
    ))
    or (p_status = 'ready' and p_failure_code is not null) then
    return jsonb_build_object(
      'outcome', 'invalid_status',
      'revision', current_revision
    );
  end if;

  if p_status = 'ready'
    and not project_private.video_has_durable_ready_evidence(p_video_id) then
    return jsonb_build_object(
      'outcome', 'evidence_missing',
      'revision', current_revision
    );
  end if;

  update public.project_videos
  set status = p_status,
      failure_code = p_failure_code,
      processing_attempt_id = null,
      status_updated_at = now()
  where project_id = p_project_id
    and video_id = p_video_id;

  update public.project_source_sets
  set revision = current_revision + 1,
      updated_at = now()
  where project_id = p_project_id
  returning revision into current_revision;

  return jsonb_build_object(
    'outcome', 'transitioned',
    'revision', current_revision
  );
end;
$$;

revoke all on function public.finalize_project_video_processing(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_project_video_processing(
  uuid, uuid, uuid, text, text
) to service_role;

notify pgrst, 'reload schema';
