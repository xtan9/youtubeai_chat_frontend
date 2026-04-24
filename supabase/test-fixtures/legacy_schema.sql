-- Snapshot of what prod's `videos` / `summaries` tables actually looked
-- like BEFORE the TypeScript-migration rollout. The earlier version of
-- this fixture used the canonical column names (`youtube_url`, `summary`)
-- and missed the actual drift: production was bootstrapped with
-- `youtube_id` and `summary_text` (verified 2026-04-24 by querying
-- PostgREST directly — `column videos.youtube_url does not exist; hint:
-- did you mean videos.youtube_id`).
--
-- That drift went uncaught for days because the CREATE TABLE IF NOT
-- EXISTS in 20260417000000_cache_schema.sql silently skipped on prod,
-- and the reconciliation block forgot to rename. Cache writes failed
-- with PGRST204 on every request; the videos and summaries tables stayed
-- empty; every summary re-transcribed; and the summary-language
-- translation shortcut never fired because no cached native row existed.
--
-- The 20260424000001_align_legacy_columns.sql migration renames both
-- columns to the canonical names. This fixture pins the regression test:
-- the migration-upgrade-test job in CI loads this fixture, applies every
-- migration in order, and re-applies them for idempotency. If a future
-- migration assumes the canonical column names without going through the
-- rename migration, it will fail loudly here instead of silently in
-- production.
--
-- DO NOT change the column names in this fixture to match a new
-- migration. The fixture is a frozen snapshot of production's actual
-- pre-migration state. If you need to add columns the fixture doesn't
-- have, guard with `ADD COLUMN IF NOT EXISTS` in the migration.

CREATE TABLE IF NOT EXISTS videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    youtube_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    summary_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);
