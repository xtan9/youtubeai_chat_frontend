-- chat_messages — per-(user, video) chat thread for the AI chat feature.
--
-- Design:
--   - video_id is a UUID FK to videos(id). The chat surface is gated on the
--     summary existing for that user+video, so the FK target is always
--     resolvable. ON DELETE CASCADE so a wiped video drops its chats.
--   - user_id is a UUID FK to auth.users(id) ON DELETE CASCADE so deleting
--     a user (incl. anonymous-guest TTL cleanup) drops their threads.
--   - role is a text check; the assistant variant is appended only after
--     successful stream completion (or, on caller-abort, the user message
--     is preserved alone — the dedupe between the start() abort branch
--     and cancel() lives in app/api/chat/stream/route.ts).
--   - RLS: select / insert / delete restricted to auth.uid() = user_id
--     for the authenticated client; service_role bypasses RLS and is the
--     only writer used by the route. Service-role policies are explicit
--     so a future RLS-tightening change fails loud rather than silently
--     widening access (same pattern as 20260417000000_cache_schema.sql).
--
-- Re-applicable: every CREATE / POLICY is guarded so the
-- migration-upgrade-test (which re-applies every migration twice) passes.
-- Same DO-NOTHING-on-second-apply pattern as 20260417000000_cache_schema.sql.

CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL CHECK (length(content) > 0),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_video_created
    ON chat_messages (user_id, video_id, created_at);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_messages_select_own" ON chat_messages;
CREATE POLICY "chat_messages_select_own" ON chat_messages
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "chat_messages_insert_own" ON chat_messages;
CREATE POLICY "chat_messages_insert_own" ON chat_messages
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "chat_messages_delete_own" ON chat_messages;
CREATE POLICY "chat_messages_delete_own" ON chat_messages
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- Service-role policies are explicit (service_role bypasses RLS, but
-- listing them here keeps the access surface auditable in one place).
DROP POLICY IF EXISTS "chat_messages_insert_service" ON chat_messages;
CREATE POLICY "chat_messages_insert_service" ON chat_messages
    FOR INSERT TO service_role
    WITH CHECK (true);

DROP POLICY IF EXISTS "chat_messages_select_service" ON chat_messages;
CREATE POLICY "chat_messages_select_service" ON chat_messages
    FOR SELECT TO service_role
    USING (true);

DROP POLICY IF EXISTS "chat_messages_delete_service" ON chat_messages;
CREATE POLICY "chat_messages_delete_service" ON chat_messages
    FOR DELETE TO service_role
    USING (true);

NOTIFY pgrst, 'reload schema';
