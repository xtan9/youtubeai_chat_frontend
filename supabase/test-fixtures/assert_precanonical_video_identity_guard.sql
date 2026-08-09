-- Run immediately after the temporary pre-canonical write guard is installed.

begin;

insert into public.videos (id, youtube_url, url_hash, language)
values
  (
    'b9970000-0000-4000-8000-000000000001',
    'aaaaaaa0001',
    'b9970000000000000000000000000001',
    'en'
  ),
  (
    'b9970000-0000-4000-8000-000000000002',
    'https://www.youtube.com/watch?list=fixture&v=aaaaaaa0002&t=3',
    'b9970000000000000000000000000002',
    'en'
  ),
  (
    'b9970000-0000-4000-8000-000000000003',
    'https://youtu.be/aaaaaaa0003?si=fixture',
    'b9970000000000000000000000000003',
    'en'
  ),
  (
    'b9970000-0000-4000-8000-000000000004',
    'https://youtube.com/embed/aaaaaaa0004',
    'b9970000000000000000000000000004',
    'en'
  ),
  (
    'b9970000-0000-4000-8000-000000000005',
    'https://m.youtube.com/live/aaaaaaa0005',
    'b9970000000000000000000000000005',
    'en'
  ),
  (
    'b9970000-0000-4000-8000-000000000006',
    'https://music.youtube.com/shorts/aaaaaaa0006',
    'b9970000000000000000000000000006',
    'en'
  ),
  (
    'b9970000-0000-4000-8000-000000000007',
    'http://www.youtube.com/v/aaaaaaa0007/',
    'b9970000000000000000000000000007',
    'en'
  );

do $$
declare
  unsupported_insert_rejected boolean := false;
  redirect_insert_rejected boolean := false;
  unsupported_update_rejected boolean := false;
begin
  begin
    insert into public.videos (youtube_url, url_hash, language)
    values (
      'https://youtube.com/@unsupported-channel',
      'b9970000000000000000000000000008',
      'en'
    );
  exception when sqlstate '22023' then
    unsupported_insert_rejected := true;
  end;

  begin
    insert into public.videos (youtube_url, url_hash, language)
    values (
      'https://www.youtube.com/redirect?v=aaaaaaa0008',
      'b9970000000000000000000000000009',
      'en'
    );
  exception when sqlstate '22023' then
    redirect_insert_rejected := true;
  end;

  begin
    update public.videos
    set youtube_url = 'https://youtube.com/@unsupported-update'
    where id = 'b9970000-0000-4000-8000-000000000001';
  exception when sqlstate '22023' then
    unsupported_update_rejected := true;
  end;

  if not unsupported_insert_rejected
    or not redirect_insert_rejected
    or not unsupported_update_rejected
    or not exists (
      select 1
      from public.videos
      where id = 'b9970000-0000-4000-8000-000000000001'
        and youtube_url = 'aaaaaaa0001'
    )
  then
    raise exception 'REGRESSION: temporary canonical Video write guard drifted';
  end if;
end;
$$;

delete from public.videos
where id::text like 'b9970000-0000-4000-8000-%';

commit;
