-- Final catalog contract for both normal and late-backdated application order.

do $$
declare
  exposed_role text;
  table_privilege text;
begin
  if to_regprocedure(
      'project_private.guard_precanonical_video_identity_write()'
    ) is not null
    or to_regprocedure(
      'project_private.is_precanonical_youtube_identity(text)'
    ) is not null
    or exists (
      select 1
      from pg_trigger
      where tgrelid = 'public.videos'::regclass
        and tgname = 'videos_guard_precanonical_identity_write'
        and not tgisinternal
    )
  then
    raise exception 'REGRESSION: temporary Video identity guard survived cleanup';
  end if;

  if to_regclass(
      'project_private.legacy_video_identity_quarantine'
    ) is null
    or not exists (
      select 1
      from pg_class
      where oid = 'project_private.legacy_video_identity_quarantine'::regclass
        and relrowsecurity
    )
    or exists (
      select 1
      from pg_class as quarantine_class
      cross join lateral aclexplode(coalesce(
        quarantine_class.relacl,
        acldefault('r', quarantine_class.relowner)
      )) as quarantine_acl
      where quarantine_class.oid =
        'project_private.legacy_video_identity_quarantine'::regclass
        and (
          quarantine_acl.grantee = 0
          or quarantine_acl.grantee in (
            select pg_roles.oid
            from pg_roles
            where pg_roles.rolname in (
              'anon',
              'authenticated',
              'service_role'
            )
          )
        )
    )
  then
    raise exception 'REGRESSION: final private quarantine boundary drifted';
  end if;

  foreach exposed_role in array array[
    'anon',
    'authenticated',
    'service_role'
  ]
  loop
    foreach table_privilege in array array[
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ]
    loop
      if has_table_privilege(
        exposed_role,
        'project_private.legacy_video_identity_quarantine',
        table_privilege
      ) then
        raise exception
          'REGRESSION: % inherited % on the final quarantine table',
          exposed_role,
          table_privilege;
      end if;
    end loop;
  end loop;

  if not exists (
      select 1
      from pg_attribute
      where attrelid = 'public.videos'::regclass
        and attname = 'youtube_video_id'
        and attnotnull
        and not attisdropped
    )
    or not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.videos'::regclass
        and conname = 'videos_youtube_video_id_key'
        and contype = 'u'
    )
    or not exists (
      select 1
      from pg_trigger
      where tgrelid = 'public.videos'::regclass
        and tgname = 'videos_sync_canonical_identity'
        and not tgisinternal
    )
  then
    raise exception 'REGRESSION: final canonical Video identity catalog drifted';
  end if;
end;
$$;
