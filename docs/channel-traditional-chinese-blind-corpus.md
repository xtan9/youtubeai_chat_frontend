# Traditional Chinese blind evaluation corpus

The repository-side manifest for the Traditional Chinese Channel evaluation
slice is exposed by
`test-fixtures/channel-evaluation-corpus/traditional-chinese-blind.manifest.ts`.
Its schema, deterministic inventory, fingerprints, and fail-closed validator
live in `lib/channel/evaluation-corpus-governance.ts`.

Run the repository check with:

```text
pnpm validate:channel-evaluation-corpus
```

The checked-in inventory is a synthetic candidate scaffold. It deliberately
does not claim that human review, approval, or freeze has happened, and it does
not contain licensed examples or YouTube API comments. Every materialized item
records synthetic origin, rights status, de-identification status, the pinned
repository policy version, cross-cuts, and the independent-review provenance
fields.

## Inventory contract

The candidate materializes 1,250 records:

| Slice | Required | Materialized |
| --- | ---: | ---: |
| Blind classification/adversarial items | 1,000 | 1,000 |
| Allowed Criticism | 300 | 300 |
| Actionable Abuse | 250 | 250 |
| Reviewable Interaction | 200 | 200 |
| Safety Flag (non-adversarial) | 200 | 200 |
| Prompt-injection/adversarial items | 50 | 50 |
| Zero-tolerance validator items | 250 | 250 |

Adversarial items are additionally assigned the blocking `Safety Flag` gold
category, so the aggregate Safety Flag count is 250 while
`baseCategoryCounts` remains the required 200. This keeps the category and
adversarial requirements traceable without double-counting the 1,000-item
blind slice.

The nine protected-group cross-cuts are each represented by at least 100
items. `minor_safety` is represented by 200 items. The exact generated counts
are retained in the adjacent JSON manifest summary.

## Review and release evidence

The required protocol is encoded as
`two_independent_reviewers_third_resolves_disagreements`. A releaseable
manifest must carry two distinct reviewer labels and a third adjudication for
every item, plus explicit approval and freeze evidence. The candidate's
`reviewerRegistry`, `approvalEvidence`, and `freezeEvidence` are intentionally
`not_recorded`.

Freeze evidence is accepted only after approval evidence and complete reviewer
provenance are present. Final tuple evaluation must occur strictly after the
freeze timestamp. The content fingerprint remains stable across these
lifecycle records so evidence points to one exact corpus.

The candidate also records that the upstream quality harness is blocked by
issue #482. A future `complete` harness status must include an evidence
reference. No harness result, human approval, licensed-data clearance, or
final tuple evaluation is fabricated here. Consequently the validator reports
the manifest as structurally valid but `releaseReady: false`; the command exits
non-zero until those blockers are resolved.

Blind manifests are never accepted at the tuning seam; use of the manifest for
tuning returns the `blind_corpus_not_tunable` blocker.
