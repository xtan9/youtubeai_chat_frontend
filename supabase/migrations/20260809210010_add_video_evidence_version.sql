-- Fence canonical evidence independently from its current Project memberships.

alter table public.videos
  add column evidence_version bigint not null default 0;

alter table public.videos
  add constraint videos_evidence_version_nonnegative
  check (evidence_version >= 0);
