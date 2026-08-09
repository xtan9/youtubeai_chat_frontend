-- 20260809210000 now owns canonical identity enforcement. Remove only the
-- temporary DB-first rollout seam; retained quarantine snapshots remain
-- private for deliberate recovery/audit work.

drop trigger videos_guard_precanonical_identity_write on public.videos;

drop function project_private.guard_precanonical_video_identity_write();
drop function project_private.is_precanonical_youtube_identity(text);
