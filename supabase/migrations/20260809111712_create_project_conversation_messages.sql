-- User rows reserve an opaque completion attempt. Assistant rows are written
-- only at terminal completion and carry the complete durable evidence artifact.

create table public.project_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.project_conversations(id) on delete cascade,
  in_reply_to_message_id uuid
    references public.project_conversation_messages(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (
    char_length(content) between 1 and 20000
  ),
  completion_attempt_token uuid,
  completion_state text check (
    completion_state in ('reserved', 'completed', 'cancelled')
  ),
  answer_classification text check (
    answer_classification in ('supported', 'abstained', 'unsupported')
  ),
  source_set_revision bigint check (source_set_revision >= 0),
  source_manifest jsonb,
  source_coverage jsonb,
  evidence_snapshot jsonb,
  citation_diagnostics jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (
      role = 'user'
      and in_reply_to_message_id is null
      and char_length(content) <= 200
      and completion_attempt_token is not null
      and completion_state is not null
      and answer_classification is null
      and source_set_revision is null
      and source_manifest is null
      and source_coverage is null
      and evidence_snapshot is null
      and citation_diagnostics is null
      and completed_at is null
    )
    or
    (
      role = 'assistant'
      and in_reply_to_message_id is not null
      and completion_attempt_token is null
      and completion_state is null
      and answer_classification is not null
      and source_set_revision is not null
      and source_manifest is not null
      and source_coverage is not null
      and evidence_snapshot is not null
      and citation_diagnostics is not null
      and completed_at is not null
      and jsonb_typeof(source_manifest) = 'object'
      and jsonb_typeof(source_coverage) = 'object'
      and jsonb_typeof(evidence_snapshot) = 'object'
      and jsonb_typeof(citation_diagnostics) = 'array'
      and octet_length(source_manifest::text) <= 65536
      and octet_length(source_coverage::text) <= 32768
      and octet_length(evidence_snapshot::text) <= 131072
      and octet_length(citation_diagnostics::text) <= 16384
    )
  )
);

create unique index project_conversation_messages_attempt_token_key
  on public.project_conversation_messages (completion_attempt_token)
  where completion_attempt_token is not null;

create unique index project_conversation_messages_reply_key
  on public.project_conversation_messages (
    conversation_id,
    in_reply_to_message_id
  )
  where role = 'assistant';

create index project_conversation_messages_order_idx
  on public.project_conversation_messages (
    conversation_id,
    created_at,
    id
  );

comment on table public.project_conversation_messages is
  'Durable Project questions and terminal Grounded Answers with evidence artifacts.';
