-- summaries.suggested_followups — per-summary, per-video cache of three
-- suggested chat starter questions used by the chat tab's empty state.
--
-- Generated lazily by `GET /api/chat/suggestions` the first time a user
-- opens chat for a given video. Persisted here (rather than in a
-- separate table) so it lives next to the summary it was derived from
-- and gets the same `ON DELETE CASCADE` behaviour for free.
--
-- jsonb (not text[]) so the wire shape is exactly the JSON the LLM
-- emits — no array<->text serialization round-trip and no schema-drift
-- surface. Schema validation lives in
-- `lib/services/suggested-followups.ts` (zod) at the trust boundary.
--
-- Re-applicable: ADD COLUMN IF NOT EXISTS pattern matches every other
-- migration in this repo (20260417000000_cache_schema.sql, etc.) so
-- the migration-upgrade-test (which re-applies every migration twice)
-- passes.

ALTER TABLE summaries
    ADD COLUMN IF NOT EXISTS suggested_followups JSONB DEFAULT NULL;

NOTIFY pgrst, 'reload schema';
