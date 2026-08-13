-- Recommendation Candidate evidence must never pair a Video with itself,
-- including when the two foreign keys reference different Profile versions.

create or replace function
  catalog_private.enforce_candidate_pair_admission_coherence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_video_id uuid;
  candidate_video_id uuid;
begin
  select source_profile.video_id, candidate_profile.video_id
  into source_video_id, candidate_video_id
  from catalog_private.semantic_profile_versions as source_profile
  join catalog_private.catalog_admissions as source_admission
    on source_admission.id = new.source_catalog_admission_id
   and source_admission.video_id = source_profile.video_id
  join catalog_private.semantic_profile_versions as candidate_profile
    on candidate_profile.id = new.candidate_profile_id
  join catalog_private.catalog_admissions as candidate_admission
    on candidate_admission.id = new.candidate_catalog_admission_id
   and candidate_admission.video_id = candidate_profile.video_id
  where source_profile.id = new.source_profile_id;

  if not found then
    raise check_violation using
      message = 'Candidate-pair evidence Admissions must match Profile Videos';
  end if;

  if source_video_id = candidate_video_id then
    raise check_violation using
      message = 'Candidate-pair evidence must reference distinct Videos';
  end if;

  return new;
end;
$$;
