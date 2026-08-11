# Keep semantic data and background work in Postgres

Semantic Profiles and all background work remain in the existing Postgres database, with private durable queues consumed by authenticated scheduled workers. ADR 0007 supersedes the first-release storage detail: structured LLM Profiles use GIN-indexed concept arrays and deterministic overlap retrieval; pgvector and embedding-model selection are deferred to a separately versioned future decision. This keeps the queue, RLS, retry, budget, and audit boundary stable without requiring a provider-specific embedding credential.
