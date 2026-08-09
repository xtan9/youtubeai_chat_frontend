-- The old status writer cannot safely participate in leased processing: it
-- neither returns an attempt token when starting work nor requires one when
-- finalizing. The attempt-aware start/finalize RPCs supersede this exact API.

revoke all on function public.transition_project_video_status(
  uuid, uuid, text, text, bigint
) from public, anon, authenticated, service_role;

drop function public.transition_project_video_status(
  uuid, uuid, text, text, bigint
);

notify pgrst, 'reload schema';
