-- Reconcile the last known production drift on `summaries`: a leftover
-- multi-column UNIQUE constraint plus five unused columns from a
-- pre-TypeScript schema. None of the prior reconciliation migrations
-- (column rename, url_hash UNIQUE, youtube_url widen) touched them
-- because their symptoms were elsewhere — but they silently broke the
-- per-language summary cache.
--
-- Symptom: every translation request (output_language != NULL) for a
-- video that already had a native cached row returned cached:false on
-- every retry. The route's writeCachedSummary fired but the upsert hit
-- 23505 "duplicate key value violates unique constraint
-- summaries_video_id_summary_type_reasoning_key", was swallowed by the
-- fire-and-forget .catch, and the translation row was never persisted.
-- Verified 2026-04-25 via Playwright probe (3 consecutive POSTs with
-- output_language='vi' — all cached:false) plus manual SQL repro on
-- prod.
--
-- Root cause: production `summaries` had legacy columns summary_type
-- (varchar NOT NULL DEFAULT 'standard'), reasoning (boolean NOT NULL
-- DEFAULT false), language, category, transcript_length, and a UNIQUE
-- (video_id, summary_type, reasoning) constraint. The cache code never
-- writes summary_type or reasoning, so every fresh insert defaulted to
-- ('standard', false) and collided with the existing native row at the
-- multi-column UNIQUE.
--
-- Fix: drop the rogue UNIQUE first (otherwise DROP COLUMN errors on the
-- referenced columns), then the columns. IF EXISTS guards keep this
-- safe on the legacy fixture path AND on the idempotency replay.
-- supabase/test-fixtures/regression_translation_upsert.sql exercises
-- the post-migration upsert in CI.

ALTER TABLE summaries
    DROP CONSTRAINT IF EXISTS summaries_video_id_summary_type_reasoning_key;

ALTER TABLE summaries DROP COLUMN IF EXISTS summary_type;
ALTER TABLE summaries DROP COLUMN IF EXISTS reasoning;
ALTER TABLE summaries DROP COLUMN IF EXISTS language;
ALTER TABLE summaries DROP COLUMN IF EXISTS category;
ALTER TABLE summaries DROP COLUMN IF EXISTS transcript_length;

-- PostgREST caches column/constraint metadata for ~10 minutes. Without
-- the explicit reload the next upsert on prod could still be planned
-- against a schema view that includes the dropped columns and emit a
-- spurious PGRST204. Same pattern as the other 2026-04-24 reconciliation
-- migrations.
NOTIFY pgrst, 'reload schema';
