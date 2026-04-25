-- Reconcile a missed UNIQUE constraint on videos.url_hash.
--
-- 20260417000000_cache_schema.sql declared the column two ways:
--   - CREATE TABLE ... url_hash TEXT NOT NULL UNIQUE  (skipped on prod
--     because the legacy `videos` table already existed; CREATE TABLE
--     IF NOT EXISTS short-circuited the entire block)
--   - ALTER TABLE ADD COLUMN IF NOT EXISTS url_hash TEXT  (ran on prod
--     but adds the column without the UNIQUE constraint and without
--     NOT NULL)
--
-- Result on prod: url_hash exists but isn't unique. summarize-cache.ts
-- calls .upsert(..., { onConflict: "url_hash" }) which requires that
-- constraint, so every videos upsert has been failing with
-- 42P10 "there is no unique or exclusion constraint matching the
-- ON CONFLICT specification". writeCachedSummary and
-- writeCachedTranscript both throw at the same `video upsert failed`
-- line, the videos table stays empty, and every request re-bills the
-- LLM gateway through a full pipeline run.
--
-- Same incident class as PR #21's column-rename drift — another
-- reconciliation gap in the legacy-schema branch of the original
-- cache-schema migration. Verified 2026-04-24 via Vercel runtime logs:
-- "video upsert failed" matches every cache-write attempt on prod.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'videos_url_hash_key'
          AND conrelid = 'public.videos'::regclass
    ) THEN
        -- Defensive dedup: in practice the videos table is empty on
        -- prod (writes have been failing for weeks), so this is a
        -- no-op. Keeps the constraint add safe if the table ever
        -- accumulated rows during a brief window where the constraint
        -- was missing. NULL url_hash rows are tolerated by UNIQUE so
        -- we don't delete those.
        DELETE FROM videos
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY url_hash ORDER BY created_at, id
                       ) AS rn
                FROM videos
                WHERE url_hash IS NOT NULL
            ) ranked
            WHERE rn > 1
        );

        ALTER TABLE videos ADD CONSTRAINT videos_url_hash_key UNIQUE (url_hash);
    END IF;
END $$;

-- Force PostgREST to refresh its schema cache so the next upsert call
-- sees the new constraint without waiting for the natural poll. Same
-- pattern as 20260424000001_align_legacy_columns.sql.
NOTIFY pgrst, 'reload schema';
