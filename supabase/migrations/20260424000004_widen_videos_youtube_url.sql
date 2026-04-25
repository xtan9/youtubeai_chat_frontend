-- Widen videos.youtube_url from varchar(20) to TEXT.
--
-- The column was originally named `youtube_id` and stored the 11-char
-- YouTube video ID, so varchar(20) was sufficient. PR #21
-- (20260424000001_align_legacy_columns.sql) RENAMEd the column to
-- `youtube_url` to match the canonical name the cache code writes —
-- but RENAME COLUMN preserves the original type. Production's
-- youtube_url is still varchar(20), and the cache code writes the
-- full URL (e.g. "https://www.youtube.com/watch?v=jNQXAC9IVRw" = 43
-- chars), so every videos upsert has been failing with:
--   ERROR:  value too long for type character varying(20)
-- Verified 2026-04-25 via Supabase postgres logs after PR #23 merged
-- without unblocking cache writes.
--
-- Same incident class as the column-rename and missing-UNIQUE drifts
-- that PR #21 and PR #23 fixed — another reconciliation gap from the
-- legacy-schema branch. With this migration the videos upsert finally
-- succeeds, writeCachedSummary and writeCachedTranscript both land,
-- and the language-switch shortcut from PR #22 starts engaging.
--
-- The matching CHECK constraint `youtube_id_length CHECK
-- (char_length(youtube_url) >= 11)` stays — the lower bound is still
-- correct.

ALTER TABLE videos ALTER COLUMN youtube_url TYPE TEXT;

-- Force PostgREST to refresh its in-memory schema cache so the next
-- upsert call sees the widened type without waiting for the natural
-- ~10-minute poll. Same pattern as
-- 20260424000001_align_legacy_columns.sql.
NOTIFY pgrst, 'reload schema';
