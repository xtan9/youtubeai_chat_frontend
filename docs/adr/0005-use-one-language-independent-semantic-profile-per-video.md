# Use one language-independent Semantic Profile per Video

A Video has one active Semantic Profile per profile-schema and generator-policy version regardless of how many output-language Summaries exist. The profile is derived from approved native Video meaning and canonical metadata by the server-only LLM Gateway, while translated Summaries remain alternate presentations. Concept keys are normalized into a bounded language-independent representation and retrieved through deterministic Postgres overlap scoring; provider-specific embeddings are not required for the first release.
