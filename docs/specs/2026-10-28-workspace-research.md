# Workspace research improvement

Approved direction: the user's 2026-10-28 request to comprehensively improve
Workspace and exercise the supplied test account. Baseline: `004091a`.

## Outcome

A researcher can ask in Chinese about five English videos, inspect complete
timestamped evidence, compare competing positions, and produce a useful brief.
The project goal guides the work but never establishes the conclusion.

## Acceptance

- Natural-language research extracts neutral, bounded queries in the available
  transcript languages. Literal transcript search remains a separate tool.
- A retrieval miss says no relevant passage was found; it is not a judgment
  that the sources refute or cannot support a claim.
- Research evidence includes neighboring transcript context, with canonical
  range identities validated against stored transcripts before persistence.
  Existing single-segment snapshots and historical artifacts remain readable.
- New briefs summarize findings, agreements, disagreements and open questions
  with validated citations; neither isolated caption fragments nor the user's
  preferred conclusion count as findings by themselves.
- Research is the primary workspace. Sources, outputs, transcript search and
  settings are accessible without forcing a long scroll. Source inspection,
  guided actions and evidence details remain available after the first answer.
- Source activity and retrieval diagnostics are compact by default and fully
  inspectable. Drafts, in-flight answers, accessibility and dark mode survive
  navigation between panels. Questions may contain up to 4,000 code points.

## Verification

Use the existing repository test seams: real API handlers with mocked service
boundaries, service-level gateway tests, PostgreSQL regression fixtures, and
browser workflows. Cover multilingual retrieval, opposing views, qualified
statements, immutable evidence, unsupported queries, legacy compatibility,
mobile layout and durable reload. Use the supplied seed-oil project for live
acceptance. Keep simulated, local, hosted CI and live evidence distinguishable.

This is research over selected videos, not an external medical fact-checking
service. Claims about what a speaker said and broader scientific conclusions
must remain distinguishable in the output.
