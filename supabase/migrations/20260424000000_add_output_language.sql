-- Support per-language summary caching. Before this migration, one row in
-- `summaries` existed per video (UNIQUE video_id), and every summary was in
-- the video's own language. This migration adds `output_language` so a
-- single video can have:
--   - one row with output_language = NULL  (the original, video-native summary)
--   - one row per explicit target language (e.g. "es" for a Spanish retake)
--
-- NULLS NOT DISTINCT makes the composite UNIQUE treat two NULL values as
-- equal — preserving the "one native row per video" invariant the old
-- single-column UNIQUE enforced. Requires Postgres 15+ (Supabase is on 15+).
--
-- Existing rows keep output_language = NULL (semantic: video-native), so no
-- data backfill is needed. See
-- docs/superpowers/specs/2026-04-24-summary-language-design.md.

ALTER TABLE summaries ADD COLUMN IF NOT EXISTS output_language TEXT;

-- Replace the single-column UNIQUE installed by
-- 20260423000000_drop_thinking_columns.sql. Guarded so re-running via
-- `supabase db reset` on a freshly-migrated DB is idempotent.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'summaries_video_id_key'
    ) THEN
        ALTER TABLE summaries DROP CONSTRAINT summaries_video_id_key;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'summaries_video_id_output_language_key'
    ) THEN
        ALTER TABLE summaries ADD CONSTRAINT summaries_video_id_output_language_key
            UNIQUE NULLS NOT DISTINCT (video_id, output_language);
    END IF;
END $$;
