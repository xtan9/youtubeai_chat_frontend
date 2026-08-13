-- Reservations are immutable cost-accounting facts and Observations are
-- immutable provider-evidence facts. Corrections must use a new fingerprint;
-- rewriting or deleting an accepted ledger row would invalidate replay and
-- budget-accounting guarantees.

create or replace function
  catalog_private.reject_discovery_budget_reservation_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Discovery Budget reservations are immutable';
end;
$$;

create trigger discovery_budget_reservations_immutable_trg
before update or delete
on catalog_private.discovery_budget_reservations
for each row execute function
  catalog_private.reject_discovery_budget_reservation_mutation();

create or replace function
  catalog_private.reject_discovery_observation_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Discovery Observations are immutable';
end;
$$;

create trigger discovery_observations_immutable_trg
before update or delete
on catalog_private.discovery_observations
for each row execute function
  catalog_private.reject_discovery_observation_mutation();
