-- Summary availability participates in the durable readiness projection.

create trigger summaries_video_evidence_version
after insert or update or delete on public.summaries
for each row execute function
  project_private.touch_video_evidence_version_v2();
