-- Support stable, newest-first pagination of one Researcher's History.

create index user_video_history_user_accessed_video_idx
  on public.user_video_history (user_id, accessed_at desc, video_id);
