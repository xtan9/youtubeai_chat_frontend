-- Regression guard for the cache-write failure that broke translation
-- caching in production (verified 2026-04-25). Reproduces the exact
-- supabase-js .upsert(..., { onConflict: 'video_id,output_language' })
-- call writeCachedSummary issues for a video that already has a
-- native-language row.
--
-- Pre-fix this fails with 23505 "duplicate key value violates unique
-- constraint summaries_video_id_summary_type_reasoning_key" because the
-- legacy multi-column UNIQUE forces every row for a given video to share
-- (summary_type, reasoning), and both default to ('standard', false).
-- Post-fix (20260424000005_drop_legacy_summary_columns.sql) the rogue
-- constraint and the columns it referenced are gone, so the second
-- upsert lands cleanly.
--
-- Runs in CI's migration-upgrade-test after migrations apply. Re-runs
-- for free during the idempotency replay because the assertions guard
-- on row counts, and the fresh container starts empty each job.

INSERT INTO videos (id, youtube_url, url_hash, title, channel_name, language)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'https://www.youtube.com/watch?v=fixture0001',
    'fixture0001',
    'Fixture',
    'Test Channel',
    'en'
);

-- Native-language summary row (output_language IS NULL).
INSERT INTO summaries (
    video_id, transcript, summary, transcript_source, model,
    processing_time_seconds, transcribe_time_seconds, summarize_time_seconds,
    output_language
) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'native transcript', 'native summary',
    'auto_captions', 'claude-haiku-4-5-20251001',
    1.0, 0.5, 0.5, NULL
);

-- The translation upsert that failed pre-fix. PostgREST translates
-- supabase-js's onConflict: "video_id,output_language" into this exact
-- shape, so a green run here proves the runtime cache-write path works.
INSERT INTO summaries (
    video_id, transcript, summary, transcript_source, model,
    processing_time_seconds, transcribe_time_seconds, summarize_time_seconds,
    output_language
) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'translation transcript', 'vi summary',
    'auto_captions', 'claude-haiku-4-5-20251001',
    1.0, 0.5, 0.5, 'vi'
)
ON CONFLICT (video_id, output_language) DO UPDATE
    SET summary = EXCLUDED.summary;

-- An idempotent re-upsert of the translation row must update in place,
-- not insert a duplicate. Catches a regression where someone weakens the
-- canonical UNIQUE on (video_id, output_language).
INSERT INTO summaries (
    video_id, transcript, summary, transcript_source, model,
    processing_time_seconds, transcribe_time_seconds, summarize_time_seconds,
    output_language
) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'translation transcript v2', 'vi summary v2',
    'auto_captions', 'claude-haiku-4-5-20251001',
    1.0, 0.5, 0.5, 'vi'
)
ON CONFLICT (video_id, output_language) DO UPDATE
    SET summary = EXCLUDED.summary;

DO $$
DECLARE row_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO row_count
    FROM summaries
    WHERE video_id = '11111111-1111-1111-1111-111111111111';
    IF row_count <> 2 THEN
        RAISE EXCEPTION
            'translation upsert regression: expected 2 summaries rows for fixture video, got %',
            row_count;
    END IF;
END $$;
