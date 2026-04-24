# Migrations

## Rule: one forward-only delta per migration

Every new migration should be a single, small, forward-only DDL change:

```bash
supabase migration new add_summary_word_count
# then edit the file to contain ONE conceptual change, e.g.:
#   ALTER TABLE summaries ADD COLUMN word_count INTEGER;
```

Do NOT write "big idempotent" migrations that try to be both "create
from scratch" and "reconcile pre-existing tables" in one file. That was
what broke on `db-migrate` run 24593654019: `CREATE TABLE IF NOT EXISTS`
silently skipped when the table already existed, so every later CHECK
constraint referencing a new column failed with "column does not exist."

Supabase's `schema_migrations` tracker already prevents re-runs, so a
normal migration does NOT need `IF NOT EXISTS` gymnastics. The only
migration in this repo that does is `20260417000000_cache_schema.sql`,
which was the big-bang initial schema and is the reason this rule
exists.

## Before opening a PR that adds a migration

1. Run locally against a fresh DB: `supabase db reset` (or equivalent).
2. Let the `migration-upgrade-test` CI job run. It replays the legacy
   fixture (`supabase/test-fixtures/legacy_schema.sql`) + every
   migration in order, then re-applies them to prove idempotency.
3. If the test fails, fix the migration — do NOT edit the fixture to
   match.
