-- Continue Learning opaque-token feedback boundary (Issue #354).
--
-- This fixture intentionally uses no catalog rows. The service-issued token
-- binding is seeded as the database owner so the RPC resolver can be tested
-- without manufacturing a Recommendation Set. Production registration still
-- validates that the Set/ordinal exists before inserting a binding.

begin;

do $contract$
begin
  if to_regclass('catalog_private.continue_learning_token_bindings') is null
    or to_regclass('catalog_private.continue_learning_feedback') is null
  then
    raise exception 'Continue Learning feedback tables are missing';
  end if;

  if exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'catalog_private'
      and relation.relname in (
        'continue_learning_token_bindings',
        'continue_learning_feedback'
      )
      and relation.relrowsecurity is not true
  ) then
    raise exception 'Continue Learning feedback tables must enable RLS';
  end if;

  if has_schema_privilege('anon', 'catalog_private', 'USAGE')
    or has_schema_privilege('authenticated', 'catalog_private', 'USAGE')
    or has_table_privilege(
      'anon', 'catalog_private.continue_learning_token_bindings', 'SELECT'
    )
    or has_table_privilege(
      'authenticated', 'catalog_private.continue_learning_feedback', 'SELECT'
    )
    or has_function_privilege(
      'anon',
      'public.record_continue_learning_feedback(uuid,text,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.record_continue_learning_feedback(uuid,text,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.record_continue_learning_feedback(uuid,text,text)',
      'EXECUTE'
    )
  then
    raise exception 'Continue Learning feedback least privilege is incorrect';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'catalog_private'
      and table_name in (
        'continue_learning_token_bindings',
        'continue_learning_feedback'
      )
      and column_name in (
        'youtube_url', 'title', 'channel_name', 'thumbnail_url',
        'explanation', 'transcript', 'summary', 'content', 'reason'
      )
  ) then
    raise exception 'Continue Learning feedback contains learner/content fields';
  end if;
end;
$contract$;

insert into auth.users (id, is_anonymous)
values
  ('35400000-0000-4000-8000-000000000001', false),
  ('35400000-0000-4000-8000-000000000002', false)
on conflict (id) do nothing;

-- A real digest-only reader token; the Set UUID never appears in the token.
set local role postgres;
insert into catalog_private.continue_learning_token_bindings (
  token_hash,
  learner_id,
  recommendation_set_id,
  recommendation_ordinal
) values (
  encode(extensions.digest('cl1.' || repeat('a', 43), 'sha256'), 'hex'),
  '35400000-0000-4000-8000-000000000001',
  '35400000-0000-4000-8000-000000000101',
  1
);
reset role;

set local role service_role;
do $service_contract$
declare
  result jsonb;
begin
  result := public.register_continue_learning_token_binding(
    '35400000-0000-4000-8000-000000000001',
    'cl1.' || repeat('c', 43),
    '35400000-0000-0000-0000-000000000102'::uuid,
    1
  );
  if result->>'outcome' <> 'missing' then
    raise exception 'token binding registered an unknown Set/ordinal: %', result;
  end if;

  result := public.record_continue_learning_feedback(
    '35400000-0000-4000-8000-000000000001',
    'cl1.' || repeat('a', 43),
    'useful'
  );
  if result <> jsonb_build_object(
    'outcome', 'recorded', 'judgment', 'useful', 'ordinal', 1
  ) then
    raise exception 'first private feedback was not recorded: %', result;
  end if;

  result := public.record_continue_learning_feedback(
    '35400000-0000-4000-8000-000000000001',
    'cl1.' || repeat('a', 43),
    'useful'
  );
  if result <> jsonb_build_object(
    'outcome', 'deduplicated', 'judgment', 'useful', 'ordinal', 1
  ) then
    raise exception 'repeated private feedback was not idempotent: %', result;
  end if;

  result := public.record_continue_learning_feedback(
    '35400000-0000-4000-8000-000000000002',
    'cl1.' || repeat('a', 43),
    'useful'
  );
  if result->>'outcome' <> 'missing' then
    raise exception 'cross-learner token access was not denied: %', result;
  end if;
end;
$service_contract$;
reset role;

set local role anon;
do $anon_denial$
begin
  begin
    perform 1 from catalog_private.continue_learning_feedback limit 1;
    raise exception 'anon feedback table access unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.record_continue_learning_feedback(
      null::uuid, 'cl1.' || repeat('a', 43), 'useful'
    );
    raise exception 'anon feedback RPC unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$anon_denial$;
reset role;

set local role authenticated;
do $authenticated_denial$
begin
  begin
    perform 1 from catalog_private.continue_learning_token_bindings limit 1;
    raise exception 'authenticated token-binding access unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.record_continue_learning_feedback(
      null::uuid, 'cl1.' || repeat('a', 43), 'useful'
    );
    raise exception 'authenticated feedback RPC unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$authenticated_denial$;
reset role;

-- Account deletion removes only learner-linked rows; the UUID is not a
-- catalog row and the shared recommendation schema remains untouched.
delete from auth.users
where id in (
  '35400000-0000-4000-8000-000000000001',
  '35400000-0000-4000-8000-000000000002'
);

do $cascade$
begin
  if exists (
    select 1 from catalog_private.continue_learning_token_bindings
    where learner_id in (
      '35400000-0000-4000-8000-000000000001',
      '35400000-0000-4000-8000-000000000002'
    )
  ) or exists (
    select 1 from catalog_private.continue_learning_feedback
    where learner_id in (
      '35400000-0000-4000-8000-000000000001',
      '35400000-0000-4000-8000-000000000002'
    )
  ) then
    raise exception 'account deletion did not cascade learner feedback';
  end if;
end;
$cascade$;

rollback;
