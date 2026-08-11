# Project readiness report

The Project readiness report is an operator-run, machine-readable gate. It
reports whether the current Research Workspace evidence is eligible for a
human general-availability review. It never changes rollout state itself.

## Inputs

The command combines two content-free sources:

- 30-day PostHog aggregates from the existing Project adoption event
  contracts. Queries exclude Smoke Accounts and contain only stable Project
  IDs, bounded counters, timing, cost, and governed categorical metadata.
- The versioned fixture catalog in
  `lib/admin/project-readiness-fixtures.ts`. It executes the exact Grounded
  Answer, retrieval, privacy, RLS, service-role, processing, Project-cap,
  message-cap, and Artifact-cap seams used by CI.

Before running database fixtures, create a freshly migrated disposable database
whose name begins with `project_readiness_`. The command refuses to spawn
`psql` unless the explicit URL and decoded database name agree, and both the
hostname and database name appear in separate operator-provided allowlists.
`PROJECT_READINESS_ALLOW_DATABASE_FIXTURES=true` is an additional acknowledgement,
not a substitute for positive target validation. The URL is passed to `psql`
through its child environment and is never written to the machine report.

The two operator-approved guardrails are required for an eligible result:

- `PROJECT_READINESS_MAX_PROCESSING_FAILURE_PCT`
- `PROJECT_READINESS_MAX_COST_PER_ACTIVATED_PROJECT_USD_MICROS`

If either guardrail, PostHog configuration, an observation, or a fixture is
missing or invalid, the report remains `controlled_beta`. The report records
the observed D7 return baseline with a `null` target; it does not invent a
retention threshold.

## Run

Configure `POSTHOG_PROJECT_ID`, `POSTHOG_PERSONAL_API_KEY`, and optionally
`POSTHOG_QUERY_HOST`, then run from the repository root:

```powershell
$env:PROJECT_READINESS_ALLOW_DATABASE_FIXTURES = "true"
$env:PROJECT_READINESS_DATABASE_URL = "postgresql://postgres:password@127.0.0.1:54329/project_readiness_local"
$env:PROJECT_READINESS_DATABASE_NAME = "project_readiness_local"
$env:PROJECT_READINESS_DATABASE_HOST_ALLOWLIST = "127.0.0.1,localhost"
$env:PROJECT_READINESS_DATABASE_NAME_ALLOWLIST = "project_readiness_local"
$env:PROJECT_READINESS_MAX_PROCESSING_FAILURE_PCT = "10"
$env:PROJECT_READINESS_MAX_COST_PER_ACTIVATED_PROJECT_USD_MICROS = "25000"
corepack pnpm run report:project-readiness > project-readiness.json
```

The command writes test diagnostics to stderr and writes only the JSON report
to stdout. Exit code `0` means every required gate passed and the result is
`eligible_for_ga_review`; exit code `2` means the report was produced but broad
availability must remain controlled. An execution failure uses exit code `1`.
Every child fixture has a catalog-owned wall-clock deadline and is terminated
when it exceeds that deadline. The JSON records the immutable fixture catalog
version and exact Git commit SHA, plus retrieval-specific represented-source
numerator, material-ready-source denominator, and rate. It refuses to run from
a dirty Git tree, so the reported commit identifies the exact fixture catalog
and application code that produced the result.

The readiness claim covers YouTube Projects with at most five Videos. External
Web Research, mixed sources, and Projects larger than five Videos remain
explicitly excluded in every report.
