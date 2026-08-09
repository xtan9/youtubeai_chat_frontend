-- One private stale-attempt transition shared by exact-attempt and page loads.
-- Callers already prove Project ownership; this helper only receives the
-- aggregate identity and never exposes or accepts an attempt token.

create function project_private.reap_expired_project_grounded_attempts_v2(
  p_project_id uuid
)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  reaped_count integer := 0;
begin
  update public.project_conversation_messages as expired
  set completion_state = 'cancelled', lease_expires_at = null
  from public.project_conversations as expired_conversation
  where expired.conversation_id = expired_conversation.id
    and expired_conversation.project_id = p_project_id
    and expired.role = 'user'
    and expired.completion_state = 'reserved'
    and coalesce(
      expired.lease_expires_at,
      expired.created_at + interval '135 seconds'
    ) <= pg_catalog.now();
  get diagnostics reaped_count = row_count;
  return reaped_count;
end;
$$;

revoke all on function
  project_private.reap_expired_project_grounded_attempts_v2(uuid)
  from public, anon, authenticated, service_role;
