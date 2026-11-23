-- A retained video conversation provides a user/video pair that the shared
-- summary cache alone cannot establish. Limit recovery to activity before
-- the cache-hit history fix shipped. Preserve every existing history row.
do $$
declare
  restored bigint;
begin
  lock table public.user_video_history in share row exclusive mode;
  with conversations as (
    select m.user_id, m.video_id, max(m.created_at) as viewed_at
    from public.chat_messages m
    join auth.users u on u.id = m.user_id and not coalesce(u.is_anonymous, false)
    join public.videos v on v.id = m.video_id
    where m.created_at < timestamptz '2026-11-23 18:16:59+00'
      and v.youtube_video_id not in (
        'Hrbq66XqtCo', 'nm1TxQj9IsQ', 'Mde2q7GFCrw',
        'csA9YhzYvmk', 'BWJ4vnXIvts', 'Yy-EC-BdoNY'
      )
      and exists (select 1 from public.summaries s where s.video_id = m.video_id)
      and not exists (
        select 1 from public.user_video_history h
        where h.user_id = m.user_id and h.video_id = m.video_id
      )
    group by m.user_id, m.video_id
    having bool_or(m.role = 'user') and bool_or(m.role = 'assistant')
  ), ranked as (
    select c.*, row_number() over (
      partition by user_id order by viewed_at desc, video_id
    ) as position
    from conversations c
  ), retained as (
    select user_id, count(*) as used from public.user_video_history group by user_id
  )
  insert into public.user_video_history (user_id, video_id, accessed_at)
  select r.user_id, r.video_id, r.viewed_at
  from ranked r
  left join retained h on h.user_id = r.user_id
  left join public.user_subscriptions s on s.user_id = r.user_id
  where s.tier = 'pro' or r.position <= 10 - coalesce(h.used, 0)
  on conflict (user_id, video_id) do nothing;

  get diagnostics restored = row_count;
  raise notice 'Recovered % retained summary history rows', restored;
end;
$$;
