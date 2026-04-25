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
-- "video upsert failed" matches every cache-write attempt on prod
-- since the TypeScript-stack rollout.
--
-- Constraint name `videos_url_hash_key` matches Postgres's column-UNIQUE
-- convention (`<table>_<column>_key`) so a fresh DB built via
-- CREATE TABLE ... UNIQUE has an auto-named constraint that this
-- migration's IF NOT EXISTS guard recognizes — fresh and legacy paths
-- converge on the same name.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'videos_url_hash_key'
          AND conrelid = 'public.videos'::regclass
    ) THEN
        -- Block concurrent writers for the dedup + ADD CONSTRAINT pair.
        -- ADD CONSTRAINT alone takes ACCESS EXCLUSIVE only at its own
        -- call, so without this lock a writer could land a duplicate
        -- between the DELETE below and the ADD CONSTRAINT and trip
        -- "could not create unique index". Cheap insurance even though
        -- prod's videos table is verified empty (cache writes have been
        -- failing since the cache_schema deploy).
        LOCK TABLE public.videos IN ACCESS EXCLUSIVE MODE;

        -- Drop any duplicate url_hash rows so the unique add doesn't
        -- fail. Keeps the earliest row per hash. NULL url_hash rows
        -- aren't touched (UNIQUE allows multiple NULLs in Postgres).
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

-- Force PostgREST to refresh its in-memory schema cache (which carries
-- the table/column/constraint metadata it uses to compile ON CONFLICT
-- targets) so the next upsert call sees the new constraint without
-- waiting for the natural ~10-minute poll. Same pattern as
-- 20260424000001_align_legacy_columns.sql.
NOTIFY pgrst, 'reload schema';
