-- Replace the flat `transcript` text column on video_transcripts with a
-- jsonb `segments` column carrying per-line playback timing.
--
-- The frontend uses these timings to render clickable timestamps that
-- seek the embedded YouTube player. Storing only the joined text would
-- discard the timing data the captions API and Whisper both produce.
--
-- Backfill: legacy rows (cached before this migration) lack timestamps,
-- so they're materialized as a single "whole transcript at t=0"
-- segment. They render as one un-clickable paragraph timed 00:00 — an
-- honest representation of "we know what was said, not when." Forcing
-- re-transcription would burn compute on every legacy URL hit; the cache
-- is meant to skip that exact pipeline.
--
-- Idempotency: `IF NOT EXISTS` / `IF EXISTS` on every DDL so the
-- migration-upgrade-test job can re-apply this file without failing on
-- "column already exists." That CI re-application is the regression
-- guard against migrations that only work the first time they run.
--
-- See docs/superpowers/specs/2026-04-24-clickable-transcript-timestamps-design.md.

-- 1. Add the new column. Nullable for the moment so the backfill can
--    populate it before the NOT NULL constraint is enforced.
ALTER TABLE video_transcripts ADD COLUMN IF NOT EXISTS segments jsonb;

-- 2. Backfill legacy rows with a single segment from the joined text.
--    `start = 0, duration = 0` flags "no timing data" so a future
--    cleanup pass could detect and re-transcribe these if desired.
--    The WHERE clause makes this safe to re-apply: rows already
--    backfilled stay untouched. The `information_schema.columns` guard
--    handles the second idempotency-check pass: by then the `transcript`
--    column has already been dropped, so referencing it from inside a
--    static UPDATE would fail to parse — EXECUTE on a string defers the
--    parse to runtime so the guard actually keeps the path dead.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'video_transcripts' AND column_name = 'transcript'
    ) THEN
        EXECUTE 'UPDATE video_transcripts
                 SET segments = jsonb_build_array(
                     jsonb_build_object(
                         ''text'', transcript,
                         ''start'', 0,
                         ''duration'', 0
                     )
                 )
                 WHERE segments IS NULL';
    END IF;
END $$;

-- 3. Lock the new column down. ALTER COLUMN ... SET NOT NULL is a no-op
--    when the constraint is already in place, so this is idempotent.
ALTER TABLE video_transcripts ALTER COLUMN segments SET NOT NULL;

-- 4. Drop the old column. The frontend reads `segments` exclusively now,
--    and the LLM-snapshot string lives on the separate summaries.transcript
--    column (untouched by this migration). `IF EXISTS` makes re-apply
--    safe.
ALTER TABLE video_transcripts DROP COLUMN IF EXISTS transcript;

-- Same pattern as 20260424000001_align_legacy_columns.sql: force
-- PostgREST to reload its cached schema so the first request after
-- this migration sees `segments` without waiting for the ~10-min poll.
NOTIFY pgrst, 'reload schema';
