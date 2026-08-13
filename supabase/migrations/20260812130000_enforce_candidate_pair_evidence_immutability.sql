-- Recommendation Candidate pair evidence binds an exact source/candidate,
-- admission, Semantic Profile, evaluation, and policy tuple. A later
-- preparation may reuse that tuple, but must never rewrite or remove it.

create or replace function
  catalog_private.reject_recommendation_candidate_pair_evidence_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Recommendation Candidate pair evidence is immutable';
end;
$$;

create trigger recommendation_candidate_pair_evidence_immutable_trg
before update or delete
on catalog_private.recommendation_candidate_pair_evidence
for each row execute function
  catalog_private.reject_recommendation_candidate_pair_evidence_mutation();
