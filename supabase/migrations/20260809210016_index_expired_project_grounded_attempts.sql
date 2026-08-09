-- Bound Project-wide stale-attempt reaping to the small set of reserved user
-- turns whose lease can expire. The conversation id remains available for the
-- owning Project join without indexing completed/cancelled history.

create index project_conversation_messages_reserved_lease_idx
  on public.project_conversation_messages (
    conversation_id,
    lease_expires_at,
    created_at,
    id
  )
  where role = 'user' and completion_state = 'reserved';
