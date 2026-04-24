# Migrations

## Rule: migrations apply only via the GitHub Action

The `Database Migration` workflow (`.github/workflows/db-migrate.yml`) runs
`supabase db push --include-all` against prod after CI passes on `main`.
**Do not run `supabase db push` (or any equivalent migration command) from a
local shell against production.** Add the migration file, open a PR, let the
`migration-upgrade-test` CI job replay it against the legacy fixture, and
merge — the action takes it from there.

This rule exists because production drifted from the migration files once
already (column-name skew between prod's `youtube_id`/`summary_text` and
the code's `youtube_url`/`summary`); manual interventions are how that
class of bug enters the codebase. The action gives you one chronologically
ordered apply log per merge to `main`.

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
