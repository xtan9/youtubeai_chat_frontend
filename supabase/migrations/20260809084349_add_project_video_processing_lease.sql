-- A processing attempt is a durable lease. The token prevents an older
-- background invocation from completing a newer retry after a deploy or
-- timeout. status_updated_at is the lease clock so the membership keeps one
-- authoritative lifecycle timestamp.

alter table public.project_videos
  add column processing_attempt_id uuid;

update public.project_videos
set processing_attempt_id = gen_random_uuid()
where status = 'processing';

alter table public.project_videos
  add constraint project_videos_processing_lease_consistent check (
    (
      status = 'processing'
      and processing_attempt_id is not null
      and failure_code is null
    )
    or (
      status in ('ready', 'failed')
      and processing_attempt_id is null
    )
  );
