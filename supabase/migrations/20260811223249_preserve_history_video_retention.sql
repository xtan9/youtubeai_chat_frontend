-- History is the learner's durable identity for a Video. Catalog maintenance
-- may mark that Video inactive, but it must never delete it as a side effect
-- of purging stale catalog state. Replace the legacy cascade with a restrictive
-- foreign key so only an explicitly removed History row can unblock deletion.
alter table public.user_video_history
  drop constraint if exists user_video_history_video_id_fkey;

alter table public.user_video_history
  add constraint user_video_history_video_id_fkey
  foreign key (video_id)
  references public.videos(id)
  on delete restrict;
