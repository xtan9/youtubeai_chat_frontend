# Evidence Finding semantics proposal

**Decision ticket:** [#382](https://github.com/xtan9/youtubeai_chat_frontend/issues/382)

**Parent map:** [#381](https://github.com/xtan9/youtubeai_chat_frontend/issues/381)

**Status:** Owner-reviewed provisional decision; implementation and Learner exposure remain blocked by the dependencies and launch clearances below

## Settled boundaries inherited by this proposal

- An Evidence Check assesses selected, material, checkable claims from one Video. It does not rate the Video, speaker, author, creator, or channel.
- Evidence Eligibility and Evidence Coverage remain separate from an individual Evidence Finding.
- `Not eligible` declines a report, an excluded claim remains visible through Evidence Coverage, and `Unresolved` is a claim-level abstention.
- A numeric Video or author score is outside the beta.
- Source sufficiency rules remain owned by #384; lifecycle, freshness, and correction rules remain owned by #388.

## P-01 — Evidence Relationship, not truth verdict

The learner-facing result of an Evidence Finding is an **Evidence Relationship** between one normalized claim and the admissible evidence retrieved for that claim as of a stated date.

The vocabulary has exactly four outcomes:

- **Supported by retrieved evidence** — admissible evidence materially supports the claim as normalized for the relevant time and jurisdiction.
- **Qualified by retrieved evidence** — admissible evidence supports every material element the claim asserts and adds a non-contradictory material boundary or context condition that changes how the claim should be understood.
- **Conflicts with retrieved evidence** — admissible evidence materially contradicts at least one material element the claim asserts, including its entity, quantity, unit, quantifier, polarity, modality, conjunction, geography, or time. Absence of support alone never earns this outcome.
- **Unresolved** — the system abstains because it cannot responsibly issue one of the three directional relationships.

Every directional statement is evidence-relative and dated: “The sources retrieved as of [date] support / qualify / conflict with this claim.” The product must not restate a relationship as `true`, `false`, `right`, `wrong`, `misinformation`, or as a judgment of a person's knowledge, intent, honesty, legitimacy, bias, or trustworthiness.

`Not eligible`, a policy exclusion, and a non-checkable or visually dependent claim are not Evidence Relationships. They remain explicit in Evidence Coverage and produce no Finding. Mutually conflicting evidence that cannot be adjudicated, or a failure to retrieve enough admissible evidence, produces `Unresolved`, never a weak directional relationship.

### Alternatives not recommended

- **True / Mostly true / Mixed / False:** familiar but implies objective or person-level truth, blurs missing evidence with contradiction, and encourages false precision.
- **Supported / Mostly supported / Mixed / Contradicted / Unresolved:** makes neighboring categories hard to apply consistently. `Qualified` more directly communicates that a material condition changes the claim.
- **One combined result that encodes relationship, sufficiency, and confidence:** hides why the system abstained and makes calibration or source-policy changes alter the learner vocabulary.

### Canonical glossary entry

**Evidence Relationship**:
The evidence-relative result of one Evidence Finding: Supported, Qualified, Conflicts, or Unresolved. It describes what the admissible evidence retrieved as of a stated date establishes about one claim, not whether a Video or person is truthful or trustworthy.
_Avoid_: Verdict, truth label, factuality rating

## P-02 — Evidence sufficiency is a governed prerequisite

Evidence sufficiency has two states:

- **Sufficient for a directional Finding** — the complete evidence bundle meets the versioned #384 source policy for one of `Supported`, `Qualified`, or `Conflicts`.
- **Insufficient to resolve** — the bundle does not meet that policy, so the Evidence Relationship is `Unresolved` and a bounded reason explains why.

Sufficiency is not a learner-visible low/medium/high scale. There is no `partial` sufficiency state: partial evidence that cannot establish a directional relationship is insufficient, while a `Qualified` relationship requires sufficient evidence for the exact material qualification displayed. Lack of support never becomes `Conflicts`.

`Qualified` cannot repair a contradicted proposition. If admissible evidence contradicts any material asserted element, the relationship is `Conflicts` even when other asserted elements are supported. If evidence supports only some elements and neither supports nor contradicts the rest, the bundle is insufficient and the relationship is `Unresolved`. Decomposition may create separate Findings only when #385 determines that each resulting claim remains faithful and independently meaningful.

The Finding records the source-policy version that made the sufficiency decision. #384 still owns the evidence thresholds, authority, independence, temporal and jurisdictional fit, conflict handling, and source-display rules.

## P-03 — Confidence is unavailable until calibrated

The beta does not display a confidence number or high/medium/low badge until a Video-first product gold set has calibrated the complete pipeline and #389 has approved an operating point.

The beta provider contract has no confidence or certainty output. Any provider-authored confidence/certainty field, percentage, band, self-assessment, or prose is a validation rejection and produces no Finding. The only beta value is the exact server-owned `confidence: unavailable`; rendering cannot derive or copy confidence from model text, evidence count, or source labels.

If confidence is later authorized, it means only:

> The estimated probability that an independent trained reviewer, applying the same versioned rubric to the complete claim, evidence, and relationship record, would accept the Finding.

It is not the probability that the claim is true, source quality, Evidence Coverage, evidence sufficiency, or model self-certainty. A future confidence value must identify the calibration population and the complete pipeline/rubric version. Until then its status is `unavailable`; sufficiency, evidence, limitations, and Coverage remain visible without it.

### Alternatives not recommended

- **LLM-reported confidence:** uncalibrated self-certainty is not an empirical error estimate.
- **High / medium / low inferred from evidence count or source tier:** source quantity and reputation do not measure end-to-end Finding correctness.
- **Show a provisional number with a beta disclaimer:** polished precision invites reliance before the product can establish what the number predicts.

## P-04 — Every Finding is an auditable record

Every resolved or Unresolved Finding contains the following conceptual fields. Exact storage and rendering are later implementation decisions.

| Element | Required meaning |
| --- | --- |
| Original claim context | The exact minimal Transcript wording plus enough adjacent context to preserve meaning, bound to the Video, Transcript version, and Timestamp Citation. Speaker attribution appears only when reliable. |
| Normalized claim | One faithful, context-complete proposition that preserves every material asserted element, including entity, quantity, unit, quantifier, polarity, modality, conjunction, qualification, geography, and relevant time. |
| Evidence Relationship | Exactly one of `Supported`, `Qualified`, `Conflicts`, or `Unresolved`, rendered with controlled evidence-relative copy and an as-of date. |
| Evidence-bound rationale | A concise explanation of why the governed evidence warrants the relationship. Every external factual assertion refers to server-issued evidence-item identifiers; generated prose cannot introduce evidence. |
| Evidence considered | The material supporting, qualifying, and contrary evidence considered under #384. An empty stance remains explicit rather than disappearing from the record. |
| Temporal and jurisdictional scope | Claim time, relevant valid time or period, evidence publication time, retrieval cutoff, and jurisdiction when they affect meaning. Unknown or inapplicable values are distinguished. |
| Sufficiency | `sufficient_for_directional_finding` or `insufficient_to_resolve`, together with the source-policy version and a bounded reason when unresolved. |
| Limitations | Material Transcript, attribution, source, independence, temporal, jurisdictional, or scope limitations that remain after validation. |
| Confidence | The exact server-owned value `unavailable` in the beta. Provider output has no confidence/certainty field or prose. A later server-computed calibrated value must carry its calibration population and complete rubric/pipeline version. |
| Provenance | Finding-rubric, normalization, retriever, source-policy, model, and prompt versions needed to reproduce and review the decision. |

This table is a publication contract, not a prescribed screen order. #390 owns whether the interface is evidence-first or label-first and must prove Learner comprehension. #384 owns source admissibility, passages, rights, independence, temporal fit, and display. A directional output missing any governed element fails validation and produces no Finding; the application must not repair it with uncited model prose or a weaker label.

## P-05 — Exclusion, abstention, and failure are different outcomes

### Excluded claim — Coverage only, no Finding

A claim is excluded when no stable eligible claim exists under the current policy. Examples include opinion or normative judgment, a prediction that cannot yet be resolved, visual dependency, a high-risk or policy exclusion, unreliable Transcript or speaker attribution, and normalization that cannot preserve the original meaning. The exclusion and bounded reason remain visible in Evidence Coverage.

### Unresolved — completed Finding with abstention

`Unresolved` applies only after a stable eligible claim was checked and the completed evidence process could not responsibly issue a directional relationship. Its initial bounded reasons are:

- `insufficient_admissible_evidence`;
- `conflicting_evidence`;
- `temporal_scope_indeterminate`;
- `jurisdiction_indeterminate`; and
- `below_calibrated_operating_threshold`, reserved for a later calibrated system.

The reason list is versioned. `low_confidence`, `probably_false`, and generic `unsupported` are forbidden because they conflate different states or imply a truth judgment. Source absence or inaccessible evidence is never itself contradiction.

### Run failure — technical incompletion, no Finding

Dependency outage, timeout, cancellation, malformed provider output, validation rejection, and other incomplete runs produce no Finding. They never become `Unresolved`, because technical uncertainty is not evidence uncertainty. Retryability, charging, partial-report behavior, and durable lifecycle are separate fields owned by #388.

## Decision table

| ID | Provisional decision | Main trade-off | Rejected alternative |
| --- | --- | --- | --- |
| P-01 | Four evidence-relative relationships: Supported, Qualified, Conflicts, Unresolved | Less familiar than true/false, but does not claim objective or author-level truth | Truth labels or a longer mostly/mixed continuum |
| P-02 | Binary governed sufficiency prerequisite | Deliberately conservative; may abstain on useful but incomplete research | Learner-visible partial/low-medium-high sufficiency |
| P-03 | Confidence hidden until product calibration | Withholds a familiar cue, but prevents false precision and self-certainty laundering | Model-reported or heuristic confidence badges |
| P-04 | Complete auditable Finding record | Higher retrieval, validation, and presentation cost | Label plus free-form explanation |
| P-05 | Excluded, Unresolved, and failed are distinct | More states to explain, but none can silently impersonate a judgment about the claim | One catch-all unknown/low-confidence result |

## Validation invariants

1. `Supported`, `Qualified`, or `Conflicts` requires `sufficient_for_directional_finding`; `Unresolved` requires `insufficient_to_resolve` and one governed reason.
2. A claim excluded by eligibility, fidelity, or policy creates no Finding and remains countable in Evidence Coverage.
3. A technically incomplete or rejected run creates no Finding and cannot emit or persist a partial relationship or rationale.
4. Lack of supporting evidence cannot become `Conflicts`; irreconcilable supporting and contrary evidence becomes `Unresolved` unless #384 defines a sufficient, reproducible adjudication rule.
5. `Qualified` requires sufficient evidence supporting every material asserted element plus a non-contradictory material boundary or context condition. It is not a softer substitute for contradiction, partial support, or low sufficiency.
6. Evidence contradicting any material asserted element requires `Conflicts`, even when other elements are supported. Evidence that supports only some elements and leaves the rest unestablished requires `Unresolved` unless faithful decomposition produces separate Claim Units under #385.
7. Original context and normalization must preserve entity, quantity, unit, quantifier, polarity, modality, conjunctions, qualifiers, geography, time, and reliable attribution. A fidelity failure excludes the claim rather than weakening the relationship.
8. Rationale assertions and evidence displays reference only governed evidence items issued by the server. Unknown, cross-claim, duplicated, or uncited evidence fails validation.
9. The controlled relationship copy always names retrieved evidence and its as-of date. Provider-authored truth, intent, character, or author/channel judgments fail validation.
10. Any provider-authored confidence or certainty field, percentage, band, self-assessment, or prose fails validation and produces no Finding. Beta rendering uses only server-owned `confidence: unavailable`.
11. Missing required record elements fail closed. A validator must not invent defaults that convert an invalid output into a published Finding.

## Stress cases

| Scenario | Required outcome |
| --- | --- |
| The core proposition holds, but the Video omitted a material geographic exception established by sufficient evidence. | `Qualified`, with the exception stated and cited. |
| The Video claims a total of 50 and sufficient evidence establishes 48. | `Conflicts`; the asserted quantity is a material element, not a qualification. |
| The Video claims 50% and sufficient evidence establishes 20%. | `Conflicts`; the materially different proportion cannot be softened to Qualified. |
| The Video asserts A and B; sufficient evidence supports A but contradicts B. | `Conflicts`; contradiction of either material conjunct conflicts with the asserted conjunction. |
| The Video asserts A and B; sufficient evidence supports A but admissible evidence cannot establish B either way. | `Unresolved` for the conjunction unless #385 permits faithful, independently meaningful decomposition into separate Findings. |
| The Video says “all,” while evidence only establishes “some” and supplies no counterexample. | `Unresolved`; weaker support does not prove the quantifier and does not by itself contradict it. |
| Search finds no admissible evidence either way. | `Unresolved / insufficient_admissible_evidence`, not Conflicts. |
| Two admissible evidence sets materially disagree and the source policy supplies no principled discriminator. | `Unresolved / conflicting_evidence`; preserve both sides. |
| A later primary record shows the claim was accurate when spoken but no longer current. | The relationship is scoped to claim time and the current-status limitation is explicit; exact temporal policy remains with #384/#388. |
| The Transcript drops a negation or cannot identify which speaker made the statement. | Excluded in Coverage; no stable claim and no Finding. |
| The claim depends on a chart not represented in the Transcript. | Excluded in Coverage under the settled visual-dependency rule. |
| The evidence provider times out after retrieval begins. | Run failure, no Finding; retry and charging remain #388 decisions. |
| A model emits a polished label and explanation but cites an unknown evidence identifier. | Validation failure, no Finding. |
| A model emits a `confidence` field, “95% confident,” “high confidence,” or other certainty prose. | Validation rejection and no Finding; only the server may render `confidence: unavailable`. |

## Cross-issue dependencies and open human choices

| Owner | Choice still open | Constraint supplied by this proposal |
| --- | --- | --- |
| #384 — trustworthy evidence and citation policy | Exact admissibility, authority, independence, sufficiency thresholds, temporal/jurisdictional fit, contrary-evidence search, inaccessible/changing sources, passages, rights, and display | Must deterministically return sufficient or insufficient for the exact claim and may not equate absence with conflict. |
| #385 — material claims and Evidence Coverage | Selection, normalization workflow, importance, cap, omitted/excluded accounting, and partial-report coverage floor | Excluded claims produce no Finding; normalization fidelity is a prerequisite; all exclusions and unresolved claims remain countable. |
| #388 — lifecycle and corrections | Run/report states, retry, charging, partial publication, freshness, expiry, recheck, immutable history, correction, appeal, and notification | Technical incompletion produces no Finding; lifecycle cannot silently rewrite a published relationship or collapse failure into Unresolved. |
| #389 — launch gates | Calibration population, operating point, risk/coverage bounds, confidence authorization, correction and stop thresholds | Confidence remains unavailable until approved; directional Findings must pass independent non-compensatory gates. |
| #390 — interaction prototype | Evidence-first versus relationship-first order, progressive disclosure, color/icon use, mobile/accessibility, and comprehension proof | All required record elements must remain discoverable; presentation cannot turn relationship into truth or hide Coverage, abstention, dates, or limitations. |
| #386 clearance owners | Counsel- and YouTube-approved final wording, disclosure, source use, correction operations, launch jurisdictions | The proposal is conservative product semantics, not legal clearance; public exposure remains blocked. |

The owner has provisionally accepted these decisions. Before implementation, #384/#385/#388 must settle their delegated contracts and the #381 decision map must incorporate the reviewed result. If comprehension testing shows that Learners still read Evidence Relationships as author truth judgments, the presentation or vocabulary must change before launch even if the machine contract is internally consistent.

## Evidence behind the proposal

- The #383 resolution makes `Unresolved` an abstention and keeps exclusions visible rather than converting them into weak findings.
- The #386 policy research recommends evidence-relative `support / qualify / conflict / cannot resolve` wording and rejects truth, intent, and author-level framing.
- The #387 evaluation research treats confidence as calibrated end-to-end correctness under a human rubric, not model certainty or truth probability, and requires risk to be reported beside coverage.
- The initial feature research warns that a single score or truth-like label can conceal low coverage, weak retrieval, stale sources, and Transcript errors.
