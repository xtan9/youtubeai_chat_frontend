-- Defense in depth for service-role and future ingestion writers. Application
-- RPCs provide friendly outcomes, while this trigger makes the five-Video
-- grounding limit universal under concurrent direct writes too.

create function project_private.enforce_project_video_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.projects
  where id = new.project_id
  for update;

  if (
    select count(*)
    from public.project_videos
    where project_id = new.project_id
  ) >= 5 then
    raise check_violation
      using
        constraint = 'project_videos_five_video_limit',
        message = 'A Project Source Set cannot contain more than five Videos.';
  end if;

  return new;
end;
$$;

revoke all on function project_private.enforce_project_video_limit()
  from public, anon, authenticated, service_role;

create trigger project_videos_enforce_limit
before insert on public.project_videos
for each row execute function project_private.enforce_project_video_limit();
