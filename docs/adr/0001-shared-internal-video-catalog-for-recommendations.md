# Use a shared internal Video Catalog for Recommendations

Recommendation actions read versioned Recommendation Sets prepared from the shared internal Video Catalog and never wait on an external discovery provider. External discovery runs asynchronously under a quota budget, normalizes results into reusable Videos and Discovery Observations, and never uses learner-linked behavior as shared ranking input; this favors reuse, predictable latency, and privacy over live provider breadth or cross-user personalization.
