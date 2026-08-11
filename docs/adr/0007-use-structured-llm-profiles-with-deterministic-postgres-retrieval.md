# Use structured LLM Profiles with deterministic Postgres retrieval

Status: Accepted for the first Continue Learning implementation

Date: 2026-08-11

## Decision

The first implementation creates one language-independent Semantic Profile per
admitted Video by calling the existing server-only LLM Gateway from a durable,
authenticated worker. The Gateway response is a strict, versioned JSON object
containing bounded topics, core concepts, prerequisites, applications,
counterpoints, and difficulty. The server rejects invalid JSON, unknown fields,
unbounded values, duplicate concept keys, and provider-authored scores or IDs.

Profiles are stored in the private Postgres catalog schema. Candidate retrieval
uses GIN-indexed concept arrays, deterministic overlap scoring, fixed limits,
and a stable Video-ID tie-break. A learner request never calls the LLM, an
external discovery provider, or an embedding service. A later asynchronous
assessment worker may call the Gateway only after deterministic retrieval; that
assessment is a separate versioned resource.

The existing `LLM_GATEWAY_URL`, `LLM_GATEWAY_API_KEY`, and `LLM_MODEL` server
configuration is reused. No provider-specific OpenAI embedding credential is
required. The Gateway call remains server-only, bounded by timeout and durable
processing budget, and its output is validated before persistence.

## Consequences

This removes pgvector, embedding-model selection, and the paid small-vs-large
embedding benchmark from the first release. The required evaluation becomes a
fixed multilingual Gateway evaluation of schema validity, concept
normalization, cross-language candidate recall, false-neighbor rejection,
latency, and cost. Human review remains required before any pilot activation.

Postgres array overlap is intentionally conservative and explainable, but it
may have lower recall than a future embedding system. A future vector or
hybrid index is a new versioned decision and must not silently change the
current profile or candidate semantics.

## Supersedes

This decision supersedes the embedding/pgvector implementation direction in
ADR 0004 and the embedding-specific wording in ADR 0005 for the first release.
Those records remain in history so the architecture change is auditable.
