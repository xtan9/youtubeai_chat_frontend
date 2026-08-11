# Evidence Check lifecycle and correction proposal

**Decision ticket:** [#388](https://github.com/xtan9/youtubeai_chat_frontend/issues/388)

**Parent map:** [#381](https://github.com/xtan9/youtubeai_chat_frontend/issues/381)

**Status:** Owner-reviewed provisional proposal; independent review and the named launch-blocking choices remain open

## Inherited boundaries

- Evidence Check is opt-in and asynchronous. It follows a successful Summary and remains separate from Summary and Video Chat.
- `Not eligible` declines a report, `Partially completed` may publish a useful report with named omissions, and `Unresolved` is a claim-level abstention.
- #382 defines the complete Evidence Finding contract and forbids a technically incomplete run from manufacturing a Finding or weakening failure into `Unresolved`.
- #384 owns evidence admissibility, temporal fit, source changes, source rights, and snapshots. #385 owns the Material Claim Inventory, Evidence Coverage, and the non-compensatory partial-publication floor.
- The beta is learner-private, non-indexed, and non-shareable. Public exposure remains blocked by lawful Transcript acquisition, written YouTube approval, counsel clearance, and the #389 launch gates.
- A correction and appeal process, versioned findings, an immediate suppression control, and an auditable record are launch requirements.

## P-01 — Separate processing attempts from published editorial artifacts

An **Evidence Check Run** is one mutable asynchronous request and orchestration record. An **Evidence Report Version** is one immutable, atomically published editorial artifact. They have different identities and lifecycles.

Every admitted, non-duplicate explicit request creates a Run with a frozen input tuple: Learner and access context; canonical Video identity; immutable Transcript identity/version and acquisition provenance; eligibility, claim-selection, evidence-source, Finding, and Coverage policy versions; model, prompt, retriever, and validator versions; and the predecessor Report Version when the request is a recheck or correction. Operational retries may resume the same Run only while idempotency and its frozen inputs are preserved. If any nonterminal Run already exists for the Report lineage, P-03 joins or records a successor request instead; it never creates a second concurrent Run for a different fingerprint.

A Report Version is created only after the complete candidate report passes schema, evidence, Finding, Coverage, rights, and publication validation. Publication writes the immutable Report Version, its complete validated Findings and Coverage, its provenance, and the current-version pointer in one atomic transition. The product never exposes provider deltas, per-claim drafts, or a partially written report.

### Learner-visible Run states

The UI uses bounded, product-owned progress rather than provider or worker internals:

1. `checking_eligibility` — confirm that the Video, Transcript, topic, and runtime launch authority permit a run;
2. `waiting` — the accepted run is durable but is not actively examining content;
3. `examining_claims` — build and freeze the outcome-blind Material Claim Inventory;
4. `reviewing_evidence` — retrieve and evaluate governed evidence for selected claims;
5. `preparing_report` — validate the complete candidate and attempt atomic publication.

These are status disclosures, not progress percentages or promises about time remaining. Internal queue, provider, retry, and validation sub-stages stay operational metadata. Reload and return resolve the current durable Run state from the server rather than reconstructing it from browser state.

### Exactly one terminal Run outcome

| Outcome | Report publication | Meaning |
| --- | --- | --- |
| `not_eligible` | None | Deterministic preflight declined the request with a bounded reason, permanence, and named dependency conditions. It consumes no usage and is never Retry-eligible. |
| `completed` | One immutable Report Version | The candidate passed every contract for a complete report and was published atomically. |
| `partially_completed` | One immutable Report Version | The candidate passed #385's future non-compensatory publication floor. Every omitted, excluded, unresolved, or technically unprocessed Claim Unit is explicit; every published Finding is individually complete and valid. |
| `failed` | None | Technical or policy-controlled incompletion prevented a publishable report. No invalid or partial Finding is exposed. |
| `cancelled` | None | Cancellation won before atomic publication. Work and cost already incurred remain auditable, but no candidate artifact is exposed. |

The terminal outcome does not encode every concern. Each Run separately records a bounded terminal reason, permanence, retryability, usage disposition, timing/cost, and whether a predecessor Report Version remains current. A timeout, malformed provider output, validation rejection, source-rights failure, or dependency outage is never presented as evidence uncertainty.

### Constrained partial publication

`partially_completed` is a report-level outcome, not a partially valid Finding. It is permitted only when all of these hold:

- #385's future Coverage and material-claim floor passes without compensating for an omitted central or otherwise blocking Claim Unit;
- each published Finding independently satisfies the full #382 contract;
- every Claim Unit that lacks a Finding remains countable with one governed status and reason;
- the report says what was not completed and does not imply that unchecked content was supported; and
- atomic validation and publication succeed for the report as a whole.

If those conditions do not hold, the Run is `failed` and publishes nothing even when some internal Claim Units completed. This preserves #383's useful partial-report outcome without creating an invalid-fragment escape hatch.

### Recheck and current-version safety

A recheck creates a new Run. While it is active, the prior current Report Version remains visible with a separate recheck status; the UI never replaces it with a spinner or draft. Only successful atomic publication of `completed` or `partially_completed` advances the current-version pointer. A `failed`, `cancelled`, or `not_eligible` recheck cannot mutate, replace, or silently freshen the predecessor.

Every published Report Version links to its predecessor and the Run that produced it. History is append-only. A later correction, suppression, rights action, or retention action may govern which version is current or visible, but cannot rewrite the content or audit identity of a published version.

### Alternatives not recommended

- **One mutable report row:** simpler to load, but silently rewrites an editorial output, destroys reproducibility, and lets a failed recheck damage a valid report.
- **Publish claim or stage fragments as they finish:** appears faster, but exposes work before report-level Coverage, evidence, rights, and validation gates can establish that it is safe or representative.
- **Treat every retry as a new published version:** confuses operational recovery with an editorial change and fills history with failed or identical attempts.
- **Forbid every partial report:** maximizes simplicity but contradicts the settled `Partially completed` outcome and withholds a useful, candid report even when the future non-compensatory floor is met.

## P-02 — Freshness, version role, and availability are independent

One overloaded report status cannot safely answer three different questions: whether the evidence is current enough for the claim, whether a newer report exists, and whether the report may be displayed. Every Report Version therefore carries three orthogonal server-owned axes.

### Freshness

Freshness is derived conservatively from the governed dependencies of every material Claim Unit and Finding, using the versioned #384 source policy. It is never copied from provider confidence or inferred from source count.

- `current` — every material Transcript, claim, evidence, temporal, and jurisdictional dependency remains within its governed recheck window.
- `recheck_due` — a governed deadline passed or a material source changed or disappeared. The immutable report remains accessible and clearly dated, but the product cannot present it as current-status evidence. This state does not itself change an Evidence Relationship.
- `expired` — a hard policy deadline means the report can no longer be offered as an active assessment. Its audit shell, reason, dates, and version chain remain, subject to the separate availability and retention rules below.

Each Report Version displays its analysis date and evidence-retrieval cutoff. Claim time, relevant valid time, source publication time, retrieval time, and `recheck_at` remain distinct where applicable. #384 owns the actual domain- and evidence-sensitive windows; #388 does not invent one global time-to-live.

### Version role

- `current` — the Report Version is the latest atomically published version eligible to occupy the current pointer.
- `superseded` — a later Report Version is current.
- `unpointed` — the version lost the current pointer because it was suppressed, withdrawn, content-deleted, or expired without a replacement. It is not silently superseded and cannot cause an older version to become current.

Supersession does not imply that the older report was wrong. History identifies the newer version and exposes the before/after relationship without mutating either artifact.

### Availability

- `visible` — authorized Learners may load the governed display content.
- `temporarily_suppressed` — a safety, appeal, source-rights, Transcript-provenance, or compliance concern blocks display while review is pending.
- `withdrawn` — a completed correction, rights, privacy, deletion, or compliance decision blocks display under a governed final reason.

Availability is governed only at Report Version granularity. A concern about one Finding suppresses the complete Report Version because its published Coverage and omission account were validated as one atomic artifact; there is no separately displayable or suppressible Finding. Restoration or correction revalidates the complete report-level Finding and Coverage contract. This conservative beta rule can be revisited only by defining a separate Finding-availability model and proving that every resulting report recomputes Coverage without denominator laundering.

Availability actions never erase the Report Version identity, version chain, action reason, or authorized audit record. Rights, privacy, or preservation rules may require removal of all display content while retaining a content-free audit shell and integrity metadata. An urgent suppression changes availability directly; it cannot be delayed until a recheck finishes or mislabeled as staleness.

### Nullable current pointer

The Report lineage's current pointer is nullable and may identify only a `current`, `visible`, non-`expired` Report Version. Publishing a validated replacement writes the new version, marks the predecessor `superseded`, and advances the pointer in one transaction. Suppressing, withdrawing, deleting display content from, or expiring the pointed-to version atomically applies that state and clears the pointer with a compare-and-set on the exact version. A concurrent publication either wins before that transaction and is governed independently, or publishes after it from the newly read lineage state; neither action may clear an unrelated version.

Clearing the pointer never searches history or promotes an older `superseded` version. History remains dated and available only under its own governed axes, so suppression, withdrawal, deletion, or expiry cannot resurrect a stale or harmful predecessor. Restoring a temporary suppression may repoint the same immutable version only through an authorized transition that revalidates its freshness, availability, complete Coverage, and absence of a newer current version. A withdrawn, content-deleted, or expired version cannot be restored to current; it requires a new validated Report Version.

### Rollup and recheck invariants

Report freshness uses the most conservative state of every material dependency required by its publication contract. Incidental metadata cannot make a report stale, while a stale central dependency cannot be averaged away by many current findings. A recheck always creates a new Run; it cannot update dates on, recompute, or silently freshen the predecessor Report Version. Failed, cancelled, or declined rechecks leave all three predecessor axes unchanged unless an independent governed availability action applies. Expiry and availability actions follow the nullable-pointer transition above rather than falling back to history.

### Alternatives not recommended

- **One report-level expiration timestamp:** ignores that claims, evidence, rights, and domains age differently.
- **Hide the report when its first dependency becomes stale:** destroys useful dated history and makes ordinary evidence drift indistinguishable from a safety or legal action.
- **Leave a stale report looking current and rely on an as-of date:** invites current reliance on output that the system already knows is due for review.
- **Treat a correction or withdrawal as expiration:** conceals the editorial or compliance action and weakens the required audit trail.

## P-03 — Recheck signals coalesce; cost and entitlement remain auditable

### Trigger provenance

Every recheck signal is appended with one bounded, content-free trigger kind:

- `learner_requested`;
- `freshness_due`;
- `source_changed`;
- `transcript_changed`;
- `policy_changed`;
- `appeal_review`;
- `correction_review`; or
- `operator_review`.

The trigger record identifies the Report lineage, predecessor Report Version, frozen-input fingerprint, actor class, policy version, and time without placing Transcript text, claims, source excerpts, prompts, or free-form appeal content in telemetry. A safety or rights trigger may change availability immediately under P-02; it never waits for a recheck or edits a Report Version.

### One active Run per lineage and one coalesced successor

At most one nonterminal Run exists for a Report lineage, regardless of frozen-input fingerprint. Concurrent scheduler deliveries, Learner actions, appeals, or operator signals with the active fingerprint attach to that Run as trigger provenance. They do not create competing work, consume usage again, or change its frozen inputs. The fingerprint classifies join versus successor; it is not the uniqueness scope.

If a later signal identifies a materially different frozen input, such as a new Transcript or policy bundle, it cannot mutate the active Run or create a concurrent Run. The system records one coalesced successor intent and creates its Run only after the active Run reaches a terminal outcome. Further signals update the desired successor to the newest authorized input while retaining their individual audit links. Stable idempotency keys make scheduler and queue replay safe.

### Internal retry and user Retry are different

Bounded worker-delivery retries may continue the same Run before its one terminal outcome only with the same frozen inputs, idempotency key, usage reservation, and already persisted stage outputs. Backoff, attempt count, and terminal thresholds are governed operational fields.

After a Run is terminal, it never resumes. A user-visible Retry after a retryable `failed` outcome creates a new Run linked by `retry_of`. A completed, partially completed, cancelled, or not-eligible Run is not retryable. A later request after completion is a recheck. A later request after `not_eligible` is new work only when the prior bounded reason was conditional and its named dependency fingerprint has changed; a permanent reason or unchanged dependency is declined without creating a replacement Run.

### Cost attribution and Learner usage are separate ledgers

Admission atomically reserves Learner usage and the applicable system cost budget. Usage is released when an identical active Run is joined, eligibility or policy declines before billable work, a dependency fails before billable work, or the Learner cancels before billable work.

Immediately before the first billable external retrieval or provider step, the Run atomically marks its usage as consumed. After that point, cancellation, timeout, provider failure, validation rejection, partial completion, or completion cannot refund or erase the consumed usage or actual cost. Every later provider cost is attributed to the same Run, including bounded internal retries.

Freshness-scheduled, appeal, correction, and operator rechecks draw from a governed system budget and never consume Learner entitlement. A discretionary early Learner recheck, if a later entitlement policy permits it, is a new charged request. A normal due or expired recheck exposes a clear owner action; #389 owns its numeric allowance and cost gates.

When a retryable platform failure becomes terminal after Learner usage was consumed, the server may issue retry authorizations only under the versioned #389 policy. Every authorization is individually non-transferable, single-consumption, and bound to its source failed Run, owner, Report lineage, reason class, and policy version. A linked Retry consumes one authorization instead of a second Learner use but still requires current system-budget admission. An authorization cannot be refreshed, reused, transferred, or used on another lineage; the policy governs whether a failure receives any authorization and the bounded quantity it may receive. A Learner cancellation after billable start receives none. #389 owns those quantities, fleet caps, and stop thresholds; #388 owns only the authorization identity and consumption semantics.

### Alternatives not recommended

- **Refund every cancelled or failed Run:** lets a caller repeatedly incur retrieval cost without consuming the bounded entitlement.
- **Charge every worker delivery attempt:** makes infrastructure retries non-idempotent and charges a Learner multiple times for one request.
- **Allow an unlimited free retry chain:** turns a reliability courtesy into an unbounded spending path.
- **Replace usage records with mutable refunds:** destroys the distinction between incurred cost, released reservation, compensating authorization, and successful publication.
- **Change active Run inputs when a newer signal arrives:** makes the output irreproducible and lets policy or Transcript changes race validation.

## P-04 — Appeals are review cases, never votes or in-place edits

### Non-confirming external Intake

The report-owning Learner may appeal an exact Report/Finding Version through their already authorized report view. A creator, reliably identified speaker, subject, or source publisher instead submits Video and claim context, a bounded issue category, and supporting evidence as a separate **Evidence Review Intake**. An Intake is not a Case and carries no Report or Learner identifier at its external boundary. Its identity, original submission, claimant-class assertion, contact-channel proof, and policy version are immutable; later workflow transitions, matching attempts, evidence additions, and dispositions are append-only events whose current state is a derived projection.

Matched and unmatched Intakes receive indistinguishable receipt copy, reference format, timing bounds, and externally visible disposition vocabulary. Receipt never confirms whether a private Report exists, whether an authorized Learner requested one, whether internal matching succeeded, or what Report content or state may exist. A submitter must reauthenticate or prove control of the original bounded contact channel before loading even that generic status; links and notifications alone confer no access.

The submitter can observe only `received` and terminal `review_complete`, with the same generic terminal copy whether the Intake was matched, linked, dismissed, or unmatched. Restricted internal Intake states and reasons may distinguish identity verification, triage, optional matching, Case linkage, duplicate, abuse, out-of-scope, and unable-to-match outcomes, but none of those distinctions crosses the external boundary.

Authorized staff may optionally link an Intake to an exact private Report/Finding Version inside the restricted review boundary. That internal link creates or attaches to an Evidence Review Case only after identity, scope, and triage rules pass. An unmatched, unverifiable, duplicate, abusive, or out-of-scope Intake may reach a bounded generic terminal disposition without a Case. Later matching appends an authorized link; it does not rewrite the Intake or change what the submitter was told. External Intake IDs cannot address, enumerate, or authorize a Report or Case.

### Evidence Review Case

An **Evidence Review Case** has immutable identity, exact Report/Finding Version target, creation authority, and policy version within the restricted review boundary. Evidence additions, reviewer assignments, suppression actions, rationale records, and state transitions are append-only events; the current workflow state is a derived projection. Its governed states are:

1. `received`;
2. `triaged`;
3. `under_review`; and
4. exactly one terminal disposition: `no_change`, `corrected`, `withdrawn`, `unable_to_resolve`, or `dismissed`.

`dismissed` carries a bounded duplicate, inactionable, out-of-scope, or abuse reason. Submissions are deduplicated and rate-limited by claimant class, target/version, issue category, and a privacy-governed submitted-evidence fingerprint. Additional evidence may attach to the Case, but submission count is never a vote, source-independence signal, or reason to change an Evidence Relationship.

### Triage, suppression, and independent review

A deterministic structural-integrity, source-rights, or Transcript-provenance revocation may suppress an affected Report Version automatically. Other alleged harm receives prompt trained triage. Once a challenge to any Finding is judged plausibly harmful, the complete Report Version becomes `temporarily_suppressed` immediately and remains so while reviewed; the nullable current-pointer transition clears it without promoting an older version.

A material dispute is reviewed by a trained human who was not responsible for the original human decision. Counsel-approved severity categories determine escalation, reviewer qualifications, service levels, preservation, and retraction language. A Case disposition records the evidence and governed rationale considered; it cannot be produced by popularity or an unreviewed model result.

### Correction publication

A Case decision never edits a Report Version. `corrected` or `unable_to_resolve` starts a correction Run. The Case cannot reach that terminal disposition until a complete corrected Report Version has passed validation and published atomically. The new version links the Case and predecessor and exposes a governed before/after field diff where rights and safety permit. If generation, validation, or publication fails, the Case remains open and any suppression remains in effect.

`no_change` may restore and repoint the same immutable Report Version only when no other suppression reason applies, its complete Findings and Coverage revalidate, it is still fresh, and no newer current version exists. `withdrawn` leaves a content-free history shell and no active display content. A harmful superseded version may remain suppressed rather than being republished merely to show history; authorized audit preserves the action chain.

### Notifications

The beta guarantees private in-product notifications for asynchronous terminal outcomes that require Learner awareness: `completed`, `partially_completed`, retryable `failed`, `not_eligible`, first transition to `recheck_due`, material correction, suppression, restoration, withdrawal, and an authorized Case disposition. External submitters receive only the generic, non-confirming Intake receipt and disposition described above. It does not notify for internal delivery retries, duplicate/coalesced triggers, matching decisions, or an automatic recheck failure when the prior Report remains available and no user-facing state changed.

Email or push is opt-in only and contains generic copy such as “A private Evidence Check needs attention — sign in.” It contains no Video, claim, Evidence Relationship, source, appeal, reviewer, or result data. Opening a notice reauthorizes access before loading detail. A delivery ledger keyed by recipient, event kind, and object version makes retries idempotent and prevents duplicate Learner notices.

### Content-free audit and restricted Case content

An append-only audit ledger records Run transitions, usage and cost disposition, publication and current-pointer changes, freshness and availability changes, triggers, Intake receipt/link/disposition actions, Case transitions and disposition, reviewer role, and notification delivery. It stores opaque object and actor identifiers, bounded reason/action codes, policy and component versions, timestamps, and before/after state. It does not store Transcript or claim text, source excerpts or sensitive URLs, prompts, model output, free-form rationale, or notification content.

Submitted evidence, claimant contact data, internal matching data, and reviewer rationale belong in a separate least-privilege Intake/Case store with explicit source-rights and privacy retention. Authorized audit links that content by opaque IDs; analytics and ordinary application logs cannot. A lawful deletion or rights action may remove display, Intake, and Case content while retaining a content-free tombstone showing that an authorized action occurred.

### Alternatives not recommended

- **Let external submitters search private Reports:** creates a report-existence and Learner-activity oracle.
- **Automatically suppress every unverified complaint:** makes coordinated complaints a censorship mechanism; automatic action is reserved for deterministic integrity or rights controls, with trained triage for alleged harm.
- **Use appeal counts as votes:** substitutes popularity and brigading for evidence and reviewer policy.
- **Edit the original Finding in place:** destroys the before/after record and makes prior Learner reliance unauditable.
- **Put Case detail in notifications, telemetry, or the general audit ledger:** leaks sensitive content beyond the review purpose.

## P-05 — Retention is bounded; deletion can remove content without rewriting history

### Mandatory retention schedules

The beta requires separately configured, versioned schedules for:

1. provider and candidate working buffers;
2. terminal Run metadata;
3. Report and Finding display content;
4. minimal evidence spans or authorized snapshots;
5. Review Case evidence, claimant contact, and reviewer rationale;
6. notification and delivery records; and
7. content-free audit tombstones.

Every retained record identifies its `retention_policy_version`, `delete_after`, and any narrower source-rights deadline. No category defaults to indefinite retention. Exact durations and jurisdiction variants require documented owner and #386 counsel approval; inventing a technical default does not satisfy that launch blocker.

Candidate and provider buffers are never Learner-visible. They are removed immediately after terminal validation and persistence, except for the smallest encrypted, access-restricted crash-recovery window authorized by the applicable schedule. Failed, cancelled, and rejected output is not retained merely because generation cost was incurred.

Report history is immutable while retained: content and decisions cannot be silently edited. Freshness expiration alone does not delete that dated history. Account, privacy, source-rights, license, correction, or other authorized deletion may remove display content and leave a non-reconstructive tombstone. Evidence content is deleted at the earliest applicable Report, source-rights, license, privacy, Case, or vendor deadline; metadata cannot preserve a prohibited passage indirectly.

If a required schedule, deletion worker, deletion queue, or vendor propagation path is missing, unhealthy, or overdue beyond its governed bound, new Learner Evidence Check Runs fail closed. An operational retention failure is not an excuse to accumulate content indefinitely.

### Deletion and rights actions

A Learner's Report deletion immediately revokes current display access and queues an idempotent purge of the Report, Findings, evidence content, and object-specific notification content. It does not refund or reset consumed usage or actual cost. Account deletion applies the same process across all private Report lineages; it does not implicitly delete shared Video or Transcript records governed for other purposes.

A source takedown, license expiry, or Transcript-provenance revocation suppresses affected display content first, purges content that may no longer be retained, and starts a recheck only when lawful replacement evidence is available and all other admission gates pass. A creator or subject objection enters the P-04 Case process; intake neither reveals nor automatically deletes another Learner's private Report.

Deletion propagates to processors, retrieval/model vendors, caches, exports under product control, and backups according to the approved schedule. Each request and processor acknowledgment is idempotent and auditable. After physical removal, the ordinary audit ledger retains only opaque artifact/version/event identifiers, bounded deletion authority and reason, policy version, and timestamps. It does not retain a content-derived hash unless counsel has explicitly authorized that data; append-only event-chain integrity protects the tombstone itself.

### Narrow legal hold

A legal hold requires counsel-authorized scope, authority, hold identifier, start time, review cadence, and expiry or renewal decision. Held content moves to or remains in a separate restricted store and is unavailable to ordinary product access. A hold delays physical purge only: it cannot restore display visibility, freshness, current-version status, model/retrieval use, notification detail, or ordinary staff access. Releasing the hold resumes the queued deletion. An indefinite or manually forgotten hold without review and expiry is invalid.

## Terminal action tables

### Evidence Check Run

| Terminal outcome | Report/current pointer | Usage and cost | Retry | Cleanup and notice |
| --- | --- | --- | --- | --- |
| `not_eligible` | No Report; predecessor unchanged | Release reservation; consume no usage | None. It is terminal and never Retry-eligible; after a named conditional dependency changes, a new request or recheck may create a new Run | Purge buffers; notify the requesting Learner with bounded reason/permanence and changed-dependency requirement |
| `completed` | Atomically publish one immutable Report Version and advance current | Consume once at billable start; retain actual cost | Not a Retry; a later request is a recheck | Schedule freshness, purge drafts, notify readiness |
| `partially_completed` | Atomically publish one immutable Report Version only after #385's floor; advance current | Same as completed | Not a Retry; a later request is a recheck | Expose every governed omission, schedule freshness, purge drafts, notify partial completion |
| pre-billable `failed` | No Report; predecessor unchanged | Release reservation; no usage/cost consumption | New linked Run only for a bounded retryable reason | Purge buffers; notify only when Learner action is available |
| post-billable `failed` | No Report; predecessor unchanged | Usage and cost remain consumed | Zero or more individually single-consumption authorizations only as bounded by the versioned #389 policy for a retryable platform failure | Purge unsafe buffers; retain content-free diagnostics; notify action |
| pre-billable `cancelled` | No Report; predecessor unchanged | Release reservation | None; a later request is new work | Purge buffers; no completion notice |
| post-billable `cancelled` | No Report; predecessor unchanged | Usage and cost remain consumed | No retry authorization | Purge buffers; no completion notice |

An independent freshness or availability action caused by the trigger still applies when a recheck publishes nothing. For example, a rights revocation can keep the predecessor suppressed even though the correction Run failed. Conversely, a failed automatic freshness recheck cannot supersede a still-visible predecessor.

### Evidence Review Case

| Terminal disposition | Report action | Availability | Notice |
| --- | --- | --- | --- |
| `dismissed` | No new Report | Restore only when this Case supplied the last suppression reason | Generic disposition to submitter; authorized owner notice only if state changed |
| `no_change` | No new Report and no edit | Restore the same version only when no other suppression applies | Governed no-change notice without exposing private Report detail externally |
| `corrected` | Terminal only after a corrected Report Version publishes atomically; old version becomes superseded | New version visible if authorized; harmful old content may remain suppressed | Material-correction notice and authorized before/after view |
| `unable_to_resolve` | Terminal only after a valid corrected version publishes governed Unresolved Findings/Coverage | New version visible if authorized; predecessor governed independently | Material-change notice without truth framing |
| `withdrawn` | No active Report; content-free history shell remains | Affected version is withdrawn | Withdrawal notice within authorization and non-confirmation rules |

## Decision table

| ID | Provisional decision | Main trade-off | Rejected alternative |
| --- | --- | --- | --- |
| P-01 | Mutable Run plus immutable atomically published Report Version | More objects and transitions, but incomplete work cannot damage a published report | One mutable run/report row or streaming draft publication |
| P-02 | Independent freshness, `current`/`superseded`/`unpointed` version role, report-only availability, and a nullable non-fallback current pointer | More states to render, but stale evidence, supersession, safety action, and absence of a current report stay truthful | One overloaded stale/expired flag or automatic fallback to history |
| P-03 | Append-only triggers, one active Run per lineage, one coalesced successor, irreversible post-billable accounting, and policy-governed single-consumption retry authorizations | Requires idempotent ledgers and budgets, but prevents concurrent A/B work, duplicate charge, and cost bypass | Fingerprint-scoped concurrent Runs, mutable refunds, per-attempt charging, or unbounded retry |
| P-04 | Separate non-confirming external Intake plus optionally linked human Review Case; correction only through a new version | More objects and restricted matching, but no privacy oracle, vote, or silent edit | Public report lookup, treating every intake as a Case, popularity correction, or in-place rewrite |
| P-05 | Versioned bounded retention, lawful content deletion with tombstones, and narrowly governed legal hold | Some old content becomes unavailable, but “immutability” cannot defeat rights or privacy | Forever retention or deletion that erases the action trail |

## Validation invariants

1. A Report lineage has at most one nonterminal Run across all fingerprints and at most one coalesced successor intent. Each Run has one frozen input fingerprint and reaches exactly one terminal outcome; an internal delivery retry cannot change either.
2. Only `completed` or `partially_completed` creates a Report Version, and publication plus current-pointer advancement is atomic.
3. No failed, cancelled, declined, malformed, or unvalidated Finding is exposed, persisted as editorial content, or converted to `Unresolved`.
4. A recheck never edits or refreshes its predecessor. Failure leaves the predecessor's current/version role unchanged; independent freshness and availability actions remain explicit.
5. A partial Report contains only complete valid Findings, passes #385's non-compensatory floor, and accounts for every omitted or unprocessed Claim Unit.
6. Freshness, version role, and report-only availability change only through governed server actions and cannot be inferred from provider prose or UI state. Clearing a current pointer never resurrects a superseded version.
7. Duplicate triggers, scheduler deliveries, retries, Intake/Case submissions, and notifications are idempotent and cannot multiply work, charge, or Learner notices.
8. An appeal count never affects an Evidence Relationship. A material correction requires authorized independent human review and a new validated Report Version.
9. Logs, analytics, the ordinary audit ledger, and external notices remain content-free. Restricted Intake/Case content and matching results never cross those boundaries.
10. Deletion and legal hold never restore entitlement, visibility, freshness, current status, or model use. Tombstones cannot reconstruct removed content.
11. Missing retention policy, deletion execution, vendor propagation, launch authority, or system budget fails closed for new Learner Runs without altering Summary or Video Chat.
12. A lineage has either one exact eligible current-pointer target or a null pointer. Suppression, withdrawal, display-content deletion, and expiry of that target clear it atomically and never promote history.
13. `not_eligible` has no Retry transition. Only a new request after a named conditional dependency changes can create new work; permanent or unchanged reasons remain declined.
14. An external Intake reveals only the same `received` and `review_complete` contract for matched and unmatched submissions. Matching, Case linkage, and any private Report state require restricted authorization and never become an external oracle.

## Stress cases

| Scenario | Required behavior |
| --- | --- |
| A recheck fails after a valid current Report exists. | No new Report; current predecessor remains visible unless a separate freshness, safety, or rights action applies. |
| A source disappears one hour after publication. | Recompute freshness under #384, attach `source_changed`, preserve the immutable version, and suppress immediately only if rights/safety policy requires it. |
| Two schedulers and the Learner request the same due recheck concurrently. | One active Run and one usage/system-budget admission; all three triggers attach to it. |
| A new Transcript version arrives while the old-input Run is active. | Do not mutate the active Run; queue one coalesced successor with the new fingerprint. |
| The Learner cancels after paid retrieval begins. | Terminal post-billable cancellation; cost/usage remain; no Report and no retry authorization. |
| A provider outage becomes terminal after usage was consumed. | No Report; issue only the number of non-transferable, individually single-consumption authorizations permitted by the versioned #389 policy for that failure class. |
| Fingerprint A is active when signals for fingerprints B and C arrive. | Keep only A as the lineage's nonterminal Run; coalesce B/C into one newest authorized successor intent while preserving both trigger records, then create at most one successor Run after A terminates. |
| Eight valid Findings finish but a central Claim Unit fails. | Publish nothing unless #385's future non-compensatory partial floor explicitly allows that exact state; completed internal fragments never leak. |
| One hundred identical complaints target a private Report. | One deduplicated Case/provenance set, no privacy confirmation, no vote, and no automatic relationship change. |
| The current Report is suppressed while two older visible versions exist. | Atomically mark the current version `unpointed` and clear the pointer; both older versions stay `superseded`, and no report becomes current by fallback. |
| A matched external Intake and an unmatched Intake are checked by their submitters. | Both require reauthentication and expose the same receipt reference shape, timing bound, `received` state, and generic `review_complete` disposition; only restricted staff can see matching or Case linkage. |
| A Learner repeats a conditionally `not_eligible` request before its named dependency changes. | Decline without Retry and without creating a replacement Run; a changed dependency permits a new request with a new frozen fingerprint. |
| A plausibly harmful Finding is appealed and correction generation fails. | Keep the complete Report Version suppressed and unpointed and the Case open; do not claim correction, expose partial Coverage, or restore an older version. |
| A Learner deletes a Report under legal hold. | Revoke product visibility immediately; restrict held content; resume purge when the scoped hold ends; retain only the authorized tombstone afterward. |

## Cross-issue dependencies

| Owner | Contract consumed or still required |
| --- | --- |
| #381 — beta decision map | Must incorporate these owner-reviewed lifecycle terms and keep the Evidence tab asynchronous, private, and separate from Summary/Chat. |
| #382 — Finding semantics | Supplies the complete Evidence Finding, Unresolved, exclusion, and technical-failure boundary that publication validates. |
| #383 — eligibility | Supplies Not eligible reasons, permanence/retryability, no-charge decline, partial-report outcome, and claim-level abstention distinctions. |
| #384 — evidence and citation policy | Must define admissibility, rights, snapshots, temporal/jurisdictional fit, source-change detection, and the per-dependency `recheck_at`/hard-expiry rules. |
| #385 — claims and Coverage | Must define the frozen inventory, countable Claim Unit, selection/cap, omissions, and non-compensatory partial-publication floor. |
| #386 — compliance clearances | Counsel/owner must approve exact retention periods, jurisdictions, legal-hold authority, appeal SLAs, retraction wording, source rights, and deletion/vendor obligations; YouTube approval and lawful Transcript sourcing remain launch blockers. |
| #387 — evaluation | Must test temporal drift, source disappearance/correction, abstention, partial-report validity, seeded correction, and comprehension against versioned lifecycle behavior. |
| #389 — launch gates | Owns whether and how many retry authorizations a governed failure class may receive, plus latency, cost, correction, reversal, stop, and system-budget thresholds; it cannot redefine each authorization's non-transferable single-consumption lifecycle. |
| #390 — interaction prototype | Must make progress, prior-current-during-recheck, partial status, dates, stale/expired/suppressed/withdrawn states, history, correction diff, notices, Retry, and mobile/accessibility comprehensible. |

## Remaining launch-blocking human choices

The owner and counsel must still approve the exact retention durations and jurisdiction variants; Case severity/escalation/service levels; reviewer qualifications; retraction and correction language; legal-hold authority and review cadence; vendor deletion commitments; and external-notification jurisdictions. #389 must set the numeric retry and system-budget caps. #390 must prove that Learners understand dated Evidence Relationships, stale versus corrected output, suppression, and partial Coverage without reading them as truth or author reputation.

Those decisions configure or test this contract; they must not collapse its distinct domain states. If any required schedule or clearance remains absent, Learner exposure stays disabled even when implementation is technically complete.

## Evidence behind the proposal

- The #383 resolution establishes distinct `Not eligible`, `Partially completed`, and claim-level `Unresolved` outcomes, with retryability and no-charge decline as explicit properties.
- The owner-reviewed #382 decision requires complete auditable Findings and says technical incompletion produces no Finding.
- The initial research recommends separate asynchronous runs and versioned reports, domain-sensitive expiration, and append-only updates rather than silent mutation.
- The policy research makes versioned findings, visible correction dates, immediate suppression, a staffed appeal queue, and an internal audit trail public-launch requirements.
- Existing Summary Run code demonstrates bounded terminal state and retry concepts, while Project Artifacts demonstrate immutable current/history versions. Evidence Check needs both concepts but cannot safely collapse them into one object.
