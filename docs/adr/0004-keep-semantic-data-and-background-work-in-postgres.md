# Keep semantic data and background work in Postgres

Semantic Profiles use pgvector in the existing Postgres database, and discovery, embedding, assessment, refresh, and rebuild work travels through a private durable Postgres queue consumed by authenticated scheduled workers. This avoids a second datastore and fragile request-bound work at the cost of operating vector indexes and queue consumers in the primary database; embedding-model selection remains benchmark-driven and versioned rather than fixed by this decision.
