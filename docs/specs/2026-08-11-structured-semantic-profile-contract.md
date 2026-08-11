# Structured Semantic Profile contract (Issues #346/#349)

## Scope

This is the first-release replacement for the embedding-specific #349
acceptance. It does not close #349 by itself: real Gateway evaluation and
human review remain required before activation or pilot exposure. The private
model registry is empty by default, so no profile generation or retrieval is
available until that evidence and approval are recorded.

## Dependency

Blocked by #348 (Catalog Admission).

## Profile

An admitted public Video receives at most one active
`semantic-profile-v1` Profile for the current approved evidence fingerprint;
the persisted Profile binds that fingerprint so a later activation cannot
make an older evaluation's output retrievable.
The server-only LLM Gateway produces exactly one JSON object with:

- BCP-47 source language;
- bounded topics and core concepts as `{key,label}` pairs;
- bounded prerequisite, application, and counterpoint concept keys; and
- `beginner`, `intermediate`, `advanced`, or `mixed` difficulty.

Concept keys are lowercase ASCII kebab-case and are the only retrieval
representation. The server sorts them, rejects duplicates, rejects unknown
fields/scores/IDs/provider certainty, and persists only the validated object.
The raw provider response is not retained.

## Lifecycle and privacy

Admission is asynchronous through private pgmq and authenticated cron. The
worker has idempotent request fingerprints, a four-attempt retry/dead-letter
bound for identified requests, an atomic daily Processing Budget, and an obsolete
acknowledgement when the Video is no longer active. An envelope without a
trustworthy request identity is quarantined immediately rather than retried against
an unknown row; identified malformed envelopes use the same bounded retry/dead-letter
policy. The worker rechecks Video activity immediately before persistence. A changed
evidence fingerprint creates a successor request; any older pending/in-flight request
is marked obsolete so stale output cannot become the current profile, and the new
version supersedes the old active version without mutating history.
If an obsolete or exhausted request becomes eligible again after a governed
reactivation, the authenticated service request seam resets and re-enqueues its
durable request with the same approved fingerprint rather than silently blocking
the Video forever. Activation rebinds already-pending requests but does not run
an unbounded catalog scan inside the activation transaction; existing active
Videos are submitted through that same bounded service seam.

All Profile tables, queue functions, and candidate evidence are in
`catalog_private`; browser roles have no schema usage, table access, or RPC
execution. Learner requests never call the LLM, discovery provider, or an
embedding service.

The private `semantic_profile_model_registry` is the activation seam. An
operator may activate exactly one model/schema/prompt tuple only when the
private evaluation ledger contains a passed Gateway evaluation with all
required metrics and the private approval ledger contains a matching,
named human approval. The registry stores the 64-hex evaluation fingerprint
and opaque approval reference, but neither is self-attested by the service
role. Every durable request binds that exact activation fingerprint, model,
and prompt; budget start, completion, and candidate retrieval reject a
different or retired activation. Activation retires the previous tuple;
retirement immediately stops new work and makes its Profiles non-retrievable.
There is no default or environment-only activation, and activation never
happens from a benchmark result automatically.

## Retrieval

The service-only retrieval RPC selects active Profiles with the same profile
schema version, excludes the source/inactive Videos, scores topic/core/
prerequisite/application/counterpoint overlap, bounds results to 50, and breaks
ties by stable Video UUID. It makes no network call. A later asynchronous
Recommendation Assessment may call the Gateway only for this deterministic
pool.

## Evaluation still required

Before activation, the fixed evaluation must use the configured backend Gateway
and record schema-validity rate, multilingual concept normalization,
cross-language useful-neighbor recall, false-neighbor rejection, latency,
token/cost totals, retry/dead-letter behavior, and representative source
coverage. The result is evidence for human review, not automatic activation.
