-- Minimal stubs so Supabase-flavored migrations run against a plain
-- Postgres container in CI. Keep this shape boring — it is NOT a source
-- of truth; it only exists so `CREATE POLICY ... TO service_role` and
-- `REFERENCES auth.users(id)` parse without a full Supabase stack.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- auth.uid() is referenced by RLS policies.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$ SELECT NULL::UUID $$;

-- Roles that Supabase provisions; policies target them by name.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
    END IF;
END $$;
