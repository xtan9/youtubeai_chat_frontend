-- Map canonical evidence mutations to a monotonically increasing Video row.

create function project_private.touch_video_evidence_version_v2()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  old_video_id uuid;
  new_video_id uuid;
begin
  if tg_table_name = 'videos' then
    new.evidence_version := old.evidence_version + 1;
    return new;
  end if;

  old_video_id := case when tg_op = 'INSERT' then null else old.video_id end;
  new_video_id := case when tg_op = 'DELETE' then null else new.video_id end;

  if old_video_id is not null then
    update public.videos
    set evidence_version = evidence_version + 1
    where id = old_video_id;
  end if;
  if new_video_id is not null and new_video_id is distinct from old_video_id then
    update public.videos
    set evidence_version = evidence_version + 1
    where id = new_video_id;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function project_private.touch_video_evidence_version_v2()
  from public, anon, authenticated, service_role;
