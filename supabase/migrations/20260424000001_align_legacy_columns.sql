-- Reconcile production column drift discovered 2026-04-24.
--
-- The cache code in lib/services/summarize-cache.ts writes to
-- `videos.youtube_url` and `summaries.summary`, but production has the
-- legacy column names `videos.youtube_id` and `summaries.summary_text`.
-- The 20260417000000_cache_schema.sql reconciliation block did not rename
-- these (it only ADD COLUMN IF NOT EXISTS'd a different set of columns
-- that the original CREATE TABLE block introduced).
--
-- Symptom: every cache write since this divergence failed with PGRST204
-- ("Could not find the 'youtube_url' column of 'videos' in the schema
-- cache"). `videos` and `summaries` ended up empty in prod, so every
-- request re-transcribed and the summary-language translation shortcut
-- (which depends on a cached native row) never fired.
--
-- Strategy: RENAME, not ADD. ADD COLUMN IF NOT EXISTS would create a
-- parallel NULL column alongside the legacy one, leaving existing data
-- orphaned. RENAME preserves the data and is idempotent under our
-- guard (the EXISTS / NOT EXISTS check ensures the inner ALTER only
-- fires once even when CI re-applies migrations).

DO $$
BEGIN
    -- videos.youtube_id → youtube_url
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'videos'
          AND column_name = 'youtube_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'videos'
          AND column_name = 'youtube_url'
    ) THEN
        ALTER TABLE videos RENAME COLUMN youtube_id TO youtube_url;
    END IF;

    -- summaries.summary_text → summary
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'summaries'
          AND column_name = 'summary_text'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'summaries'
          AND column_name = 'summary'
    ) THEN
        ALTER TABLE summaries RENAME COLUMN summary_text TO summary;
    END IF;
END $$;

-- Belt-and-suspenders: in an env where neither legacy nor canonical
-- column exists (a third drift variant we haven't seen but could), this
-- prevents the next deploy's first cache write from erroring with PGRST204.
-- The cache write already coerces empty title/channel to NULL, so
-- nullable here is fine — UNIQUE/NOT NULL invariants are enforced
-- elsewhere (videos.url_hash UNIQUE, summaries.summary NOT NULL on fresh
-- installs from the CREATE TABLE block).
ALTER TABLE videos ADD COLUMN IF NOT EXISTS youtube_url TEXT;
ALTER TABLE summaries ADD COLUMN IF NOT EXISTS summary TEXT;

-- Force PostgREST to refresh its schema cache. Without this, the first
-- request after this migration runs on prod will still hit PGRST204
-- until PostgREST naturally polls (~10min) or restarts. NOTIFY is
-- delivered on transaction commit; the listening pgrst worker reloads
-- in milliseconds.
NOTIFY pgrst, 'reload schema';
