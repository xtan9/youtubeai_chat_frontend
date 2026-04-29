-- admin_audit_log — append-only trail of admin content-access actions.
--
-- Design decisions (see .claude/skills/spike-findings-youtubeai-chat for
-- the investigation trail):
--   - admin_id is NOT a FK to auth.users(id) so the row survives if the
--     admin's auth row is later deleted. admin_email is captured at write
--     time for stable human-readable history.
--   - resource_id is TEXT (not UUID) so the schema doesn't constrain what
--     can be audited (summary uuid, video url hash, rate-limit key, etc.).
--   - metadata is JSONB so callers can attach structured context (request
--     id, owner user_id) without per-case schema migrations. Never put
--     transcript or summary text in metadata — keep it pointers + IDs.
--   - No INSERT/UPDATE/DELETE policies. Writes go through the service-role
--     client (lib/supabase/admin-client.ts), which bypasses RLS. Non-admin
--     code paths cannot reach this table by construction.
--   - RLS enabled with no policies = default-deny for anon/authenticated.
--   - Append-only by convention (no UPDATE/DELETE callers). The schema
--     does not enforce immutability — that lives in the lib/admin/audit.ts
--     wrapper.

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL,
    admin_email TEXT NOT NULL CHECK (length(admin_email) > 0),
    action TEXT NOT NULL CHECK (length(action) > 0),
    resource_type TEXT NOT NULL CHECK (length(resource_type) > 0),
    resource_id TEXT NOT NULL CHECK (length(resource_id) > 0),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_created_at ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_admin_id   ON admin_audit_log (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource   ON admin_audit_log (resource_type, resource_id);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
