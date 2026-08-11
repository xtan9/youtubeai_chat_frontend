-- Dormant, service-owned Continue Learning feedback ledger (Issue #354).
--
-- The reader emits digest-only HMAC item tokens. This private binding ledger
-- lets the service resolve a token without putting Set, Recommendation, or
-- learner identifiers in the browser token or feedback response. Historical
-- bindings intentionally do not hold a foreign key to a shared Set: token
-- issuance validates the current Recommendation row, while feedback history
-- must not pin learner-unlinked catalog cleanup. It adds no
-- learner UI, analytics transport, cohort policy, pending state, or rollout
-- enablement. The application route remains disabled unless the existing
-- CONTINUE_LEARNING_READER_ENABLED gate is explicitly enabled.

create extension if not exists pgcrypto;

create table catalog_private.continue_learning_token_bindings (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  learner_id uuid not null references auth.users(id) on delete cascade,
  recommendation_set_id uuid not null,
  recommendation_ordinal integer not null check (
    recommendation_ordinal between 1 and 50
  ),
  issued_at timestamptz not null default clock_timestamp(),
  unique (learner_id, recommendation_set_id, recommendation_ordinal)
);

create index continue_learning_token_bindings_learner_idx
  on catalog_private.continue_learning_token_bindings (
    learner_id, recommendation_set_id, recommendation_ordinal
  );

create table catalog_private.continue_learning_feedback (
  learner_id uuid not null references auth.users(id) on delete cascade,
  recommendation_set_id uuid not null,
  recommendation_ordinal integer not null check (
    recommendation_ordinal between 1 and 50
  ),
  judgment text not null check (judgment in ('useful', 'not_useful')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (learner_id, recommendation_set_id, recommendation_ordinal)
);

alter table catalog_private.continue_learning_token_bindings enable row level security;
alter table catalog_private.continue_learning_feedback enable row level security;

revoke all on table catalog_private.continue_learning_token_bindings
  from public, anon, authenticated, service_role;
revoke all on table catalog_private.continue_learning_feedback
  from public, anon, authenticated, service_role;

create or replace function catalog_private.register_continue_learning_token_binding(
  p_learner_id uuid,
  p_token text,
  p_recommendation_set_id uuid,
  p_recommendation_ordinal integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  token_hash_value text;
  existing_binding catalog_private.continue_learning_token_bindings%rowtype;
begin
  if p_learner_id is null
    or p_token is null
    or p_token !~ '^cl1\.[A-Za-z0-9_-]{43}$'
    or p_recommendation_set_id is null
    or p_recommendation_ordinal is null
    or p_recommendation_ordinal not between 1 and 50
  then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  if not exists (
    select 1
    from catalog_private.recommendations as recommendation
    where recommendation.recommendation_set_id = p_recommendation_set_id
      and recommendation.ordinal = p_recommendation_ordinal
  ) then
    return jsonb_build_object('outcome', 'missing');
  end if;

  token_hash_value := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select binding.*
  into existing_binding
  from catalog_private.continue_learning_token_bindings as binding
  where binding.token_hash = token_hash_value;

  if existing_binding.token_hash is not null then
    if existing_binding.learner_id <> p_learner_id
      or existing_binding.recommendation_set_id <> p_recommendation_set_id
      or existing_binding.recommendation_ordinal <> p_recommendation_ordinal
    then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    return jsonb_build_object('outcome', 'registered');
  end if;

  insert into catalog_private.continue_learning_token_bindings (
    token_hash,
    learner_id,
    recommendation_set_id,
    recommendation_ordinal
  ) values (
    token_hash_value,
    p_learner_id,
    p_recommendation_set_id,
    p_recommendation_ordinal
  )
  on conflict (learner_id, recommendation_set_id, recommendation_ordinal)
  do update set
    token_hash = excluded.token_hash,
    issued_at = clock_timestamp();

  return jsonb_build_object('outcome', 'registered');
end;
$$;

create or replace function catalog_private.record_continue_learning_feedback(
  p_learner_id uuid,
  p_token text,
  p_judgment text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  token_hash_value text;
  binding catalog_private.continue_learning_token_bindings%rowtype;
  existing_feedback catalog_private.continue_learning_feedback%rowtype;
  inserted_learner_id uuid;
begin
  if p_learner_id is null
    or p_token is null
    or p_token !~ '^cl1\.[A-Za-z0-9_-]{43}$'
    or p_judgment is null
    or p_judgment not in ('useful', 'not_useful')
  then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  token_hash_value := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select token_binding.*
  into binding
  from catalog_private.continue_learning_token_bindings as token_binding
  where token_binding.token_hash = token_hash_value
    and token_binding.learner_id = p_learner_id;

  if binding.token_hash is null then
    return jsonb_build_object('outcome', 'missing');
  end if;

  select feedback.*
  into existing_feedback
  from catalog_private.continue_learning_feedback as feedback
  where feedback.learner_id = binding.learner_id
    and feedback.recommendation_set_id = binding.recommendation_set_id
    and feedback.recommendation_ordinal = binding.recommendation_ordinal
  for update;

  if existing_feedback.learner_id is null then
    insert into catalog_private.continue_learning_feedback (
      learner_id,
      recommendation_set_id,
      recommendation_ordinal,
      judgment
    ) values (
      binding.learner_id,
      binding.recommendation_set_id,
      binding.recommendation_ordinal,
      p_judgment
    )
    on conflict (
      learner_id, recommendation_set_id, recommendation_ordinal
    ) do nothing
    returning learner_id into inserted_learner_id;

    if inserted_learner_id is not null then
      return jsonb_build_object(
        'outcome', 'recorded',
        'judgment', p_judgment,
        'ordinal', binding.recommendation_ordinal
      );
    end if;

    select feedback.*
    into existing_feedback
    from catalog_private.continue_learning_feedback as feedback
    where feedback.learner_id = binding.learner_id
      and feedback.recommendation_set_id = binding.recommendation_set_id
      and feedback.recommendation_ordinal = binding.recommendation_ordinal
    for update;
  end if;

  if existing_feedback.judgment = p_judgment then
    return jsonb_build_object(
      'outcome', 'deduplicated',
      'judgment', existing_feedback.judgment,
      'ordinal', binding.recommendation_ordinal
    );
  end if;

  update catalog_private.continue_learning_feedback
  set judgment = p_judgment,
      updated_at = clock_timestamp()
  where learner_id = binding.learner_id
    and recommendation_set_id = binding.recommendation_set_id
    and recommendation_ordinal = binding.recommendation_ordinal;

  return jsonb_build_object(
    'outcome', 'recorded',
    'judgment', p_judgment,
    'ordinal', binding.recommendation_ordinal
  );
end;
$$;

create or replace function public.register_continue_learning_token_binding(
  p_learner_id uuid,
  p_token text,
  p_recommendation_set_id uuid,
  p_recommendation_ordinal integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.register_continue_learning_token_binding(
    p_learner_id,
    p_token,
    p_recommendation_set_id,
    p_recommendation_ordinal
  );
end;
$$;

create or replace function public.record_continue_learning_feedback(
  p_learner_id uuid,
  p_token text,
  p_judgment text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise insufficient_privilege using message = 'service_role required';
  end if;
  return catalog_private.record_continue_learning_feedback(
    p_learner_id,
    p_token,
    p_judgment
  );
end;
$$;

revoke all on function catalog_private.register_continue_learning_token_binding(
  uuid, text, uuid, integer
) from public, anon, authenticated, service_role;
revoke all on function catalog_private.record_continue_learning_feedback(
  uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.register_continue_learning_token_binding(
  uuid, text, uuid, integer
) from public, anon, authenticated;
revoke all on function public.record_continue_learning_feedback(
  uuid, text, text
) from public, anon, authenticated;

grant execute on function catalog_private.register_continue_learning_token_binding(
  uuid, text, uuid, integer
) to service_role;
grant execute on function catalog_private.record_continue_learning_feedback(
  uuid, text, text
) to service_role;
grant execute on function public.register_continue_learning_token_binding(
  uuid, text, uuid, integer
) to service_role;
grant execute on function public.record_continue_learning_feedback(
  uuid, text, text
) to service_role;

notify pgrst, 'reload schema';
