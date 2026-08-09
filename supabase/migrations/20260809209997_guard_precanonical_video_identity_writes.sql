-- Keep the currently deployed url_hash cache writer from introducing another
-- unsupported URL between the incident repair and the canonical-identity
-- migration. This guard is deliberately temporary: 20260809210000 installs
-- the durable youtube_video_id trigger, and 20260809210025 removes this seam.

create function project_private.is_precanonical_youtube_identity(input text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    btrim(input) ~ '^[A-Za-z0-9_-]{11}$'
    or (
      btrim(input) ~* '^https?://(?:www[.]|m[.]|music[.])?youtube[.]com/watch(?:[?].*)?$'
      and btrim(input) ~ '[?&]v=[A-Za-z0-9_-]{11}(?:[&#]|$)'
    )
    or btrim(input) ~* '^https?://youtu[.]be/[A-Za-z0-9_-]{11}/?(?:[?#].*)?$'
    or btrim(input) ~* '^https?://(?:www[.]|m[.]|music[.])?youtube[.]com/(?:embed|live|shorts|v)/[A-Za-z0-9_-]{11}/?(?:[?#].*)?$';
$$;

revoke all on function project_private.is_precanonical_youtube_identity(text)
  from public, anon, authenticated, service_role;

create function project_private.guard_precanonical_video_identity_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(
    project_private.is_precanonical_youtube_identity(new.youtube_url),
    false
  ) then
    raise exception using
      errcode = '22023',
      message = 'youtube_url must contain a supported YouTube video ID';
  end if;

  return new;
end;
$$;

revoke all on function project_private.guard_precanonical_video_identity_write()
  from public, anon, authenticated, service_role;

create trigger videos_guard_precanonical_identity_write
  before insert or update of youtube_url, url_hash
  on public.videos
  for each row
  execute function project_private.guard_precanonical_video_identity_write();
