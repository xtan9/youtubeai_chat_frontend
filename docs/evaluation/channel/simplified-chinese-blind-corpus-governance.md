# Simplified Chinese blind corpus governance

## Current status

Issue #484 has a checked-in governance manifest and a machine-readable
approval/freeze evidence record, but the slice is intentionally **blocked**.
The repository does not claim human approval, a completed blind freeze, a
licensed example set, or completion of the upstream harness in issue #482.

- Manifest: `simplified-chinese-blind-corpus.manifest.json`
- Evidence: `simplified-chinese-blind-corpus-approval-freeze-evidence.json`
- Validator: `pnpm validate:channel-evaluation-corpus` (checks the manifest and
  that the evidence record agrees with its status)

The manifest contains no item text. Governed item content must be supplied
through a controlled external store or a separately reviewed change; an empty
inventory is reported as blocked rather than being treated as a passing
placeholder.

## Required inventory

The fixed Simplified Chinese blind slice requires at least 1,000 items in five
disjoint strata:

| Stratum | Minimum |
| --- | ---: |
| Allowed Criticism | 300 |
| Actionable Abuse | 250 |
| Reviewable Interaction | 200 |
| Safety Flag | 200 |
| Prompt-injection or adversarial | 50 |

Adversarial items are a separate evaluation stratum. Each still records its
expected interaction classification so the final tuple evaluator can assess
both instruction isolation and classification behavior. The language also
requires at least 250 zero-tolerance validator items covering privacy, threat,
impersonation, diagnosis, spam, malicious-link, and instruction-echo failures.

The manifest reports computed counts for every stratum, validator class,
protected-group cross-cut, and minor-safety item. The validator compares every
reported count with the item inventory and then applies the fixed minimums.
Protected-group cross-cuts are the nine policy categories recorded in the
manifest, each requiring at least 100 items. Minor-safety coverage requires at
least 200 items and must resolve to `safety_flag`.

## Item provenance contract

Every item must record:

- its Simplified Chinese language, stable ID, and bounded text;
- an origin limited to authored synthetic, consented de-identified, or
  licensed de-identified data;
- rights status, basis, and evidence for any consented or licensed example;
- de-identification status, method, and evidence for any non-synthetic
  example;
- the policy version used for labeling; and
- two independent reviewer records with distinct reviewer and assignment IDs.

`origin.youtubeApiData` must be `false`, and the manifest policy permanently
prohibits YouTube API comments from entering the corpus. This repository does
not provide a scraper or a fallback path for API comments.

## Independent review and freeze

The review protocol is `channel-blind-review-v1`: two independent reviewers
label each item. If their labels disagree, a distinct third reviewer records
the adjudicated label and rationale reference. An adjudication is not added to
items whose independent labels already agree.

Approval requires a declared human approver, timestamp, and evidence reference.
Freeze requires a freezer identity, repository revision, corpus-manifest digest,
timestamp, evidence reference, and an explicit assertion that the freeze
preceded final tuple evaluation. The digest covers the governed corpus and
manifest policy fields,
excluding approval, freeze, and upstream-harness status fields so an approval
record cannot silently change the corpus identity.

The use gate allows only final tuple evaluation after all of those conditions
pass. It always denies tuning or development selection. Current final tuple
evaluation remains blocked by the absent #482 harness as well as the absent
corpus and approval/freeze evidence.

## Safe completion boundary

This change supplies the repository-side contract and fail-closed checks. It
does not generate examples, assert rights, invent reviewer decisions, select a
policy revision, mark the corpus approved, freeze it, run the final tuple, or
complete issue #482. Those records must come from the separately governed data
and independent human-review process before the checked-in evidence can move
from blocked to ready.
