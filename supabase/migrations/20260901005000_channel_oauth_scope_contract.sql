-- Pin the persisted grant facts to the exact incremental OAuth contract.
--
-- The grant table never stores an access or refresh token. These columns are
-- provider-scope evidence only: the server-side OAuth adapter must update the
-- write pair atomically after the user performs the later write consent step.

alter table public.channel_oauth_grants
  add column read_scope text not null
    default 'https://www.googleapis.com/auth/youtube.readonly';

alter table public.channel_oauth_grants
  add column write_scope text;

alter table public.channel_oauth_grants
  add constraint channel_oauth_grants_read_scope_value_ck
  check (
    read_scope = 'https://www.googleapis.com/auth/youtube.readonly'
  );

alter table public.channel_oauth_grants
  add constraint channel_oauth_grants_write_scope_value_ck
  check (
    write_scope is null
    or write_scope = 'https://www.googleapis.com/auth/youtube.force-ssl'
  );

alter table public.channel_oauth_grants
  add constraint channel_oauth_grants_write_scope_granted_ck
  check (
    (write_scope_granted is false and write_scope is null)
    or (
      write_scope_granted is true
      and write_scope = 'https://www.googleapis.com/auth/youtube.force-ssl'
    )
  );

notify pgrst, 'reload schema';
