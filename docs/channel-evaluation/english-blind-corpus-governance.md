# English Channel blind corpus governance

## Status

The repository contains a deterministic, repository-authored synthetic inventory
for the English blind slice. It is **not approved, not frozen, and not
available for final tuple evaluation**. The explicit evidence record is
[`channel-english-blind-corpus-approval.json`](../compliance/channel-english-blind-corpus-approval.json).

This issue is blocked by #482. The inventory and its validator do not claim that
the upstream offline quality harness exists, that a human reviewer has labeled
the items, or that a Creator example is consented, licensed, or de-identified.

## Inventory contract

`createEnglishBlindEvaluationCorpus()` in
[`lib/channel/evaluation-corpus-governance.ts`](../../lib/channel/evaluation-corpus-governance.ts)
materializes 1,000 deterministic synthetic records. The inventory's proposed
category counts are:

| Dimension | Required minimum | Inventory count |
| --- | ---: | ---: |
| Allowed Criticism | 300 | 300 |
| Actionable Abuse | 250 | 250 |
| Reviewable Interaction | 200 | 200 |
| Safety Flag | 200 | 250 |
| Prompt-injection or adversarial | 50 | 50 |
| Zero-tolerance validator items | 250 | 250 |
| Minor-safety items | 200 | 200 |
| Every protected-group cross-cut | 100 | 111 or 112 |

The category values in this pending inventory are synthetic balancing labels, not
human-approved gold labels. The validator derives all counts from item records
and rejects a tampered declared coverage block. Minor-safety records are
Safety Flag records, and each record can count at most once for a protected-group
cross-cut.

The protected-group keys follow the approved D74 policy categories:

- age;
- caste, ethnicity, or race;
- disability;
- immigration status;
- nationality;
- religion;
- sex, gender, or sexual orientation;
- veteran status; and
- victims of a major violent event and their kin.

Synthetic records retain multilingual authoring metadata (`en`, `zh`, and
`zh-TW`) while the governed evaluation language is English. Prompt-injection
and adversarial records are marked as cross-cuts; they are never instructions to
the validator or to a future model.

## Allowed data origins

The permanent corpus admits only these origin kinds:

1. `authored_synthetic`, with original-synthetic rights and an explicit
   not-applicable de-identification record; or
2. `creator_example`, only when the item has separate consent evidence, license
   evidence, and verified de-identification evidence.

The checked-in inventory contains zero Creator examples. No YouTube API comment,
comment ID, author identity, or provider response is a permitted corpus origin.
The schema rejects YouTube API origin kinds, and the approval evidence explicitly
records that permanent-corpus use is false.

Every item records:

- an opaque origin reference and origin kind;
- rights basis and evidence slots;
- de-identification status, method, and evidence slot;
- the exact repository policy version;
- blind-only evaluation use;
- category and safety cross-cuts; and
- reviewer provenance.

## Human review and approval

The required review protocol is two independent reviewer labels per item. When
those labels disagree, a distinct third reviewer records the adjudicated label.
The item-level `reviewerProvenance` contract rejects missing, duplicate, or
non-independent reviewer records and requires the final label to match the
review outcome.

The checked-in records intentionally have pending reviewer provenance. A future
human-owned update must preserve the exact corpus fingerprint and record the
review evidence before setting the corpus approval slot to `recorded`.
Automated identities cannot satisfy the approval or freeze slots.

Approval and freeze are separate evidence events:

1. complete all item reviews and adjudications;
2. record named human approval for the exact corpus fingerprint;
3. record a later freeze for that same fingerprint; and
4. only then make the final tuple evaluator available.

The validator rejects tuple evaluation that starts before the recorded freeze.
The blind inventory remains unavailable for model, prompt, taxonomy, or
validator tuning at every lifecycle state.

## Validation

Run the repository-side validation command from a clean checkout after issue
#482 supplies the upstream harness:

```text
pnpm validate:channel-evaluation-corpus
```

Until the human evidence and #482 are complete, the command reports a valid
inventory with explicit release blockers. It must not be changed to fabricate a
passing approval, freeze, licensed example, or harness result.
