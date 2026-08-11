# Material claims and Evidence Coverage proposal

**Decision ticket:** [#385](https://github.com/xtan9/youtubeai_chat_frontend/issues/385)

**Parent map:** [#381](https://github.com/xtan9/youtubeai_chat_frontend/issues/381)

**Status:** Owner-reviewed decision proposal; external confirmation and public launch remain unapproved

## Inherited boundaries

- The beta assesses one Video through a coherent, reliably timed English Transcript and selects 8–15 material claims. Fewer than eight eligible Material Claim Units is Not eligible, never a reason to pad.
- High-risk, visually dependent, unstable, and otherwise ineligible claims remain explicit exclusions; they never become weak Findings.
- #382 requires one faithful normalized claim per complete Evidence Finding, preserves every material element, and keeps exclusion, Unresolved, and technical failure distinct.
- #384 owns evidence admissibility and sufficiency. #388 owns run/report lifecycle and partial publication. #389 supplies the immutable Gate Packet grammar and exact beta/expansion operating points. #390 owns presentation and comprehension.
- Evidence Coverage is not confidence, factual accuracy, source quality, or a completeness guarantee.

## P-01 — Freeze an outcome-blind Material Claim Inventory

Before external retrieval, source availability, or any Evidence Relationship is known, the system inventories the complete eligible Transcript. It records each distinct assertion with its exact timed span, surrounding context, attribution status, one outcome-blind materiality role, and a separate eligibility state.

The materiality roles are:

- **Central** — necessary to understand the Video's main thesis or conclusion.
- **Consequential support** — not itself the thesis, but changing or removing it would materially change the Video's reasoning or a Learner's likely decision.
- **Incidental** — a checkable detail whose correction would not materially change the thesis or reasoning.

Eligibility is either an eligible stable Claim Unit or **Excluded** with one governed reason, including visual or high-risk dependency, opinion, a pending prediction, unreliable attribution, or normalization that cannot preserve meaning. An excluded assertion retains the Central, Consequential-support, or Incidental role it would have had in the Video; exclusion never erases materiality.

A **Material Claim** is a Central or Consequential-support assertion. Materiality is determined from the claim's role in the Video before evidence retrieval. Truth, controversy, source availability, retrieval ease, likely Evidence Relationship, and model confidence cannot affect it. Repetition and rhetorical emphasis are signals of role, not automatic materiality.

The inventory proves that every timed Transcript segment was examined, deduplicates repeated assertions without losing their occurrences, and freezes before the report selects claims. Excluded material content remains countable in Evidence Coverage and produces no Finding.

### Why this boundary is required

A system-generated denominator cannot prove it noticed a claim it never inventoried. Whole-Video inventory plus a separate human-gold material-claim recall gate is therefore the minimum defense against cherry-picking. Selecting evidence-rich or easy claims first would let trivial truths hide an omitted central dispute.

### Alternatives not recommended

- **Inventory only the 8–15 claims selected for checking:** makes omitted material content invisible by construction.
- **Define materiality by repetition, virality, controversy, or likely harm alone:** confuses rhetorical prominence or external attention with the claim's role in this Video.
- **Rank after retrieval:** lets source availability and expected outcome influence which claims appear to matter.

## P-02 — Normalize faithful Claim Units before selection

A **Claim Unit** is the smallest independently meaningful, checkable proposition
that faithfully preserves every material element of one or more exact Transcript
occurrences. Each candidate is normalized before retrieval and records:

- every exact timed occurrence and the minimum adjacent context needed to preserve
  meaning;
- reliable speaker attribution or an explicit attribution limitation;
- one normalized proposition;
- the asserted entity, quantity, unit, quantifier, polarity, modality,
  conjunction, condition, comparison, qualification, geography, time, and other
  material elements that are present; and
- its outcome-blind materiality under P-01.

Normalization may resolve pronouns and omitted context only from the bounded
Transcript context and only when the resolved proposition is unambiguous. It may
not weaken a quantifier, remove a negation, turn possibility into certainty, drop
a condition, flatten a comparison, invent an entity or date, repair unreliable
attribution, or otherwise produce an easier claim than the Video asserted. A
provider may propose normalization, but it cannot decide fidelity or silently
repair a failed candidate. When faithful normalization is impossible, the item is
`Excluded / normalization_not_faithful`, remains countable in Coverage, and
produces no Finding.

### Decomposition preserves the original assertion

An utterance may become multiple Claim Units only when it explicitly asserts
multiple conjuncts or list items and every resulting unit remains independently
meaningful and checkable with its attribution and material scope intact. Each
resulting unit is reclassified under P-01's removal test; a material compound does
not automatically make every incidental child material.

The system must not split a causal, conditional, comparative, quantified, scoped,
or otherwise relational assertion when doing so changes what was asserted. It
also must not turn an implication or contextual inference into an explicit claim.
An **Assertion Group** retains the exact original compound assertion, its
relationships, and the IDs of any faithfully decomposed units. The group is not a
second Claim Unit and never enters a numerator or denominator, preventing a
parent and its children from being counted twice.

Examples:

- “The registry rose by 12% in 2024 and closed 40 cases” may yield two units when
  each clause is independently meaningful and shares the same unambiguous scope.
- “Because the registry rose by 12%, it closed 40 cases” remains one causal claim
  unless the Video independently asserts the component proposition outside that
  causal relationship.
- “Every region improved” remains one quantified claim; it is not rewritten into
  a weaker collection of examples.
- “A outperformed B in 2024” remains one comparative claim; neither isolated
  measurement can replace the asserted relation.

### Deduplication requires semantic equivalence

Repeated or paraphrased occurrences share one Claim Unit only when every material
element and scope is equivalent. The unit retains all timed anchors and contexts.
If any occurrence is Central, the unit is Central because it performs that role at
least once; repetition by itself never upgrades materiality.

A changed entity, quantity, unit, quantifier, polarity, modality, condition,
comparison, geography, time, attribution, or other material qualifier creates a
different Claim Unit. Unknown equivalence stays separate. Embedding similarity,
shared keywords, or a model-provided duplicate label cannot merge units. Related
but non-equivalent units may share a **Claim Family** for diagnostics and review,
but a family is non-counting, selector-inert, and one member cannot stand in for
another.

### The 15-Finding cap never truncates the inventory

The complete Material Claim Inventory has no 15-claim cap. The beta caps selected
Findings, not the inventory:

| Eligible Material Claim Units | Selection behavior |
| --- | --- |
| 0–7 | `Not eligible / insufficient_material_claims`; no paid retrieval and no Report; do not pad |
| 8–15 | Select every unit |
| More than 15 | If Central units are 15 or fewer, select every Central unit and fill exactly 15 slots under P-03; more than 15 Central units cannot publish under the beta floor |

Every omitted Material Claim remains in Coverage and the bounded private inventory;
its opaque identity and governed reason remain in the content-free audit. P-05's
Coverage floor may prevent publication or make it partial; selection alone does
not authorize a Report. Retrieval ease, likely source availability, expected
Evidence Relationship, controversy, and model confidence cannot influence the
cap or make an Incidental truth replace a Material Claim.

### Alternatives not recommended

- **One Transcript sentence equals one claim:** punctuation and sentence boundaries
  neither guarantee independent meaning nor preserve compound relationships.
- **Split every conjunction:** inflates the denominator and destroys causal,
  conditional, comparative, or quantified meaning.
- **Embedding-threshold deduplication:** can collapse materially different numbers,
  negation, scope, and dates because the sentences remain topically similar.
- **Pad to eight with Incidental truths:** satisfies a numeric minimum while
  misrepresenting what was material in the Video.
- **Stop inventorying at fifteen:** makes omitted central claims unobservable and
  defeats the outcome-blind Coverage denominator.

## P-03 — Select deterministically from server-derived time buckets

Selection consumes only the frozen Material Claim Inventory and timed Transcript.
The provider supplies neither selection IDs nor rank inputs. Claim Family labels,
proposed sections, topic clusters, argument maps, salience scores, and their
ordering are diagnostic-only inputs and cannot change the chosen set.

### Replay-stable Claim Unit and inventory-entry identity

The server assigns every eligible Claim Unit a replay-stable ID by computing a
versioned, domain-separated HMAC-SHA-256 digest over the canonical byte encoding
of:

1. the canonical Video ID;
2. the frozen Transcript version ID and content hash;
3. the canonical material-element record, with a fixed field order, explicit nulls,
   exact typed values, and the normalization-policy version; and
4. every exact occurrence anchor, represented as integer start/end milliseconds
   plus its exact Transcript-span hash and sorted lexicographically.

The selector-policy/key version is part of the digest domain. Canonical encoding
and Unicode handling are versioned server rules, never provider output. The server
validates every material element and anchor against the frozen Transcript,
recomputes the ID, and rejects an unknown, mismatched, duplicate, or provider-
supplied identity. **Only an eligible Claim Unit receives a Claim Unit ID.**

The server also assigns every countable entry a replay-stable opaque **Material
Inventory Entry ID**. It uses a second domain-separated HMAC-SHA-256 digest over
the same canonical Video, Transcript, policy/key-version namespace and exactly one
tagged canonical variant:

- `eligible_claim_unit`: the server-recomputed Claim Unit ID plus its material
  role; or
- `excluded_assertion`: the exact source-language Transcript assertion/span
  identity, its material role, one governed exclusion reason, and every exact
  occurrence anchor/span hash sorted lexicographically.

The canonical `excluded_assertion` encoding has a fixed field order, typed reason
enum, explicit nulls, exact Unicode bytes, and no normalized or provider-authored
substitute. Its content stays in the private Run input store; the keyed opaque ID
may enter the content-free audit. Replaying the same frozen input and policy/key
version therefore produces the same Claim Unit IDs, Material Inventory Entry IDs,
and selection order.

### Central first, then equal-duration time buckets

All Central units are selected first, ordered by earliest occurrence and then
replay-stable Material Inventory Entry ID. More than 15 Central units makes the
beta's non-compensatory floor unreachable and terminates before paid retrieval as
`Not eligible / exceeds_beta_central_claim_cap`; it cannot choose a convenient
subset.

When more than 15 eligible units remain in an otherwise eligible inventory, let
`R = 15 - selected Central count`. The server divides the frozen timed Transcript
interval into exactly `R` equal-duration buckets using integer/rational arithmetic,
without rounded persisted boundaries. For an occurrence start `a`, Transcript
start `s`, positive duration `d`, and bucket count `R`, its bucket is:

```text
min(R - 1, floor(((a - s) * R) / d))
```

When `R = 0`, selection ends with the 15 Central units and every Consequential-
support unit is cap-omitted; no bucket calculation occurs.

A Claim Unit belongs to the bucket containing its earliest exact occurrence.
Internal boundaries are half-open, so an anchor exactly on a boundary enters the
later bucket; the Transcript end enters the final bucket. A zero/negative duration,
out-of-range anchor, inverted span, or otherwise unreliable timing is a
pre-retrieval eligibility failure. A duration shorter than `R` milliseconds still
uses the same rational formula; empty buckets are skipped rather than rounded or
merged.

The selector repeatedly visits buckets from earliest to latest. On each pass it
takes at most one remaining Consequential-support unit from each nonempty bucket,
ordered inside the bucket by earliest occurrence and then replay-stable Material
Inventory Entry ID, until
all `R` slots are filled. If fewer candidates remain than slots, every candidate is
selected. Because the only inputs are frozen timestamps, canonical records, and
server-recomputed IDs, changing provider grouping, section labels, argument links,
or response order cannot change selection.

The server freezes the inventory hash, canonicalization and selector versions,
bucket count/boundaries, ordered candidates per bucket, selected Material
Inventory Entry IDs, and omission reasons before any source query begins.
Controversy, potential harm, external
popularity, ease of retrieval, likely source availability, evidence count,
expected Evidence Relationship, and model confidence are forbidden selector
inputs. High-risk content is governed by eligibility, never rank.

### Alternatives not recommended

- **One model relevance score:** makes materiality and omission impossible to audit
  and allows one large signal to compensate for a hard miss.
- **Provider-authored topics, sections, or argument dependencies:** semantically
  attractive but let nondeterministic grouping change which claims are checked.
- **Earliest fifteen claims:** reproducible but systematically favors the opening
  and can omit the conclusion or later counterargument.
- **Most controversial or harmful first:** imports external outcome/salience into
  a low-risk outcome-blind inventory and changes what the report purports to cover.
- **Easiest evidence first:** converts source availability into hidden materiality
  and produces the exact cherry-picking Coverage is meant to expose.

## P-04 — Evidence Coverage counts completed Findings over the full inventory

A **Material Inventory Entry** is one countable Central or Consequential-support
assertion in the frozen inventory. It is represented by either:

- one eligible Claim Unit; or
- one distinct Excluded material assertion retaining its exact occurrences,
  materiality, and bounded exclusion reason.

Every countable entry has exactly one server-recomputed Material Inventory Entry
ID. Eligible Claim Units retain P-02's exact semantic-and-material-scope
deduplication and collect every equivalent occurrence anchor. Excluded assertions
do not use embedding or inferred semantic equivalence. The server may consolidate
only records with the same exact source-language assertion bytes, material role,
and governed exclusion reason; it then collects and sorts every exact occurrence
anchor before encoding the final `excluded_assertion` variant. A different exact
assertion, material role, or governed exclusion reason remains a distinct entry.
An Assertion Group, Claim Family, Incidental assertion, or repeated occurrence
adds no denominator weight.

For one immutable Report Version:

```text
Evidence Coverage = complete valid Findings / unique Material Inventory Entry IDs
```

The numerator includes every selected Claim Unit with one complete validated
Finding, including `Unresolved`. An Excluded entry, cap-omitted eligible unit, or
technically incomplete unit is not in the numerator. The denominator is frozen
before retrieval and never changes because a source was easy, a result was
directional, or a provider failed.

The Report records exact integer numerator and denominator plus their unweighted
rate for:

- all Material Inventory Entries;
- Central entries; and
- Consequential-support entries.

It separately records eligible, selected, cap-omitted, excluded-by-reason,
technically unprocessed, and complete-Finding counts, and then breaks complete
Findings down by `Supported`, `Qualified`, `Conflicts`, and `Unresolved`.
Directional or resolution count is not Evidence Coverage. No relationship,
materiality class, evidence count, source class, or confidence value weights the
formula.

Learner-facing copy must lead with counts, for example: “8 of 10 material claims
received a complete Evidence Finding. Two were not checked; see why.” It must not
say “80% accurate,” “80% supported,” “80% complete,” or imply that an Unresolved
Finding is directional support. #390 owns layout and comprehension testing, but it
cannot rename or hide the numerator, denominator, strata, or exclusions.

## P-05 — Partial publication has a Central-claim floor

Coverage is non-compensatory. A Report Version may publish only when:

1. every Central Material Inventory Entry is an eligible Claim Unit, selected, and
   represented by one complete valid Finding;
2. every selected Claim Unit completes atomically with no malformed, rejected, or
   technically incomplete Finding; and
3. at least eight complete valid Findings exist, matching the admitted beta
   envelope.

`completed` applies only when every Material Inventory Entry has a complete valid
Finding, so numerator equals denominator. `partially_completed` applies only when
the three rules above pass and one or more Consequential-support entries are
explicitly cap-omitted or Excluded. `Unresolved` is a complete Finding and counts
toward the floor while remaining separately visible as unresolved.

An Excluded or omitted Central entry, more than 15 Central units, or a pre-retrieval
condition that makes Central Coverage unreachable produces no Report and the
governed `Not eligible` outcome. A selected-item timeout, malformed response,
validation rejection, or other technical incompletion fails the Run and publishes
no partial fragments. Completed easy Findings cannot compensate for a missing
Central claim. #388 owns the atomic terminal transition, current pointer, usage,
retry, and predecessor behavior.

This floor deliberately has no tunable weighted percentage. #389 may require
stricter measured launch gates, but it cannot authorize a partial Report that
misses a Central entry or contains an incomplete selected item.

### Alternatives not recommended

- **A single 80% floor:** permits many Incidental-like support claims to compensate
  for one omitted thesis and behaves unpredictably near the 15-claim cap.
- **Count Unresolved as uncovered:** confuses a completed evidence-grounded
  abstention with a skipped or failed check.
- **Publish whatever completed before timeout:** lets operational failure choose
  the visible claims after outcomes are partly known.
- **Call cap omissions out of scope:** hides material assertions the frozen
  inventory already found.

## P-06 — Every omission is discoverable, challengeable, and auditable

Every Material Inventory Entry remains discoverable with:

- exact Transcript wording, Timestamp Citation, and bounded context;
- normalized proposition and material elements when a faithful Claim Unit exists;
- Central or Consequential-support role;
- its replay-stable Material Inventory Entry ID; eligibility and selected status;
  and, only for an eligible entry, its Claim Unit ID, time bucket when applicable,
  and frozen selector order;
- one bounded exclusion or omission reason, such as the governed policy reason or
  `cap_omitted`; and
- the Report/input/policy versions needed to locate the immutable decision.

Unchecked and Excluded entries show no Evidence Relationship, rationale, or
confidence. Counts may be summarized first, but the exact entries and reasons must
remain discoverable; #390 may choose disclosure mechanics, not erase the record.

The full content-bearing inventory does not enter a general audit log. A bounded,
least-privilege private Run/Report input store holds the exact Transcript anchors
and context; normalized propositions and material-element records; materiality,
eligibility, decomposition, deduplication, diagnostic grouping, stable-ID inputs,
bucket assignment, ordered selection, and omission decisions; provider inputs and
validated outputs needed for review; and the content-bearing input or policy
correction that starts a successor Run. The store is scoped to the owning Learner
and exact Run or Report lineage. Only that authorized owner, the bounded service
path, and an explicitly assigned reviewer may read it; anonymous, cross-owner,
product-analytics, and ambient staff access is denied.

Every private input record carries its authority/rights basis,
`retention_policy_version`, `delete_after`, narrower Transcript/source-rights
deadline, encryption/key version, and deletion/suppression state. #386 authorizes
the exact storage/display path and #388 supplies immutable versioning, review,
retention, deletion, and tombstone lifecycle. The earliest applicable deadline
wins. Expiry or required deletion removes content rather than copying it into
audit metadata.

The append-only operational audit is content-free. It retains only opaque Run,
Report, Material Inventory Entry, Claim Unit, Intake, Case, policy, and actor-class
references; versioned keyed hashes; counts; governed reason/action enums;
timestamps; policy/schema/key versions; and success/failure state. It contains no
Transcript text or anchors, normalized propositions, material elements, provider
content, Findings, evidence,
source metadata/passages, rationales, correction prose, reviewer notes, or appeal
content. Product analytics receive a strict subset: content-free counts, reason
enums, versions, and timings.

A Learner may challenge a missing material assertion, normalization, materiality,
split/merge, stable identity, bucket assignment, selection, or omission through
#388's authorized Intake and Review Case workflow. Review cannot edit the frozen
inventory or Report. **No selector or result override exists:** an operator,
reviewer, or provider cannot move, promote, replace, drop, or insert a selected
entry, nor edit Coverage or a Finding result.

An accepted change must be a named input correction (for example, corrected
Transcript/provenance) or named policy correction (for example, a versioned
materiality, canonicalization, or eligibility rule). It creates a new frozen Run
with a new input fingerprint and/or policy version, recomputes every affected
identity and selection, and may produce a new immutable Report Version. If the
current governed policy cannot express the correction, that policy is versioned
first; reviewers never bypass it. The old Run, inventory, identities, selection,
and Report remain immutable. The private store keeps the authorized content-bearing
before/after basis under its retention rules; the append-only audit records only
content-free old/new opaque references, keyed hashes, versions, governed
correction/action enums, actor class, state, and timestamp. External submitters
receive the same private, non-confirming lifecycle #388 already defines.

The #387 gold evaluation must measure whole-Video Central and Consequential claim
recall, materiality agreement, normalization fidelity, decomposition and dedup
correctness, stable-ID replay, selector determinism/time distribution, Coverage
arithmetic, omission-reason accuracy, and silent Central omission separately.
Accuracy on the selected easy claims cannot compensate for a miss on inventory or
selection.

### Alternatives not recommended

- **Show only omission counts:** prevents a Learner or reviewer from identifying
  which thesis-supporting assertion was skipped.
- **Store only selected claims:** makes recall, ranking, and cherry-picking
  impossible to audit after retrieval.
- **Put exact claims in an append-only audit log:** defeats content minimization,
  least privilege, rights expiry, and deletion even when the product record is
  correctly removed.
- **Let an appeal edit the old inventory:** destroys the exact denominator and
  selection policy that produced the dated Report.
- **Send claim text to product analytics:** creates unnecessary sensitive-content
  collection when counts and governed reasons answer the operational question.

## Decision table

| ID | Decision | Principal trade-off |
| --- | --- | --- |
| P-01 | Freeze a whole-Transcript, outcome-blind inventory with materiality separate from eligibility | Higher preflight cost, but missing/excluded material cannot disappear |
| P-02 | Count faithful independently meaningful Claim Units; preserve groups, exact dedup, and all occurrences | More conservative exclusions and records, but no weakened or double-counted claims |
| P-03 | Select every Central claim, then round-robin Consequential claims across server-derived equal-duration time buckets with replay-stable IDs | Coarser than semantic grouping, but provider labels cannot influence which claims are checked |
| P-04 | Coverage is unweighted complete Findings—including Unresolved—over every Material Inventory Entry, with Central/Consequential breakouts | Lower headline simplicity, but no support/accuracy/confidence laundering |
| P-05 | Every Central entry and every selected unit must complete; otherwise no Report | More abstention, especially for claim-dense Videos, but no trivial claim can compensate for an omitted thesis |
| P-06 | Exact omissions live in the bounded private input/report record; append-only audit and analytics remain content-free | More access/retention engineering, but reviewability does not create an undeletable content copy |

## Validation invariants

1. The complete Transcript is inventoried before retrieval; evidence outcomes never
   add, remove, merge, reclassify, or reorder an entry.
2. Materiality and eligibility are separate. Exclusion never erases a Central or
   Consequential-support role.
3. A Claim Unit preserves every asserted material element and exact occurrence.
   Fidelity failure creates an Excluded entry, never a weakened proposition.
4. Decomposition requires explicit independently meaningful assertions and never
   counts an Assertion Group plus its children.
5. Deduplication requires semantic and scope equivalence. Similarity, repetition,
   or a model label cannot merge materially different claims.
6. The Report contains 8–15 selected Material Claim Units. Fewer than eight is Not
   eligible, never padding; the 15 cap never limits inventory or denominator.
7. Every Central unit ranks first. Remaining selection uses only server-validated
   timestamps and replay-stable IDs through the fixed bucket algorithm; provider
   grouping, source ease, and expected relationship cannot affect it.
8. Every eligible Claim Unit and every distinct Excluded material assertion counts
   once in Coverage; groups, families, and occurrences do not.
9. Only a complete valid Finding enters the Coverage numerator. `Unresolved`
   counts as covered but not directionally resolved.
10. Coverage is unweighted and always exposes exact numerator, denominator,
    Central/Consequential strata, exclusions, omissions, and relationship counts.
11. Every Central entry and every selected unit must complete before publication.
    No percentage, consequential count, or easy Finding compensates for a Central
    miss or technical failure.
12. A Report with all entries covered is `completed`; a valid Report with only
    explicit Consequential exclusions/omissions is `partially_completed`.
13. Every omitted/excluded entry is discoverable with its exact Transcript anchor
    and reason but no fabricated Evidence Relationship.
14. Content-bearing inventory, anchors, selector provenance, and correction basis
    live only in the bounded least-privilege private input/Report record and obey
    the earliest rights/retention/deletion deadline.
15. Append-only audit and product analytics are content-free: only opaque
    references, keyed hashes, counts, enums, versions, actions, states, and timings.
    A named input or policy correction creates a new frozen Run and policy/input
    lineage; it never mutates or overrides selection or results in place.
16. Every countable entry has one server-recomputed Material Inventory Entry ID.
    Only the `eligible_claim_unit` variant has a Claim Unit ID; an
    `excluded_assertion` variant is canonically identified by its exact assertion,
    role, governed reason, and sorted exact anchors.
17. No selector or result override exists. Authorized review can only accept a
    named input or policy correction that creates a successor frozen Run.

## Stress cases

| Scenario | Required result |
| --- | --- |
| A Video repeats the same central quantity five times in different words. | One Central Claim Unit with five timed occurrences; one denominator entry and at most one Finding. |
| Two statements differ only by 2023 versus 2024. | Two Claim Units; time is material and semantic similarity cannot merge them. |
| “A increased and B decreased” explicitly asserts two independently meaningful facts. | Two Claim Units in one Assertion Group when attribution and scope remain intact; the group does not count. |
| “A increased because B decreased.” | Preserve one causal Claim Unit unless the Video explicitly asserts an independently meaningful component elsewhere. |
| A 20-claim inventory contains 12 Central and 8 Consequential units. | Select all 12 Central, derive three equal-duration time buckets, and round-robin three Consequential units; retain five cap omissions. A valid result is partial with Coverage at most 15/20. |
| A Video contains 16 Central units. | `Not eligible / exceeds_beta_central_claim_cap`; no paid retrieval and no Report. The system cannot choose a favorable 15. |
| A short Video contains five eligible Material Claim Units and six Incidental truths. | `Not eligible / insufficient_material_claims`; do not promote three Incidental truths to reach eight. |
| The same frozen inventory is replayed after provider response order changes. | The server recomputes identical Claim Unit IDs, Material Inventory Entry IDs, bucket assignments, ordered selection, and denominator. |
| A provider assigns every Consequential unit to one family on one replay and ten families/sections on another. | Selection is identical; provider grouping, section, and dependency labels are selector-inert. |
| Two occurrence starts fall immediately before and exactly on an internal bucket boundary. | The first stays in the earlier half-open bucket; the exact-boundary anchor enters the later bucket. |
| A 3 ms Transcript produces seven remaining slots. | Use exact rational/integer bucket arithmetic, skip empty buckets, and select deterministically; never round or merge boundaries. |
| The frozen Transcript has zero duration or an inverted/out-of-range occurrence span. | Not eligible for unreliable timing before selection or paid retrieval; no divide-by-zero fallback. |
| A provider supplies its own stable ID for a claim or omits one occurrence anchor. | The server recomputation mismatches and rejects the candidate; provider IDs cannot steer tie-breaks. |
| One Excluded chart assertion is replayed with the same governed reason and exact anchors, then with a different reason or anchor. | The identical canonical `excluded_assertion` record keeps one Material Inventory Entry ID; the changed reason or anchor produces a distinct entry ID. Neither variant receives a Claim Unit ID. |
| One Central assertion depends on a chart and is Excluded, while ten easy Consequential units are eligible. | No Report because Central Coverage is unreachable; ten easy checks cannot compensate. |
| Every Central unit completes, while two Consequential units are cap-omitted. | A `partially_completed` Report may publish with the exact omissions and Coverage counts. |
| All selected Findings are Unresolved after complete evidence processing. | They count as covered; relationship counts show zero directional Findings. Coverage never claims support or accuracy. |
| Fourteen Findings complete before the fifteenth provider response fails validation. | Run failure and no Report; completion timing cannot select the visible subset. |
| Retrieval predicts that a lower-ranked claim will be easy to support. | Frozen rank and selection do not change. |
| A provider marks two quantity claims as duplicates despite different units. | Reject the merge; each remains a separate Claim Unit and denominator entry. |
| A Learner identifies an omitted Central assertion after publication. | Open the authorized #388 review path; do not edit history. An accepted change produces a new inventory, Run, and Report Version. |
| A reviewer asks to move, promote, or replace a selected claim because another result looks preferable. | Reject the request: no selector or result override exists. Only a named input or policy correction may create a successor frozen Run whose server selector recomputes the outcome. |
| Product analytics request the top omitted claim text. | Decline; emit only the content-free omission count and governed reason enum. |
| An auditor needs to prove how a corrected Run superseded an earlier Run after private input expiry. | The content-free audit proves the old/new opaque references, governed correction enum, keyed-hash/version/state/timestamp chain without retaining the claim, anchor, provider output, or reviewer prose. |

## Cross-issue dependencies

| Owner | Contract consumed or still required |
| --- | --- |
| #381 — beta decision map | Must incorporate the complete inventory, Claim Unit, Coverage formula, Central floor, omissions, and audit without changing Summary/Chat grounding |
| #382 — Finding semantics | Supplies the four Evidence Relationships and complete-Finding contract; consumes faithful Claim Units and treats exclusions, Unresolved, and failure distinctly |
| #383 — eligibility | Supplies Video/claim exclusions and no-charge Not eligible behavior; consumes the Central-cap/floor reasons without turning exclusion into a weak Finding |
| #384 — source policy | Evaluates only frozen selected Claim Units; source availability and evidence outcomes cannot alter inventory, rank, or denominator |
| #386 — compliance | Must approve Transcript/source processing, learner wording, analytics fields, retention, review operations, and launch jurisdictions |
| #387 — evaluation | Must independently measure whole-Video recall, normalization, stable-ID replay, bucket-boundary selection, Coverage, omissions, and silent Central misses; public benchmarks do not replace the human gold set |
| #388 — lifecycle | Publishes complete/partial Reports atomically only after this floor; owns retries, immutable history, Intake/Case, corrections, current pointer, and notifications |
| #389 — launch gates | Supplies the merged immutable Gate Packet grammar and exact beta/expansion material-claim recall, normalization, Coverage, integrity, and hold rules; those measured gates remain additional to this Central floor |
| #390 — interaction prototype | Owns layout and comprehension while keeping exact Coverage, omissions, reasons, relationships, and limitations discoverable and accessible |

## Launch-blocking presentation and authority choices

The merged #382 semantics and #389 Gate Packet operating points are consumed as
fixed dependencies, not reopened here. This proposal intentionally leaves only:

- the #390 screen order, disclosure interaction, accessible wording, or validated
  Learner comprehension threshold; or
- the #386 counsel/platform approvals for Transcript processing, content display,
  analytics, review access, retention, deletion, and launch jurisdictions.

Missing approval keeps Learner exposure disabled. None of these owners may redefine
Coverage as accuracy, weight away a Central miss, or let evidence outcomes rewrite
the frozen inventory.

## Evidence behind the proposal

- The [#381 beta map](https://github.com/xtan9/youtubeai_chat_frontend/issues/381)
  establishes the 8–15 material-claim envelope, separate Evidence
  tab, low-risk scope, and no aggregate Video score.
- The [#387 evaluation research](https://github.com/xtan9/youtubeai_chat_frontend/blob/15209cf2e4d0737f1d097c3224ab6fa0abc6112d/docs/research/2026-08-10-evidence-check-evaluation-calibration.md)
  requires whole-Video sampling because preselected claims cannot measure Central
  omission. It distinguishes Central, Consequential-support, and Incidental claims
  and keeps unweighted counts visible.
- The [#383 eligibility resolution](https://github.com/xtan9/youtubeai_chat_frontend/issues/383)
  requires excluded high-risk or visually dependent material to remain explicit
  and delegates the partial-publication floor to this decision.
- The [#386 policy research](https://github.com/xtan9/youtubeai_chat_frontend/blob/db5a2be6c57b0771c2cc67f9dee383556a318c07/docs/research/2026-08-10-evidence-check-policy-legal-constraints.md)
  permits describing only selected Transcript-verifiable claims, never all Video
  claims, and warns that easiest-resolved-only accuracy cannot describe a Video.
- The [#384 source policy](./2026-08-11-evidence-source-policy-proposal.md)
  requires complete material-element coverage and symmetric contrary retrieval
  only after the outcome-blind claim inventory and selector are frozen.
- The [#389 rollout gates](./2026-08-11-evidence-check-rollout-gates-proposal.md)
  supply the exact immutable Gate Packet measurement grammar and beta/expansion
  material-claim recall, normalization, Coverage, and hard-integrity operating
  points consumed by this proposal.
