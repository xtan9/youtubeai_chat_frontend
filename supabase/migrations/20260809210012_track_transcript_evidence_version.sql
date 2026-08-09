-- Transcript text, timing, language, and provenance are canonical evidence.

create trigger video_transcripts_evidence_version
after insert or update or delete on public.video_transcripts
for each row execute function
  project_private.touch_video_evidence_version_v2();
