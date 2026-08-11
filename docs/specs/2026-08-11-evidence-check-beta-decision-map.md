# Evidence Check beta decision map

**Canonical map:** [#381](https://github.com/xtan9/youtubeai_chat_frontend/issues/381)

**Validated:** 2026-08-11 against GitHub issue state and the cited immutable commits

**Status:** All named product-decision dependencies are settled. Implementation is ready for rights-cleared internal evaluation scaffolding only; a Learner beta remains blocked by the launch constraints below.

## How to read this map

This document separates decisions from research recommendations. An owner-approved issue resolution is **Settled**. An unanswered decision ticket is **Open** even when research suggests an answer. A **Dependency** must settle before dependent design or implementation can be approved. A **Launch blocker** prevents exposure to Learners but may permit rights-cleared internal evaluation. **Out of scope** means the beta must not imply or implement the capability.

### Method note

The requested `wayfinder` skill was unavailable in this session. This map therefore uses a transparent fallback: an authoritative GitHub issue-state and resolution audit, immutable commit and link validation, `grilling` stress cases, `domain-modeling` vocabulary work, and a manually maintained dependency map. This evidence-synthesis process is not an invocation or equivalent reproduction of the unavailable Wayfinder tooling.

Research is evidence for a decision, not a decision by itself. If this map conflicts with a later owner-approved resolution, the resolution wins and this map must be revised before implementation continues.

## Destination and product boundary

The Evidence Check beta is an opt-in, asynchronous assessment of 8–15 selected Material Claim Units from one Video. The whole-Transcript Material Claim Inventory is never capped, padded, or rewritten by evidence outcomes; D-12 fixes the deterministic selection and non-compensatory Evidence Coverage floor. The check follows a successful Summary and appears in a separate Evidence tab. Each Evidence Finding starts from exact Transcript wording and a Timestamp Citation, then presents external evidence and explicit limitations. Evidence Coverage makes every omission, exclusion, and Unresolved Finding visible.

The feature does not alter either existing grounding boundary:

- a Summary remains a faithful account of its Transcript;
- Video Chat continues to treat its Transcript and Summary as its only source of truth; and
- external evidence exists only inside the Evidence Check domain.

The first Learner beta is feature-flagged, authenticated, and available across plan types only after every public-launch blocker clears. The flag must default off and must not make an ineligible or legally blocked run reachable.

## Decision ledger

| ID | State | Decision or question | Implementation consequence | Provenance |
| --- | --- | --- | --- | --- |
| D-01 | Settled | The product is a claim-level evidence ledger, not a Video, author, speaker, or channel trust score. No numeric aggregate ships in the beta. | Names, copy, storage, analytics, and exports must remain claim-scoped. | [#381](https://github.com/xtan9/youtubeai_chat_frontend/issues/381), [#386 resolution](https://github.com/xtan9/youtubeai_chat_frontend/issues/386#issuecomment-5248148485), [#387 resolution](https://github.com/xtan9/youtubeai_chat_frontend/issues/387#issuecomment-5248148560) |
| D-02 | Settled | Entry is opt-in after Summary; processing is asynchronous in a separate Evidence tab; the beta targets authenticated Learners across plan types. | Do not fold external retrieval into Summary or Chat. A durable run must survive navigation and reload. | [#381](https://github.com/xtan9/youtubeai_chat_frontend/issues/381) |
| D-03 | Settled | Eligibility requires a coherent, reliably timed English Transcript, a low-risk source-rich factual topic, likely meaningful coverage, and claims represented in the Transcript. | A versioned, deterministic preflight must run before usage is charged or external analysis begins. | [#383 resolution](https://github.com/xtan9/youtubeai_chat_frontend/issues/383#issuecomment-5248542508) |
| D-04 | Settled | Missing/degraded/mistranslated or predominantly non-English Transcripts; satire, fiction, pure opinion; high-risk domains; and predominantly visual claims are ineligible. Mixed Videos may publish only when eligible claims meet D-12's Coverage floor. | Preflight reasons are bounded and user-readable. Visually dependent and high-risk claims are exclusions, never weak findings. | [#383 resolution](https://github.com/xtan9/youtubeai_chat_frontend/issues/383#issuecomment-5248542508) |
| D-05 | Settled | `Not eligible` declines a report, `Partially completed` publishes a valid report with named omissions, and `Unresolved` is a completed claim-level Finding when governed evidence is insufficient to resolve the claim. `Not eligible` consumes no usage and has no Retry transition; a changed named dependency may permit a new request. | Report outcome, claim relationship, technical failure, permanence, retryability, and charging remain distinct. None can be converted into a confidence or truth score. | [#383 resolution](https://github.com/xtan9/youtubeai_chat_frontend/issues/383#issuecomment-5248542508), [#382 contract](https://github.com/xtan9/youtubeai_chat_frontend/blob/21ef9eddf8de5815890114e5284a354e49f8e79c/docs/specs/2026-08-11-evidence-finding-semantics-proposal.md), [#388 contract](https://github.com/xtan9/youtubeai_chat_frontend/blob/1d7f4623c30c1a675503eed23a8fe03f5eb54ae8/docs/specs/2026-08-11-evidence-check-lifecycle-proposal.md) |
| D-06 | Settled | Public launch authority is a Video-first human gold set with separate stage, risk, coverage, temporal, adversarial, and comprehension gates. Public benchmarks are regression suites, not certification. | Evaluation stores Video clustering and stage-level results; no compensatory aggregate can hide a blocking failure. | [#387 resolution](https://github.com/xtan9/youtubeai_chat_frontend/issues/387#issuecomment-5248148560), [evaluation research](https://github.com/xtan9/youtubeai_chat_frontend/blob/15209cf2e4d0737f1d097c3224ab6fa0abc6112d/docs/research/2026-08-10-evidence-check-evaluation-calibration.md) |
| D-07 | Settled | Rights-cleared internal evaluation may proceed. A Learner beta may not launch until lawful Transcript sourcing, written YouTube approval, and counsel clearance are all documented. | Production access remains disabled independently of code completeness or evaluation success. | [#386 resolution](https://github.com/xtan9/youtubeai_chat_frontend/issues/386#issuecomment-5248148485), [policy research](https://github.com/xtan9/youtubeai_chat_frontend/blob/db5a2be6c57b0771c2cc67f9dee383556a318c07/docs/research/2026-08-10-evidence-check-policy-legal-constraints.md) |
| D-08 | Settled | A complete Evidence Finding uses one evidence-relative relationship: `Supported`, `Qualified`, `Conflicts`, or `Unresolved`. Directional Findings require governed sufficiency; `Unresolved` requires a governed insufficiency reason. Confidence is server-owned `unavailable`; excluded claims and technical failures create no Finding. | The schema and validator must preserve exact claim context, governed evidence IDs and citations, as-of date, limitations, provenance, and the exclusion/Unresolved/failure boundary. Provider-authored certainty, truth, intent, or person/channel judgments fail validation. | [#382](https://github.com/xtan9/youtubeai_chat_frontend/issues/382), [merged #382 contract](https://github.com/xtan9/youtubeai_chat_frontend/blob/21ef9eddf8de5815890114e5284a354e49f8e79c/docs/specs/2026-08-11-evidence-finding-semantics-proposal.md) |
| D-09 | Settled | One mutable Evidence Check Run with frozen inputs reaches one terminal outcome; only a completely validated `completed` or `partially_completed` Run atomically publishes an immutable Evidence Report Version. Freshness, version role, and report-only availability are separate. Rechecks never edit history; corrections publish a new version; external Intake is non-confirming; audit is content-free; retention is bounded and fail-closed. | Persistence must enforce one active Run per lineage plus one coalesced successor, a nullable non-fallback current pointer, append-only workflow facts, idempotent accounting/notifications/deletion, and least-privilege Intake/Case content. D-10 fixes the beta retry bound; #386/counsel still own exact retention and jurisdictional authority. | [#388](https://github.com/xtan9/youtubeai_chat_frontend/issues/388), [merged #388 contract](https://github.com/xtan9/youtubeai_chat_frontend/blob/1d7f4623c30c1a675503eed23a8fe03f5eb54ae8/docs/specs/2026-08-11-evidence-check-lifecycle-proposal.md) |
| D-10 | Settled | Every rollout, containment, entitlement, experiment, pivot, or stop action is governed by an immutable action-specific Evidence Gate Packet with a universal authority/privacy/provenance/containment/budget veto core plus every causally applicable quality, comprehension, operations, cost, return, correction, and capacity family. Passing makes an action eligible only for authorized human review; deterministic safety breaches may pause exposure, but measurements never promote automatically. | Implement the versioned measurement grammar, predeclared beta/expansion thresholds and slices, complete-window denominators, controlled-pause triggers, hard spend and critical-event invariants, prospective return cohorts, and correction capacity exactly as governed. A qualifying post-billable platform failure receives at most one single-consumption Retry authorization, and a Retry Run cannot create another. Missing, stale, underpowered, or inapplicable-without-proof evidence yields `hold`. | [#389](https://github.com/xtan9/youtubeai_chat_frontend/issues/389), [merged #389 contract](https://github.com/xtan9/youtubeai_chat_frontend/blob/5493aa7cedd6a6c30dfeabb7e1f3929d2394c59e/docs/specs/2026-08-11-evidence-check-rollout-gates-proposal.md) |
| D-11 | Settled | Evidence consists of exact, versioned Evidence Items grouped by underlying Evidence Origin Groups, never reputable-looking links or publisher scores. A directional Finding normally requires complete material-element coverage from two independent origins including competent/direct evidence, symmetric support/qualification/contrary retrieval, and no unresolved material conflict; only predeclared narrow authority routes may use one origin. Time, jurisdiction, rights, source state, and assertion-adjacent citation completeness are non-compensatory. Unresolved conflicts abstain. | Implement server-owned admissibility, origin grouping, source-state identity, frozen retrieval completion, principled conflict discriminators, exact-passage citations, rights/access ledgers, and bounded source-change signals. Provider output cannot choose authority, create exceptions, translate cited evidence silently, or trade source count against a failed dimension. Evidence history is immutable; change, unavailability, correction, or rights expiry drives D-09 lifecycle transitions rather than silent substitution. | [#384](https://github.com/xtan9/youtubeai_chat_frontend/issues/384), [merged #384 contract](https://github.com/xtan9/youtubeai_chat_frontend/blob/e7e4cd6903144b896dd7c3543c1b7e446d3618bb/docs/specs/2026-08-11-evidence-source-policy-proposal.md), [primary-source research](https://github.com/xtan9/youtubeai_chat_frontend/blob/e7e4cd6903144b896dd7c3543c1b7e446d3618bb/docs/research/2026-08-11-evidence-source-policy.md) |
| D-12 | Settled | Before retrieval, the server freezes a whole-Transcript, outcome-blind Material Claim Inventory. Faithful eligible Claim Units and distinct Excluded assertions each receive a replay-stable Material Inventory Entry ID. The beta selects 8–15 eligible Material Claim Units without padding: every Central unit first, then Consequential-support units through the fixed equal-duration time-bucket selector; fewer than eight eligible units or more than fifteen Central units is `Not eligible`. Evidence Coverage is the unweighted count of complete valid Findings, including `Unresolved`, over every unique Material Inventory Entry ID. Every Central entry and every selected unit must complete; exclusions and cap omissions remain exact and visible. | Server-recompute identities, inventory, materiality, selector inputs/order, numerator, denominator, strata, and omission reasons before retrieval. Provider groupings, source ease, expected result, and manual overrides are inert. Content-bearing inventory/correction detail remains in the bounded private store; audit and analytics retain only opaque references, keyed hashes, counts, enums, versions, states, and timings. A correction is a named input or policy change that creates a successor frozen Run; it never edits or overrides a prior selection, Finding, Coverage value, or Report. | [#385](https://github.com/xtan9/youtubeai_chat_frontend/issues/385), [merged #385 contract](https://github.com/xtan9/youtubeai_chat_frontend/blob/c0722b402bfdda4cd3fa3942b258aa8ef7a93ac7/docs/specs/2026-08-11-material-claims-and-evidence-coverage-proposal.md) |
| D-13 | Settled | Evidence Check is an opt-in peer Evidence tab. The Claim desk is the provisional beta-study direction because it keeps Coverage and the claim-to-evidence path persistently discoverable; its long mobile rail must become a compact disclosure or jump control. The Coverage ledger remains the strongest audit alternative but risks score-like relationship scanning, while the Guided dossier reduces mobile cognitive load but hides cross-claim patterns. | Show durable bounded async stages without percentage or ETA; retain the prior dated report during recheck; expose full Coverage, exclusions and omissions, exact provenance and every material source; distinguish availability states and preserve history/correction; keep private notices generic until reauthorization; and meet keyboard, screen-reader, 320/390 px mobile, focus-order, and non-occlusion requirements. The seeded six-concept comprehension task is simulated protocol scaffolding, not participant or launch evidence. | [#390 decision](https://github.com/xtan9/youtubeai_chat_frontend/issues/390), [merged PR #413](https://github.com/xtan9/youtubeai_chat_frontend/pull/413), [merge `88d88df`](https://github.com/xtan9/youtubeai_chat_frontend/commit/88d88dfd102bbff45dd06575a777fc21b136f167), [immutable interaction prototype](https://github.com/xtan9/youtubeai_chat_frontend/blob/88d88dfd102bbff45dd06575a777fc21b136f167/docs/prototypes/2026-08-11-evidence-workspace-prototype.md) |

## Launch blockers

All blockers are conjunctive; passing one never compensates for another.

1. **Lawful Transcript acquisition:** every evaluation and production Transcript needs auditable acquisition method, authorization basis, rights, provider, retrieval date, and applicable terms. Production scraping or unapproved audiovisual extraction is prohibited by the settled launch decision.
2. **Written YouTube approval:** the exact data flow, derived findings, external evidence, retention, display separation, and disclosure require written compliance/audit approval.
3. **Counsel clearance:** launch jurisdictions, editorial wording, source use, privacy notice, marketing, correction/takedown operations, and risk posture require approval.
4. **Evidence and citation operation:** D-11 is settled, but launch still requires its domain authority registry, source-class acquisition/display/snapshot/retention/deletion rights, territories, retrieval budget and stopping rules, recheck/expiry policy, and provider contract to be prospectively configured, counsel/platform approved, and proven. Missing configuration is inadmissible evidence or a launch `hold`, never a provider default.
5. **Material inventory and Coverage proof:** D-12's canonical identities, deterministic selector, exact Coverage arithmetic, Central floor, omission discovery, private-content boundary, and successor-correction behavior must be implemented and pass the D-06/D-10 evaluation gates.
6. **Lifecycle operations:** D-09 fixes the lifecycle contract, but launch still requires its versioned retention schedules, deletion/vendor propagation, correction and suppression operations, staffed review boundary, and counsel-approved jurisdictional choices to be configured, healthy, and proven.
7. **Measured launch gates:** D-10 is settled, but the accepted system must produce a complete passing Evidence Gate Packet for the exact beta action, including the frozen Video-first evaluation, comprehension, operations, cost, correction, capacity, and universal-veto evidence. A passing packet permits owner review; it does not enable the flag.
8. **Usability and comprehension proof:** D-13 settles the interaction direction and executable prototype, but the exact beta UI must still pass keyboard, screen-reader, mobile, reload, failure, abstention, source-inspection, and D-10 comprehension gates. The simulated prototype task is not a human observation; the owner-approved P-04 protocol must pass with real participants before launch review.

## Dependency map

```text
#383 eligibility/outcomes ----+
                              v
#382 Finding semantics --> #385 inventory/selection/Coverage (settled D-12)
                              |                         |
#384 source/citation policy ---+--> provider/output ----+--> #388 lifecycle/persistence
#386 compliance gates --------------------------------------------+        |
                                                                          v
#390 interaction (settled D-13) --> beta UI + participant study --+
#387 evaluation design ------------> #389 launch gates ------------+--> owner review --> public flag
```

All named decision dependencies are settled. Internal evaluation may begin only with the settled versioned contracts and rights-cleared material; neither the interaction prototype nor its simulated comprehension task is public-launch evidence.

## Internal-evaluation implementation contract

The following boundary is safe to implement for rights-cleared internal evaluation under D-08 through D-13. Names below describe responsibilities, not a settled database design.

### Inputs

- canonical Video identity;
- immutable Transcript identity/version, timed passages, language and acquisition provenance;
- authenticated internal evaluator identity;
- feature/rubric/provider versions; and
- a rights-clearance assertion whose provenance can be audited.

### Pipeline boundaries

1. **Eligibility preflight** returns an eligible or `Not eligible` result with bounded reason, permanence, and named dependency conditions. It performs no external Finding generation and charges no declined use. `Not eligible` is terminal and never exposes Retry.
2. **Material Claim Inventory and selection** inventory the complete timed Transcript before retrieval; preserve exact occurrences, attribution, material elements, materiality, eligibility, decomposition, and deduplication; and server-recompute every Claim Unit and Material Inventory Entry ID. Select 8–15 without padding through D-12's Central-first, equal-duration time-bucket policy. Provider grouping, expected outcome, source availability, and manual overrides cannot change selection.
3. **Evidence acquisition** treats Transcript and retrieved content as untrusted data, not instructions. It implements D-11's complete Evidence Item, Evidence Origin Group, Evidence Set, frozen contrary-search, provenance, exact-passage, source-state, scope, rights/access, and change-signal contract. Domain-specific human/counsel configuration remains fail-closed; it is not provider discretion.
4. **Finding generation** may reference only server-issued Claim Unit, Material Inventory Entry, and governed evidence identifiers. It cannot invent URLs, passages, claims, evidence, confidence, or certainty prose. D-08 supplies the complete versioned Finding record, D-11 supplies admissible evidence and deterministic sufficiency, and D-12 supplies the frozen material-claim inputs.
5. **Validation** rejects malformed, unknown, duplicated, cross-claim, uncited, temporally incompatible, unsupported, certainty-bearing, or truth/person-scoring output. Technical incompletion creates no Finding. `Unresolved` is allowed only after the complete governed evidence process returns `insufficient_to_resolve` with one approved reason.
6. **Report assembly and publication** account for every unique Material Inventory Entry ID. `Unresolved` is a complete covered Finding; Excluded and cap-omitted Consequential entries remain uncovered and discoverable; an Excluded/omitted Central entry or any technically incomplete selected unit publishes nothing. D-09 permits atomic publication only when D-12's Central, selected-unit, eight-Finding, and Coverage invariants validate; internal scaffolding cannot expose a Learner artifact until D-11's source/rights policy and every authority/retention/operations gate are configured and proven.

### Trust and privacy boundaries

- Existing Summary and Video Chat code cannot import external Evidence Check content as grounding.
- YouTube API metadata is not an input to claim selection or Evidence Relationship generation.
- YouTube-origin fields, Transcript provenance, external sources, and generated analysis remain visibly and structurally distinct.
- Retrieved pages and Transcripts are attacker-controlled. Provider tools receive least privilege, bounded time/cost, validated URLs, and no ability to execute retrieved instructions.
- Internal reports are private to authorized evaluators. No public index, learner sharing, creator profile, channel history, or cross-user personalization is implied.
- Logs and analytics use bounded run/outcome/rubric identifiers and timings, not Transcript passages, claims, source excerpts, URLs containing secrets, or model prompts.

### Required proof seams

- pure tests for every eligibility outcome and governed `Unresolved` reason, including permanent versus conditional `Not eligible` dependencies, no-charge decline, and the absence of a Retry transition;
- pure contract tests for Claim Unit and Material Inventory Entry ID replay, exact-assertion deduplication, changed material elements/roles/reasons/anchors, compound decomposition, Central caps, half-open bucket boundaries, provider-order/grouping invariance, no padding, exact Coverage arithmetic, and the prohibition on selector/result overrides;
- route/service tests proving the flag and authorization fail closed and Summary/Chat remain unchanged;
- provider-boundary tests for hostile Transcript/page instructions, fabricated/unknown IDs, duplicate sources, cancellation, timeout, and bounded cost;
- real database tests for atomic admission/idempotency, one active Run per lineage plus one successor, terminal outcomes, atomic publication/current-pointer changes, owner isolation, least privilege, versioned rechecks, correction, and deletion;
- evaluation fixtures for central-claim omission, polarity/quantity/entity changes, temporal leakage, visually dependent claims, contrary evidence, citation laundering, inaccessible sources, and poisoned retrieval;
- browser tests for asynchronous reload, mobile layout, keyboard and assistive status, evidence inspection, partial/unresolved/not-eligible outcomes, and a disabled production flag; and
- immutable content-free audit evidence binding opaque Transcript, rubric, model, retriever, governed-source, and Report Version identities without copying private content into the audit ledger or telemetry.

## Resolved grilling case

The risk that a polished report causes a Learner to trust an intentionally seeded wrong Finding is now split cleanly between D-13's evidence-first Claim-desk interaction and D-10's non-compensatory comprehension and overreliance gate. The prototype makes the correction task executable, but only real owner-approved participant observations can supply launch evidence.

## Explicitly out of scope

- speaker, author, creator, or channel trustworthiness, legitimacy, bias, intent, deception, or reputation;
- a numeric Video score or combined weighted launch/quality score;
- moderation, suppression, demonetization, recommendation demotion, employment/credit/insurance/housing/law-enforcement decisions, or advertiser treatment;
- automated medical, legal, personal-finance, election, breaking-news, or public-safety findings;
- visual authenticity, deepfake detection, charts, demonstrations, or other claims absent from the Transcript;
- multilingual Findings before language-specific source policy and evaluation exist;
- permanent entitlement or pricing before value, latency, and unit economics pass their later gates;
- sponsored findings, paid source placement, or ads targeted from a Finding; and
- an aggregate-score experiment until a later calibrated stage independently earns approval.

## Staged delivery

### Stage A — settled-contract scaffolding

Incorporate the settled D-08 Finding, D-09 lifecycle, D-10 gate, D-11 source-policy, D-12 inventory/selection/Coverage, and D-13 interaction contracts into schemas, fixtures, evaluation labels, UI studies, and operational packets. Preserve D-13's provisional recommendation and tradeoffs until real participant evidence supports a production selection. Update this map and `CONTEXT.md` whenever a resolved term changes.

### Stage B — rights-cleared internal evaluation

Build the isolated, versioned harness and gold-set workflow against authorized material. Use public benchmarks only as regression suites. Record stage-level errors, risk-versus-coverage, Transcript degradation, temporal drift, adversarial behavior, source/citation integrity, cost, and latency.

### Stage C — usability and launch evidence

Implement D-13's accessible mobile/desktop interaction and run the owner-approved seeded-error comprehension study with real participants. Apply D-10 through a complete, predeclared, non-compensatory Evidence Gate Packet for the exact beta action. Obtain all three compliance clearances.

### Stage D — feature-flagged Learner beta

Only after every blocker clears, enable a bounded authenticated cohort with correction, appeal, kill-switch, audit, and sampling operations. Expansion, pricing placement, multilingual work, visual analysis, expert review, and any aggregate experiment require later decisions.

## Provenance and link-state audit

| Source | State validated 2026-08-11 | Authority used here |
| --- | --- | --- |
| [#381](https://github.com/xtan9/youtubeai_chat_frontend/issues/381) | Open | Canonical destination, settled product-decision ledger, launch constraints, and out-of-scope boundary |
| [#382](https://github.com/xtan9/youtubeai_chat_frontend/issues/382) | Closed | Settled Finding relationship, sufficiency, confidence, complete-record, exclusion, Unresolved, and technical-failure contract; immutable merged proposal at [`21ef9ed`](https://github.com/xtan9/youtubeai_chat_frontend/blob/21ef9eddf8de5815890114e5284a354e49f8e79c/docs/specs/2026-08-11-evidence-finding-semantics-proposal.md) |
| [#383](https://github.com/xtan9/youtubeai_chat_frontend/issues/383) | Closed | Eligibility and abstention resolution |
| [#384](https://github.com/xtan9/youtubeai_chat_frontend/issues/384) | Closed | Settled Evidence Item/Origin/Set, sufficiency, scope, citation, rights/access, and source-change contract; immutable merged [proposal](https://github.com/xtan9/youtubeai_chat_frontend/blob/e7e4cd6903144b896dd7c3543c1b7e446d3618bb/docs/specs/2026-08-11-evidence-source-policy-proposal.md) and [primary-source research](https://github.com/xtan9/youtubeai_chat_frontend/blob/e7e4cd6903144b896dd7c3543c1b7e446d3618bb/docs/research/2026-08-11-evidence-source-policy.md) |
| [#385](https://github.com/xtan9/youtubeai_chat_frontend/issues/385) | Closed | Settled Material Claim Inventory, Claim Unit/Material Inventory Entry identity, deterministic selector, exact Coverage/Central floor, omission, privacy/audit, and successor-correction contract; immutable merged [proposal](https://github.com/xtan9/youtubeai_chat_frontend/blob/c0722b402bfdda4cd3fa3942b258aa8ef7a93ac7/docs/specs/2026-08-11-material-claims-and-evidence-coverage-proposal.md) |
| [#386](https://github.com/xtan9/youtubeai_chat_frontend/issues/386) | Closed | Compliance research resolution and public-launch blockers |
| [#387](https://github.com/xtan9/youtubeai_chat_frontend/issues/387) | Closed | Evaluation research resolution and gold-set authority |
| [#388](https://github.com/xtan9/youtubeai_chat_frontend/issues/388) | Closed | Settled Run/Report, atomic publication, freshness/version/availability, recheck, accounting, Intake/Case, correction, notification, audit, retention, and deletion contract; immutable merged proposal at [`1d7f462`](https://github.com/xtan9/youtubeai_chat_frontend/blob/1d7f4623c30c1a675503eed23a8fe03f5eb54ae8/docs/specs/2026-08-11-evidence-check-lifecycle-proposal.md) |
| [#389](https://github.com/xtan9/youtubeai_chat_frontend/issues/389) | Closed | Settled action-specific Gate Packet, measurement grammar, non-compensatory thresholds, controlled-pause, retry, return, cost, correction, and human-authorization contract; immutable merged proposal at [`5493aa7`](https://github.com/xtan9/youtubeai_chat_frontend/blob/5493aa7cedd6a6c30dfeabb7e1f3929d2394c59e/docs/specs/2026-08-11-evidence-check-rollout-gates-proposal.md) |
| [#390](https://github.com/xtan9/youtubeai_chat_frontend/issues/390) | Closed | Settled opt-in peer Evidence tab, provisional Claim-desk recommendation and tradeoffs, bounded async/recheck, Coverage/provenance, availability/history/notices, mobile/accessibility, and simulated comprehension contract; [merged PR #413](https://github.com/xtan9/youtubeai_chat_frontend/pull/413), immutable [merge `88d88df`](https://github.com/xtan9/youtubeai_chat_frontend/commit/88d88dfd102bbff45dd06575a777fc21b136f167) and [prototype decision artifact](https://github.com/xtan9/youtubeai_chat_frontend/blob/88d88dfd102bbff45dd06575a777fc21b136f167/docs/prototypes/2026-08-11-evidence-workspace-prototype.md) |
| [Initial feature research](https://github.com/xtan9/youtubeai_chat_frontend/blob/codex/research-video-trust-score/docs/research/2026-08-08-video-trustworthiness-feature.md) | Unmerged working-tree research; branch link currently does not resolve to a committed blob | Discovery evidence only; not treated as a settled decision |
| [Policy research at `db5a2be`](https://github.com/xtan9/youtubeai_chat_frontend/blob/db5a2be6c57b0771c2cc67f9dee383556a318c07/docs/research/2026-08-10-evidence-check-policy-legal-constraints.md) | Immutable commit resolves | Evidence behind #386; owner resolution controls |
| [Evaluation research at `15209cf`](https://github.com/xtan9/youtubeai_chat_frontend/blob/15209cf2e4d0737f1d097c3224ab6fa0abc6112d/docs/research/2026-08-10-evidence-check-evaluation-calibration.md) | Immutable commit resolves | Evidence behind #387; owner resolution controls |

The initial feature-research path named by #381 exists only as uncommitted work in the referenced local research worktree and is absent from the named branch commit. It is therefore not a stable canonical link. This map cites it only as discovery context and relies on the closed owner resolutions plus immutable policy/evaluation commits for settled decisions.
