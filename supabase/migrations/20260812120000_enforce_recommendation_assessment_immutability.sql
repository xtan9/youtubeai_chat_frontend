-- Recommendation Assessments are exact, reusable versioned judgments. Once
-- validated and stored, a correction requires a new version tuple rather than
-- mutating or deleting the remembered Assessment.

create or replace function
  catalog_private.reject_recommendation_assessment_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Recommendation Assessments are immutable';
end;
$$;

create trigger recommendation_assessments_immutable_trg
before update or delete on catalog_private.recommendation_assessments
for each row execute function
  catalog_private.reject_recommendation_assessment_mutation();
