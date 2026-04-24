-- Decouple transcript storage from the per-language summary row.
--
-- Before this migration, the transcript was a column on `summaries`. That
-- means it only persisted when a summary write succeeded. Any abort before
-- end-of-pipeline (mid-transcription, mid-LLM, or the column-rename drift
-- fixed in 20260424000001_align_legacy_columns.sql) discarded the
-- transcript, and the user's next language switch re-transcribed the same
-- video — wasted minutes and tokens.
--
-- video_transcripts is keyed only by video_id. The route writes to it the
-- moment transcription succeeds (captions or Whisper), independent of LLM
-- completion. Subsequent requests for the same video — in any language —
-- find the transcript and skip the entire transcription pipeline.
--
-- See docs/superpowers/specs/2026-04-24-transcript-decouple-design.md.

CREATE TABLE IF NOT EXISTS video_transcripts (
    video_id UUID PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
    transcript TEXT NOT NULL,
    transcript_source TEXT NOT NULL
        CHECK (transcript_source IN ('manual_captions', 'auto_captions', 'whisper')),
    -- Mirrors videos.language: PromptLocale (en|zh) drives the LLM call
    -- without re-running detectLocale on the cached path.
    language TEXT NOT NULL CHECK (language IN ('en', 'zh')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Force PostgREST to refresh its schema cache so the first request after
-- this migration sees the new table without waiting for the ~10-minute
-- natural poll. Same pattern as 20260424000001_align_legacy_columns.sql.
NOTIFY pgrst, 'reload schema';
