\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
select
  format('78000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  'authenticated',
  'authenticated',
  format('anonymous-controls-%s@example.test', n),
  '',
  now(),
  now()
from generate_series(1, 30) as n
on conflict (id) do nothing;

set local role service_role;

do $$
declare
  admitted jsonb;
  denied jsonb;
begin
  admitted := public.reserve_anonymous_trial_chat_message(
    '78000000-0000-4000-8000-000000000001'::uuid,
    repeat('a', 64),
    100000,
    1000,
    true
  );
  if admitted->>'outcome' <> 'admitted' then
    raise exception 'expected atomic admission, got %', admitted;
  end if;

  denied := public.reserve_anonymous_trial_chat_message(
    '78000000-0000-4000-8000-000000000001'::uuid,
    repeat('a', 64),
    100000,
    1000,
    true
  );
  if denied->>'outcome' <> 'concurrent' then
    raise exception 'expected cross-session lease denial, got %', denied;
  end if;

  denied := public.reserve_anonymous_trial_chat_message(
    '78000000-0000-4000-8000-000000000002'::uuid,
    repeat('b', 64),
    100000,
    1000,
    false
  );
  if denied->>'outcome' <> 'global_shutdown' then
    raise exception 'expected kill-switch denial, got %', denied;
  end if;
end;
$$;

rollback;
