# Semantic Profile Gateway evaluation

Issue #349 remains dormant until a real configured-Gateway evaluation and a
separate named human approval authorize the exact model, profile schema, prompt,
and evidence fingerprint. This command creates review evidence only. It never
writes the private evaluation or approval ledgers, calls an activation RPC, or
changes learner-visible behavior.

## Fixed evaluation

`semantic-profile-structured-multilingual-v1` contains 28 fixed synthetic
cases, run twice for exactly 56 Gateway calls. It covers all 18 supported
languages, all four Continuation Relationships, equivalent cross-language
meaning, a plainly unrelated source, and a deceptive lexical hard negative.
Both trials use the production `semantic-profile-prompt-v1` builder and strict
`semantic-profile-v1` parser.

The artifact records:

- schema validity and source-language binding;
- multilingual canonical-concept normalization;
- useful-neighbor recall using the production Postgres overlap weights;
- false-neighbor rejection and all-relationship coverage;
- repeat consistency and resolved-Gateway-model consistency;
- p95 latency, measured token totals, configured token prices, and estimated
  micro-USD cost;
- representative language coverage; and
- the real Postgres retry/dead-letter fixture paths that must be verified at
  the same source revision.

Only validated profiles are retained in the private artifact. Raw Gateway
responses and error bodies are never included.

## Run from a server-only environment

Use the deployed backend Gateway configuration. `OPENAI_API_KEY` is neither
read nor required. Prices are explicit micro-USD per one million tokens so an
unknown price cannot silently become zero.

Set these server-only values:

```text
LLM_GATEWAY_URL
LLM_GATEWAY_API_KEY
LLM_MODEL
SEMANTIC_PROFILE_SOURCE_REVISION
SEMANTIC_PROFILE_EVALUATION_OUTPUT
SEMANTIC_PROFILE_INPUT_MICRO_USD_PER_MILLION_TOKENS
SEMANTIC_PROFILE_CACHED_INPUT_MICRO_USD_PER_MILLION_TOKENS
SEMANTIC_PROFILE_OUTPUT_MICRO_USD_PER_MILLION_TOKENS
SEMANTIC_PROFILE_EVALUATION_ACKNOWLEDGEMENT=I_UNDERSTAND_THIS_MAKES_56_GATEWAY_CALLS
```

`SEMANTIC_PROFILE_SOURCE_REVISION` must be the full commit hash under review.
`SEMANTIC_PROFILE_EVALUATION_OUTPUT` must be an absolute `.json` path in an
existing private directory. The command uses create-only file semantics and
refuses to replace prior evidence. The optional
`SEMANTIC_PROFILE_GATEWAY_PROVIDER` overrides the default `cliproxyapi` label.

Then run:

```text
corepack pnpm benchmark:semantic-profiles
```

The single stdout line contains only the artifact path, evaluation fingerprint,
request count, automated gate result, and the unchanged activation/human-review
state. A failed Gateway call is recorded with a bounded error code; the other
fixed calls still run, the evidence is written, and the command exits nonzero.

## Required review evidence

An automated `passed` result is not activation approval. Before a privileged
operator records a `passed` evaluation, preserve all of the following together:

1. The create-only JSON artifact and its SHA-256 evaluation fingerprint.
2. Successful real-Postgres results for
   `supabase/test-fixtures/regression_structured_semantic_profiles.sql` and
   `supabase/test-fixtures/regression_structured_semantic_profiles_concurrency.sql`
   at the artifact's exact `sourceRevision`.
3. Human review of every validated profile, useful and false-neighbor outcome,
   source/language coverage, latency, token/cost totals, and any failed gate.
4. A separate named approval record for the exact evaluation fingerprint.

The service role cannot self-attest either ledger record. Activation remains a
separate explicit operator action, and issue #349 must stay open while any item
above is missing.
