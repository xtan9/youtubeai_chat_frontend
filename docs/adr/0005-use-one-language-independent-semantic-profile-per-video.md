# Use one language-independent Semantic Profile per Video

A Video has one active Semantic Profile per semantic-model version regardless of how many output-language Summaries exist. The profile is derived from native Video meaning and canonical metadata, while translated Summaries remain alternate presentations; this avoids fragmenting identity and duplicating Recommendations at the cost of requiring a multilingual semantic model and explicit profile-version migrations.
