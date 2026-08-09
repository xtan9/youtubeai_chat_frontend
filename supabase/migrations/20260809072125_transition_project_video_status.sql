-- The service-only status writer advances the Source Set revision exactly
-- once for each logical readiness transition.

create function public.transition_project_video_status(
  p_project_id uuid,
  p_video_id uuid,
  p_status text,
  p_failure_code text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision bigint;
  current_status text;
  current_failure_code text;
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

  if p_expected_revision is distinct from current_revision then
    return jsonb_build_object(
      'outcome', 'conflict',
      'revision', current_revision
    );
  end if;

  select status, failure_code
  into current_status, current_failure_code
  from public.project_videos
  where project_id = p_project_id
    and video_id = p_video_id;

  if current_status is null then
    return jsonb_build_object(
      'outcome', 'membership_missing',
      'revision', current_revision
    );
  end if;

  if p_status is null
    or p_status not in ('processing', 'ready', 'failed')
    or (p_status = 'failed' and (
      p_failure_code is null
      or p_failure_code <> lower(btrim(p_failure_code))
      or p_failure_code !~ '^[a-z0-9_]{1,64}$'
    ))
    or (p_status <> 'failed' and p_failure_code is not null) then
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

  if current_status = p_status
    and current_failure_code is not distinct from p_failure_code then
    return jsonb_build_object(
      'outcome', 'unchanged',
      'revision', current_revision
    );
  end if;

  update public.project_videos
  set status = p_status,
      failure_code = p_failure_code,
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

revoke all on function public.transition_project_video_status(
  uuid, uuid, text, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.transition_project_video_status(
  uuid, uuid, text, text, bigint
) to service_role;

notify pgrst, 'reload schema';
