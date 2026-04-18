-- Snapshot of what prod's `videos` / `summaries` tables looked like BEFORE
-- the TypeScript-migration rollout, reconstructed from the failure observed
-- on `db-migrate` run 24593654019 (column `enable_thinking` did not exist
-- on the pre-existing `summaries` table).
--
-- This fixture exists so CI catches upgrade-path regressions: a migration
-- that only works on a fresh DB but breaks on a pre-existing one fails
-- invisibly to our Vitest tests. Applying this fixture first and then
-- running `supabase/migrations/**` against it reproduces the production
-- condition that bit us.
--
-- If you add a NEW migration and it assumes columns this fixture doesn't
-- have, either (a) guard with `ADD COLUMN IF NOT EXISTS` in the migration,
-- or (b) accept that your migration is forward-only from a known good
-- baseline — do NOT modify this fixture to match the migration, that
-- defeats the whole point.

CREATE TABLE IF NOT EXISTS videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    youtube_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
