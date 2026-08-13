-- Candidate-pair evidence and aggregated Discovery Demand may only grow while
-- their versioned policy is active. Lock the policy row while each append is
-- accepted so retirement and writes have a single database ordering.

create or replace function
  catalog_private.enforce_active_candidate_pair_policy_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from catalog_private.recommendation_candidate_pair_policies as policy
  where policy.policy_version = new.candidate_pair_policy_version
    and policy.status = 'active'
  for share;

  if not found then
    raise check_violation using
      message = 'Candidate-pair policy must be active for new evidence or demand';
  end if;

  return new;
end;
$$;

create trigger recommendation_candidate_pair_evidence_active_policy_trg
before insert
on catalog_private.recommendation_candidate_pair_evidence
for each row execute function
  catalog_private.enforce_active_candidate_pair_policy_write();

create trigger discovery_demand_active_policy_trg
before insert or update
on catalog_private.discovery_demand
for each row execute function
  catalog_private.enforce_active_candidate_pair_policy_write();
