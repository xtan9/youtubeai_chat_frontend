-- Real two-session proof that equivalent URL-only and explicit canonical-ID
-- writes converge on one Video UUID.

create schema if not exists extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

delete from public.videos where youtube_video_id = 'BaW_jenozKc';

do $$
declare
  connection_string text := 'dbname=' || current_database();
  url_only_id uuid;
  explicit_id uuid;
begin
  perform dblink_connect('video_identity_url', connection_string);
  perform dblink_connect('video_identity_explicit', connection_string);

  perform dblink_send_query(
    'video_identity_url',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      insert into public.videos (youtube_url, title, language)
      select
        'https://www.youtube.com/embed/BaW_jenozKc',
        'URL-only concurrent Video',
        'en'
      from pause
      on conflict (youtube_video_id) do update
      set title = excluded.title
      returning id
    $query$
  );
  perform dblink_send_query(
    'video_identity_explicit',
    $query$
      with pause as materialized (select pg_sleep(0.2))
      insert into public.videos (
        youtube_url,
        youtube_video_id,
        title,
        language
      )
      select
        'https://youtu.be/BaW_jenozKc',
        'BaW_jenozKc',
        'Explicit-ID concurrent Video',
        'en'
      from pause
      on conflict (youtube_video_id) do update
      set title = excluded.title
      returning id
    $query$
  );

  select id into url_only_id
  from dblink_get_result('video_identity_url') as raced(id uuid);
  select id into explicit_id
  from dblink_get_result('video_identity_explicit') as raced(id uuid);

  if url_only_id is distinct from explicit_id
    or (select count(*) from public.videos
        where youtube_video_id = 'BaW_jenozKc') <> 1
  then
    raise exception
      'REGRESSION: concurrent equivalent identities produced different Videos: %, %',
      url_only_id,
      explicit_id;
  end if;

  perform dblink_disconnect('video_identity_url');
  perform dblink_disconnect('video_identity_explicit');
end;
$$;

delete from public.videos where youtube_video_id = 'BaW_jenozKc';

reset search_path;
