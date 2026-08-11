-- Minimal stubs so Supabase-flavored migrations run against a plain
-- Postgres container in CI. Keep this shape boring — it is NOT a source
-- of truth; it only exists so `CREATE POLICY ... TO service_role` and
-- `REFERENCES auth.users(id)` parse without a full Supabase stack.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
    -- SQL fixtures represent internal test Researchers unless a security
    -- contract supplies an explicit unavailable/invited claim.
    raw_app_meta_data JSONB NOT NULL DEFAULT
      '{"project_beta_access":"internal"}'::JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- auth.uid() is referenced by RLS policies.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID
$$;

-- auth.jwt() exposes the claims that PostgREST has already verified. Tests
-- set request.jwt.claims explicitly when exercising trusted app_metadata.
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB,
        jsonb_build_object(
          'sub', nullif(current_setting('request.jwt.claim.sub', TRUE), ''),
          'app_metadata', jsonb_build_object(
            'project_beta_access', 'internal'
          )
        )
    )
$$;

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

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;
