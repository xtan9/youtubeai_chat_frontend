# Chinese-English code-switch blind corpus governance

## Status

This repository contains a deterministic, repository-authored synthetic
inventory for the Chinese-English code-switch blind slice. It is **not
approved, not frozen, and not available for final tuple evaluation**. The
pending evidence slot is
[`channel-chinese-english-code-switch-blind-corpus-approval.json`](../compliance/channel-chinese-english-code-switch-blind-corpus-approval.json).

No human reviewer, rights holder, licensed Creator example, external harness
result, or YouTube API Data use is asserted here. The inventory is safe to run
offline and is unavailable for model, prompt, taxonomy, or validator tuning.

## Inventory contract

`createChineseEnglishCodeSwitchBlindEvaluationCorpus()` in
[`lib/channel/code-switch-blind-corpus-governance.ts`](../../lib/channel/code-switch-blind-corpus-governance.ts)
materializes 1,250 deterministic records: 1,000 classification/adversarial
records plus 250 dedicated zero-tolerance validator records:

| Dimension | Required minimum | Inventory count |
| --- | ---: | ---: |
| Allowed Criticism | 300 | 300 |
| Actionable Abuse | 250 | 250 |
| Reviewable Interaction | 200 | 200 |
| Safety Flag | 200 | 250 (including adversarial records) |
| Prompt-injection or adversarial | 50 | 50 |
| Zero-tolerance validator items | 250 | 250 |
| Minor-safety items | 200 | 200 |
| Each protected-group cross-cut | 100 | 111 or 112 |
| Meaningful code-switch items | 1,250 | 1,250 |

The category values in this pending inventory are balancing labels, not human-
approved gold labels. The 1,000-item total counts classification and
adversarial records; validator records are counted separately and do not
inflate category, protected-group, or minor-safety counts. Coverage is derived
from item records and a tampered declared coverage block is rejected. Each
scored item has at most one occurrence of a given protected-group key and the
counts remain traceable in the manifest.

Every admitted item contains an independently meaningful English clause and
Chinese clause. The eligibility check requires at least two meaningful English
words and a content-bearing Chinese clause; it does not count a proper name,
an isolated loanword, or an interface term as a language clause. The checked-
in evidence fields are compared with clauses derived from the text, so they
cannot turn an ineligible item into an eligible one by declaration alone.

The protected-group keys are the D74 categories: age; caste, ethnicity, or
race; disability; immigration status; nationality; religion; sex, gender, or
sexual orientation; veteran status; and victims of a major violent event and
their kin. Minor-safety records are Safety Flag records.

## Allowed data origins

The permanent corpus admits only authored synthetic records or separately
governed Creator examples. The checked-in inventory contains zero Creator
examples. Synthetic records use `synthetic://` references, original-synthetic
rights, and an explicit not-applicable de-identification record. Creator
examples require separate consent, license, and de-identification evidence.

YouTube API comments, comment IDs, author identities, and provider responses
are not permitted corpus origins. The schema and validator reject those
origins and references.

## Human review and lifecycle

Each item requires two independent reviewer labels. A disagreement requires a
distinct third reviewer, whose label becomes the final label. The checked-in
records intentionally have pending reviewer provenance. Automated identities
cannot satisfy item review, approval, or freeze evidence.

The lifecycle is ordered:

1. complete item reviews and any adjudications;
2. record named human approval for the exact corpus fingerprint;
3. record a later freeze for that same fingerprint; and
4. run the offline quality harness against the frozen corpus and exact tuple.

The repository-side validator and fail-closed assertion enforce these
boundaries. This change records none of the external or human evidence needed
to advance the pending slots.

## Offline quality-harness seam

`toChannelQualityBlindCorpusManifest()` projects only an approved, frozen
inventory into #482's generic `ChannelQualityCorpusManifest` contract. It uses
the upstream `createChannelQualityCorpusItem()` and
`freezeChannelQualityCorpus()` seams, preserves bounded item hashes and
reviewer-linked code-switch evidence, and refuses pending or unreviewed input.
The source corpus remains authoritative for item-level rights and review
provenance. A projected slice is combined with separate development and other
language blind manifests before the generic `evaluateChannelQualityRelease()`
runner is invoked; this prevents a language slice from masquerading as the
complete multilingual release corpus.

The #482 harness is offline and does not call a provider or model. It records
only bounded structured outcomes and computes point estimates plus 95% Wilson
intervals overall, by supported language, and by protected-group cross-cut.
It measures Actionable Abuse precision, Allowed Criticism false-positive rate,
Safety Flag recall, Safety Flag draft suppression, and rejection/accepted-unsafe
outcomes for each zero-tolerance validator. Missing, malformed, incomplete,
non-reproducible, or governance-blocked results cannot pass the gate.

Protected-group slices are reported as required cross-cuts. The point and
Wilson release gates apply overall and by supported language; small cross-cut
samples remain audit output rather than an artificially strong pass/fail claim.

Run the repository-side validator from a checkout with the local dependencies
installed:

```text
pnpm validate:channel-code-switch-blind-corpus
```

The command intentionally exits nonzero while human review, approval/freeze,
and the upstream #482 evidence are pending. That is a fail-closed state, not a
claim that the synthetic inventory is unusable.
