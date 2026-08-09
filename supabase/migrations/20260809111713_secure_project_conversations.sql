-- No Data API role can read or forge conversation artifacts directly. The
-- authenticated owner RPCs and service-only terminal RPC are the sole seams.

alter table public.project_conversations enable row level security;
alter table public.project_conversation_messages enable row level security;

revoke all on table public.project_conversations
  from public, anon, authenticated, service_role;
revoke all on table public.project_conversation_messages
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
