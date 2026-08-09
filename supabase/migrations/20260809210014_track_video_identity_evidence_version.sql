-- Identity and display metadata are copied into manifests and citations.

create trigger videos_evidence_version
before update of youtube_url, url_hash, title, channel_name, language
on public.videos
for each row execute function
  project_private.touch_video_evidence_version_v2();
