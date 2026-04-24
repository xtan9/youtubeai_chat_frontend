-- Remove the reasoning/thinking plumbing from the summaries table. The
-- frontend has been ripped out in the same PR; this migration backs it
-- out of the schema.
--
-- Feature history: enable_thinking + thinking were added by
-- 20260417000000_cache_schema.sql but the gateway has never emitted a
-- reasoning token in prod (verified 2026-04-23 via signed-in curl to
-- /api/summarize/stream with enable_thinking=true — zero thinking
-- events). Every existing row has thinking IS NULL; the `thinking`
-- column is functionally unused.
--
-- The InputForm toggle defaulted to true, so prod cache has rows with
-- enable_thinking=TRUE and rows with FALSE. Since thinking is NULL on
-- every row, the two rows a given video may have are byte-identical
-- apart from a flag we're dropping — deduplication is lossless.

-- 1. Drop the CHECK constraint that tied thinking to enable_thinking.
ALTER TABLE summaries DROP CONSTRAINT IF EXISTS summaries_thinking_consistent;

-- 2. Drop the composite UNIQUE so we can collapse duplicates.
ALTER TABLE summaries DROP CONSTRAINT IF EXISTS summaries_video_id_enable_thinking_key;

-- 3. Diagnostic: count rows with non-null thinking content. Should be 0
--    in prod. Emits a WARNING (not NOTICE) so CI log captures surface it
--    even on low-verbosity defaults; still does not block the migration.
--    If nonzero appears in staging, investigate before rolling to prod —
--    it would mean the feature fired at least once historically, and the
--    dedup below picks by created_at which may not be the best row.
DO $$
DECLARE
    nonnull_thinking_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO nonnull_thinking_count
    FROM summaries
    WHERE thinking IS NOT NULL;
    IF nonnull_thinking_count > 0 THEN
        RAISE WARNING 'DIAGNOSTIC: % summaries rows have non-null thinking (dropping on column-drop below)', nonnull_thinking_count;
    END IF;
END $$;

-- 4. Deduplicate on video_id. Keep the most-recently-created row per
--    video (tie-break by id DESC for determinism). Functionally
--    equivalent rows (same transcript, same summary, same timings)
--    collapse to one.
DELETE FROM summaries
WHERE id IN (
    SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY video_id
                   ORDER BY created_at DESC, id DESC
               ) AS rn
        FROM summaries
    ) ranked
    WHERE rn > 1
);

-- 5. Drop the now-unused columns. Running after the dedup so the
--    resulting (video_id) UNIQUE below cannot collide.
ALTER TABLE summaries DROP COLUMN IF EXISTS thinking;
ALTER TABLE summaries DROP COLUMN IF EXISTS enable_thinking;

-- 6. Add the single-column UNIQUE that the new writeCachedSummary
--    upsert targets (onConflict: "video_id"). Guarded so re-running
--    via supabase db reset on a freshly-migrated DB doesn't error.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'summaries_video_id_key'
    ) THEN
        ALTER TABLE summaries ADD CONSTRAINT summaries_video_id_key UNIQUE (video_id);
    END IF;
END $$;
