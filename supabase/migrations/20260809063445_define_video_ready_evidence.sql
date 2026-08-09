-- One private predicate defines when durable canonical evidence can support a
-- ready Project membership. All Source Set writers and candidate readers use
-- this capability so readiness cannot drift between paths.

create function project_private.video_has_durable_ready_evidence(
  p_video_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.video_transcripts
      where video_id = p_video_id
        and case
          when jsonb_typeof(segments) = 'array'
            then jsonb_array_length(segments) > 0
          else false
        end
    )
    and exists (
      select 1
      from public.summaries
      where video_id = p_video_id
        and btrim(summary) <> ''
    );
$$;

revoke all on function
  project_private.video_has_durable_ready_evidence(uuid)
  from public, anon, authenticated, service_role;
