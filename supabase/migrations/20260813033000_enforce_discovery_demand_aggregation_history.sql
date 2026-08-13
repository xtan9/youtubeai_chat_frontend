-- Discovery Demand is a learner-unlinked append-only aggregate. Preserve its
-- normalized bucket identity and first observation while allowing only the
-- atomic one-observation increment used by candidate-pair preparation.

create or replace function
  catalog_private.enforce_discovery_demand_aggregation_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise check_violation using
      message = 'Discovery Demand aggregates cannot be deleted';
  end if;

  if tg_op = 'INSERT' then
    if new.observation_count <> 1 then
      raise check_violation using
        message = 'Discovery Demand must begin with one observation';
    end if;
    return new;
  end if;

  if new.topic_key is distinct from old.topic_key
    or new.language_bucket is distinct from old.language_bucket
    or new.candidate_pair_policy_version is distinct from
      old.candidate_pair_policy_version
    or new.first_observed_at is distinct from old.first_observed_at
  then
    raise check_violation using
      message = 'Discovery Demand aggregation identity and history are immutable';
  end if;

  if new.observation_count is distinct from old.observation_count + 1 then
    raise check_violation using
      message = 'Discovery Demand may only record one new observation';
  end if;

  if new.last_observed_at < old.last_observed_at then
    raise check_violation using
      message = 'Discovery Demand observation history cannot move backwards';
  end if;

  return new;
end;
$$;

create trigger discovery_demand_aggregation_history_trg
before insert or update or delete
on catalog_private.discovery_demand
for each row execute function
  catalog_private.enforce_discovery_demand_aggregation_history();
