-- Catalog Admissions and normalized provider evidence are historical facts.
-- Refresh writes successor rows, so accepted facts must not be rewritten in
-- place. DELETE remains governed separately by retention and foreign keys.
create or replace function
  catalog_private.reject_catalog_admission_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Catalog Admissions are immutable';
end;
$$;

create trigger catalog_admissions_immutable_trg
before update
on catalog_private.catalog_admissions
for each row execute function
  catalog_private.reject_catalog_admission_update();

create or replace function
  catalog_private.reject_youtube_provider_evidence_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'YouTube provider evidence is immutable';
end;
$$;

create trigger youtube_provider_evidence_immutable_trg
before update
on catalog_private.youtube_provider_evidence
for each row execute function
  catalog_private.reject_youtube_provider_evidence_update();
