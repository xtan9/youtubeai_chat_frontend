-- Seed one deployed #318 answer after the published terminal migration and
-- before forward coverage-vocabulary migrations. The upgrade replay proves
-- durable history is normalized rather than assumed empty.

insert into auth.users (id, is_anonymous)
values ('94000000-0000-4000-8000-000000000004', false)
on conflict (id) do nothing;

insert into public.projects (id, workspace_id, name)
select
  'a4000000-0000-4000-8000-000000000004',
  workspaces.id,
  'Pre-upgrade Grounded Answer'
from public.workspaces
where owner_id = '94000000-0000-4000-8000-000000000004';

insert into public.project_source_sets (project_id, revision)
values ('a4000000-0000-4000-8000-000000000004', 0);

insert into public.project_conversations (id, project_id, kind)
values (
  'b4000000-0000-4000-8000-000000000004',
  'a4000000-0000-4000-8000-000000000004',
  'default'
);

insert into public.project_conversation_messages (
  id, conversation_id, role, content, completion_attempt_token,
  completion_state, created_at
) values (
  'c4000000-0000-4000-8000-000000000004',
  'b4000000-0000-4000-8000-000000000004',
  'user',
  'What did the deployed empty Project support?',
  'd4000000-0000-4000-8000-000000000004',
  'completed',
  '2026-08-09T13:00:00Z'
);

insert into public.project_conversation_messages (
  id, conversation_id, in_reply_to_message_id, role, content,
  answer_classification, source_set_revision, source_manifest,
  source_coverage, evidence_snapshot, citation_diagnostics,
  created_at, completed_at
) values (
  'e4000000-0000-4000-8000-000000000004',
  'b4000000-0000-4000-8000-000000000004',
  'c4000000-0000-4000-8000-000000000004',
  'assistant',
  'Legacy unsupported answer; malformed [S9 at 00:10] stays plain.',
  'unsupported',
  0,
  '{
    "projectId":"a4000000-0000-4000-8000-000000000004",
    "sourceSetRevision":0,
    "sources":[]
  }'::jsonb,
  '{
    "totalVideos":0,
    "readyVideos":0,
    "evidenceVideos":0,
    "unavailableVideos":[],
    "passagesExamined":0,
    "evidencePassages":0
  }'::jsonb,
  '{
    "projectId":"a4000000-0000-4000-8000-000000000004",
    "sourceSetRevision":0,
    "passages":[]
  }'::jsonb,
  '[{"kind":"malformed","raw":"[S9 at 00:10]"}]'::jsonb,
  '2026-08-09T13:00:01Z',
  '2026-08-09T13:00:01Z'
);
