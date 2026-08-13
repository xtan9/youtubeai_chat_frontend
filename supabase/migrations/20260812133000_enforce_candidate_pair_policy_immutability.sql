-- Candidate-pair evidence binds a policy version, so that version's
-- compatibility and threshold semantics must not be rewritten in place.
-- Preserve the modeled one-way active-to-retired lifecycle, but require a
-- new policy version for every semantic change.

create or replace function
  catalog_private.enforce_recommendation_candidate_pair_policy_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Recommendation Candidate pair policies cannot be deleted';
  end if;

  if old.status = 'active'
    and old.retired_at is null
    and new.status = 'retired'
    and new.retired_at is not null
    and row(
      new.policy_version,
      new.profile_schema_version,
      new.prompt_version,
      new.candidate_limit,
      new.minimum_relationship_score,
      new.minimum_coverage,
      new.created_at
    ) is not distinct from row(
      old.policy_version,
      old.profile_schema_version,
      old.prompt_version,
      old.candidate_limit,
      old.minimum_relationship_score,
      old.minimum_coverage,
      old.created_at
    )
  then
    return new;
  end if;

  raise exception 'Recommendation Candidate pair policy semantics are immutable';
end;
$$;

create trigger recommendation_candidate_pair_policy_lifecycle_trg
before update or delete
on catalog_private.recommendation_candidate_pair_policies
for each row execute function
  catalog_private.enforce_recommendation_candidate_pair_policy_lifecycle();
