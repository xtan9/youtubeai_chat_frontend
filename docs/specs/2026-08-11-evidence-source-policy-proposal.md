# Evidence Check source and citation policy proposal

**Decision ticket:** [#384](https://github.com/xtan9/youtubeai_chat_frontend/issues/384)

**Parent map:** [#381](https://github.com/xtan9/youtubeai_chat_frontend/issues/381)

**Status:** Owner-review proposal. Rights-cleared internal evaluation may use this
versioned contract, but Learner exposure remains blocked by counsel/platform
clearance, #385 Coverage, #389 launch gates, and #390 comprehension evidence.

## Inherited boundaries

- #382 defines a Finding as one complete, dated, evidence-relative relationship:
  `Supported`, `Qualified`, `Conflicts`, or `Unresolved`. It forbids truth,
  speaker-intent, reputation, and model-certainty framing.
- #383 makes ineligible claims, claim-level abstention, partial reports, and
  technical failure distinct. Source absence never becomes contradiction.
- #386 permits only rights-cleared internal evaluation until lawful Transcript
  sourcing, written YouTube approval, and counsel clearance exist. Source use,
  display, snapshots, retention, and jurisdiction are launch controls.
- #387 makes a Video-first human gold set the launch authority and requires
  citation correctness/completeness, authority, independence, freshness,
  contrary-evidence retrieval, and risk beside Coverage to be measured separately.
- #388 makes Runs mutable, Report Versions immutable, and freshness, version role,
  report availability, recheck, correction, source-rights deletion, and audit
  separate lifecycle concerns. This policy supplies its evidence dependencies and
  change signals; it does not redefine lifecycle transitions.
- #385 still owns the canonical material-claim unit and denominator,
  normalization, materiality, selection, caps, and Evidence Coverage. Until that
  closes, this policy consumes only a versioned provisional material-claim
  identity and its explicitly supplied material elements. #390 still owns screen
  order and interaction.

## P-01 — Admit versioned Evidence Items, not reputable-looking links

An **Evidence Item** is one exact, bounded passage from one identified state of an
external resource, admitted for one versioned material-claim representation under
one versioned source policy.
It is evidence only after the server validates all of these dimensions:

| Dimension | Required record |
| --- | --- |
| Source identity | Canonical resource identifier/URL, title, publisher, author or responsible body, source class, language, and stable identifiers when available |
| Source state | Content-version identifier or hash, publication and modification dates when known, retrieval time, and the dated state/snapshot identity used |
| Passage | Exact Unicode text, bounded prefix/suffix or stable offsets, passage language, and the smallest context needed to preserve meaning |
| Claim relation | Versioned provisional material-claim ID, explicitly supplied material-element IDs addressed, and exactly one passage stance: `supports`, `qualifies`, or `conflicts` |
| Authority fit | The exact proposition for which this source is competent or direct, the governed authority rule used, and limitations or conflicts of interest |
| Origin | One server-issued Evidence Origin Group identifying the underlying record, study, dataset, event, press release, wire report, or expert from which derivative reports arise |
| Scope | Evidence valid time/interval, relevant jurisdiction, claim time, and assessment cutoff when applicable |
| Rights and access | Acquisition route, license/terms basis, attribution, permitted use/display, excerpt and snapshot permission, retention/deletion deadline, and access restrictions |
| Lifecycle | Recheck rule, hard expiry, last successful access, and bounded change/unavailability signal |

An Evidence Item is inadmissible when the source state or passage cannot be
identified; the passage does not address the claim element; authority, origin,
time, jurisdiction, rights, or access cannot be established; the source is an
anonymous assertion; or the acquisition/display path bypasses a paywall,
authentication, robots/TDM reservation, or other technical or contractual control.
Retrieved candidates that merely mention the topic without addressing the claim
remain evaluation/retrieval diagnostics; they are not Evidence Items and cannot
enter a sufficiency count.

The first beta's evidence-language scope is English. A non-English resource may
help discover an eligible English source, but it cannot support a Learner-facing
directional Finding until a later owner-approved source-language and translation
policy preserves the exact original passage, translation provenance, semantic
fidelity, rights, evaluation slice, and Learner disclosure. Provider translation
cannot silently become the cited source text.

The source page and retrieved passage are untrusted data. Their instructions,
metadata claims, markup, popularity, search rank, and self-description cannot
control policy, tools, the relationship, or rendering. Provenance proves what was
used; it does not prove that the source is correct or authoritative.

### Source class is descriptive, not a trust score

`primary` and `secondary` are relationships to a proposition, not permanent ranks
for a publisher. Examples:

- an enacted instrument is direct for its text in the issuing jurisdiction, but
  not automatically for the effect of that law;
- a registry is direct for the state it officially records, subject to its stated
  scope and update process;
- an original study is direct for what that study did and observed, but not by
  itself for a broader population claim;
- a transparent systematic synthesis is direct for its stated synthesis and may
  be more fit for a broad evidence-base claim than one underlying study;
- a claimant's own statement is direct for what the claimant said, not independent
  support for the asserted external fact; and
- reporting or expert interpretation may explain, discover, or corroborate an
  origin without becoming another independent origin.

Authority is therefore a versioned, domain-specific predicate over the exact
claim, source, time, and jurisdiction. There is no global trusted-domain list,
publisher reputation score, citation-count boost, or model-selected source tier.
Source class, authority rule, Evidence Origin Group, scope, rights decision, and
policy outcome are server-owned. A provider may extract candidate metadata, but it
cannot assign or override those governed labels. Origin grouping is derived from
validated identifiers and provenance; ambiguous origins count as one rather than
being split by a model.

### Alternatives not recommended

- **Domain allowlist alone:** simple and fast, but a usually strong publisher may
  still be indirect, stale, outside its jurisdiction, or wrong for this claim.
- **Model-assigned source quality score:** flexible, but opaque and gameable; it
  lets provider judgment replace the server's policy.
- **Use every retrieved link:** maximizes apparent coverage while admitting
  irrelevant passages, duplicates, rights failures, and source-origin laundering.

## P-02 — Sufficiency is material-element coverage plus independent authority

The server evaluates an Evidence Set after retrieval and before Finding
generation. The policy result identifies the versioned material-claim
representation, covered material
elements, Evidence Items, distinct Evidence Origin Groups, supporting/qualifying/
contrary positions, authority rules, search record, limitations, and a deterministic
`sufficient_for_directional_finding` or `insufficient_to_resolve` result.

#383's no-charge source-availability preflight is earlier and deliberately
coarser: it may decline a Video when the configured source landscape clearly
cannot support meaningful Coverage, but it creates no Evidence Item or Finding.
Passing preflight is not evidence sufficiency. If an admitted, completely executed
retrieval later finds too little admissible evidence for one eligible claim, that
claim becomes governed `Unresolved`; if the retrieval process does not complete,
the Run fails technically and creates no Finding.

### Default directional rule

A directional Finding normally requires:

1. every material claim element required by #382/#385 is addressed by an exact
   admissible passage;
2. at least two independently originating Evidence Items each materially support
   the proposed direction, while the complete set covers every required element,
   not merely the topic;
3. at least one item is competent/direct for the material proposition under the
   domain policy;
4. support, qualification, and contradiction were searched separately using the
   frozen retrieval plan;
5. every material contrary position found is retained and evaluated;
6. all counted evidence fits the claim's time, jurisdiction, rights, and learner-
   verifiability requirements; and
7. no unresolved material conflict or missing claim element remains.

Two pages derived from one press release, dataset, study, wire report, official
record, or named expert count as one Evidence Origin Group. When independence is
unknown, they conservatively count as one. A synthesis and the studies it includes
are not naively counted as independent votes; their provenance remains visible.

### Narrow one-origin exception

One Evidence Origin Group may be sufficient only when the versioned policy
explicitly allowlists the claim type and authority route because one source is
constitutive or uniquely competent for that narrow fact. The item must still:

- address every material element in an exact passage;
- be the applicable source state for the exact time and jurisdiction;
- have a lawful, learner-verifiable citation path;
- pass the same frozen contrary-evidence search without finding a material
  admissible conflict; and
- have no material admissible conflict or unresolved authority limitation.

Examples might include the exact current state of a low-risk public registry or
the text of an instrument issued by the body that controls that record. A source
does not earn the exception merely by being official, primary, popular, or the
only result retrieved.

### Secondary-only evidence

Secondary sources may discover origins, explain methods, or corroborate a
directional set. When no suitable direct/primary evidence exists, a directional
Finding is allowed only for a claim type whose owner-reviewed policy explicitly
permits secondary-only synthesis, with at least two independent origins that each
pass the domain-specific authority and method rules and a visible limitation.
Otherwise the Finding is
`Unresolved / insufficient_admissible_evidence`.

This exception cannot be used for a source that merely repeats the Video's claim,
for unattributed or anonymous assertions, or to evade a primary source that is
unavailable because its lawful access/display path is missing.

### Relationship-specific sufficiency

- **Supported:** the set sufficiently establishes every material element and no
  material admissible evidence qualifies or conflicts with it.
- **Qualified:** the set sufficiently establishes every asserted material element
  and sufficiently establishes a non-contradictory boundary that changes how the
  claim should be understood.
- **Conflicts:** the set sufficiently contradicts at least one asserted material
  element. Lack of support, weaker scope, or failure to retrieve a source is not
  contradiction.
- **Unresolved:** authority, independence, material-element coverage, temporal or
  jurisdictional fit, lawful access, learner verifiability, or principled conflict
  resolution is insufficient.

Evidence count cannot compensate for a failed dimension. Ten derivative articles
do not overcome one origin, and two independent sources do not repair a missing
quantifier, date, geography, or legal right.

### Alternatives not recommended

- **Always one primary source:** fast and sometimes correct, but too permissive for
  self-reported or broad claims and too rigid when a transparent synthesis is the
  competent source.
- **Always two URLs:** easy to test but vulnerable to syndication and circular
  reporting.
- **Weighted authority score:** ranks candidates conveniently but lets source
  volume or prestige compensate for an uncovered material element or hard scope
  failure.
- **Human-style “best judgment” in the model prompt:** hides the discriminator,
  cannot be reproduced, and permits coordinated label laundering.

## P-03 — Retrieve and preserve all material positions

The frozen retrieval plan generates claim-element queries and distinct support,
qualification, and contradiction queries. It searches the applicable source
classes and jurisdictions within a bounded budget, records each query class and
stopping reason, deduplicates resources, and groups derivative material by origin.
No-results is a search outcome, never proof that contrary evidence does not exist.
Reaching enough supporting sources is not a stopping rule: every required query
family and source/jurisdiction slice must finish. Provider outage, timeout, budget
exhaustion before the frozen plan completes, or an unprocessed required candidate
is technical incompletion and produces no Finding under #382/#388. A completed
plan that finds too little admissible evidence produces `Unresolved`.

When a result or metadata indicates a material competing position but its passage
cannot be lawfully accessed and verified, the system records the bounded access
limitation and may not silently discard the position. The set remains unresolved
unless the same material position is independently established through admissible
evidence and the inaccessible item is not otherwise required by the authority or
rights policy.

Every material admissible position found is represented by at least one
query-relevant exact passage from each independent origin that contributes to the
policy decision. The system cannot take only the first passage from a source,
hide a less convenient position, or let repeated phrasing crowd a competing
position out of the bounded set.

### Conflict adjudication

Conflict is never decided by source majority, recency alone, popularity, or an
LLM's preference. The server may resolve competing positions only through a
predeclared discriminator relevant to the exact proposition:

1. competence or legal/administrative authority for the exact recorded fact;
2. directness to the underlying observation, record, or method;
3. methodological fitness and declared scope;
4. independence from the other origins;
5. applicable valid time and assessment cutoff;
6. applicable jurisdiction; or
7. an authenticated correction, withdrawal, or supersession chain.

The decision records the discriminator and the evidence it used. The learner-
discoverable Finding preserves the material supporting and contrary positions and
explains why the policy could or could not distinguish them. If no discriminator
resolves the conflict, the result is `Unresolved / conflicting_evidence`; the
system cannot average the positions into `Qualified`, pick a winner, or manufacture
consensus. The discriminator and resolution are server-issued policy decisions;
provider output may reference their opaque IDs but cannot choose or relabel them.

### Alternatives not recommended

- **Source-majority vote:** derivative publication volume becomes false
  corroboration.
- **Newest source wins:** confuses correction/current state with a later article
  that may describe another interval or simply repeat an older origin.
- **Show only the winning evidence:** prevents independent review and hides the
  exact limitation that justified or defeated a directional Finding.

## P-04 — Time, jurisdiction, and cutoff are explicit scopes

Each versioned material-claim representation and Evidence Set distinguishes:

- the Video's claim time or asserted valid interval;
- the assessment question: historical state, current state, or a stated interval;
- the source's publication and modification times;
- the event/record/data valid time or observation interval described by the
  passage;
- the exact source state and retrieval time; and
- the frozen evidence-retrieval cutoff.

Later-published evidence may establish an earlier historical state when its
passage and authority do so, but it cannot be represented as information that was
available earlier. Evidence published after a frozen evaluation cutoff is excluded
from that run, not silently backfilled. A current-state Finding must not overwrite
what the claim/evidence relationship was at claim time; any current limitation is
explicit and separately dated.

Jurisdiction is `inapplicable`, one or more governed territories, or `unknown`.
For a jurisdiction-bound material element, every counted source must cover the
applicable territory or provide a policy-approved relationship between territories.
Missing or materially mismatched jurisdiction yields
`Unresolved / jurisdiction_indeterminate`, not a generalized result.

The source policy assigns each admitted dependency a `recheck_at` and, when rights
or authority end, a hard expiry. Exact intervals are domain-, source-, and rights-
sensitive human choices; there is no global time-to-live. #388 owns the resulting
freshness and availability transitions.

### Alternatives not recommended

- **Use publication date as the fact date:** a later report may describe older
  data, and an older page may be continuously updated.
- **Always prefer current evidence:** destroys the historical question the Video
  actually asserted.
- **Treat unspecified jurisdiction as global:** overstates evidence and is
  especially unsafe for official, regulatory, geographic, and statistical claims.

## P-05 — Citations bind exact passages to immutable source states

Every external factual assertion in the rationale references one or more
server-issued Evidence Item IDs. Each reference resolves to:

- the source title, responsible publisher/author, canonical identifier/URL, and
  stable identifier when available;
- publication/update date, evidence-valid time, retrieval time, assessment cutoff,
  and applicable jurisdiction;
- the exact minimal Unicode passage plus bounded context and stable offsets in the
  identified source state;
- the passage stance and material claim elements it addresses;
- the Evidence Origin Group and relevant authority/independence limitation;
- a canonical live link and, when authorized, a dated snapshot/state reference;
  and
- a visible changed, unavailable, corrected, superseded, paywalled, or otherwise
  access-limited state.

The exact passage is stored without normalization that changes its Unicode text.
Offsets alone are insufficient for mutable resources; the record also carries the
source-state identity and context needed to detect drift. The excerpt is the
shortest amount necessary to verify the relationship, not a fixed word allowance.
Transcript quotation remains structurally separate from external evidence.

A citation is valid only when its passage supports the adjacent exact assertion.
Every externally checkable rationale assertion must have complete citation
support. A source list at the end, a link to a home page, a passage that merely
mentions the topic, an uncited model bridge, or a citation to an unknown/duplicate/
cross-claim Evidence Item fails validation and publishes no Finding.

This is a discoverability contract, not a screen layout. #390 decides evidence-
first versus relationship-first order, progressive disclosure, mobile behavior,
and assistive presentation, but it may not hide these fields or make a source
count look like confidence.

## P-06 — Rights, access, and source change fail closed without rewriting history

### Acquisition and display

The beta does not bypass paywalls, authentication, technical controls, robots/TDM
reservations, license restrictions, or prohibited acquisition paths. Full fetched
pages are not retained by default. The source-rights ledger controls acquisition,
minimal passage display, internal snapshot, retention, deletion, attribution,
territory, and vendor use separately.

Anonymous, confidential, unverifiable, or inaccessible material cannot be used in
the Learner beta. A lawfully accessed paywalled or restricted source may
corroborate a set only when counsel has approved the exact processing and minimal
display path; it cannot be the sole directional support unless the displayed
passage and metadata make the relationship independently verifiable and the
one-origin exception explicitly allows it. Missing approval is inadmissible, not
a warning the model can waive.

### Change and disappearance

The source monitor compares the canonical resource, redirects, stable identifiers,
publisher version/correction signals, response validators where available, cited
passage, content-state hash, access status, authority status, and rights expiry.
A material or indeterminate change emits one bounded signal such as:

- `source_content_changed`;
- `cited_passage_changed`;
- `source_corrected_or_superseded`;
- `source_unavailable`;
- `source_identity_changed`;
- `source_authority_changed`; or
- `source_rights_expired`.

The signal never edits an Evidence Item or Report Version and never substitutes a
new page. It schedules or admits a new Run under #388 and recomputes freshness.
The dated Report may remain visible with a source-state warning only when the
governed availability and rights policy permits it. A hard rights expiry,
provenance revocation, unsafe source, or unavailable sole support clears/suppresses
current display as #388 requires; older history never becomes current by fallback.

An authorized snapshot preserves reproducibility only for its approved purpose and
retention window. It does not create display rights, establish authority, or
justify retaining prohibited content. When content must be deleted, the ordinary
audit keeps only the non-reconstructive opaque identity and action tombstone
permitted by #388.

### Alternatives not recommended

- **Live link only:** simple, but the cited text can change while the Finding
  appears unchanged.
- **Snapshot everything forever:** reproducible, but violates minimization,
  licenses, privacy, and jurisdiction-specific rights.
- **Silently replace a broken source:** preserves a polished page while destroying
  the evidence actually used and its correction history.
- **Keep the report current with a broken sole citation:** exposes a directional
  result the Learner can no longer verify under its accepted policy.

## Decision table

| ID | Provisional decision | Principal trade-off |
| --- | --- | --- |
| P-01 | Exact versioned Evidence Items with claim-specific authority, origin, scope, rights, and lifecycle | More metadata and policy review, but links/reputation cannot impersonate evidence |
| P-02 | Default two-origin material-element sufficiency plus a narrow predeclared one-origin exception | Conservative abstention and higher retrieval cost, but duplicate URLs and official-looking pages cannot manufacture direction |
| P-03 | Symmetric position retrieval and principled conflict discriminators; otherwise Unresolved | More visible disagreement, but no source-majority vote or fabricated consensus |
| P-04 | Separate claim, valid, publication, source-state, retrieval, cutoff, and jurisdiction scopes | More dates and abstentions, but no temporal leakage or globalized local evidence |
| P-05 | Assertion-level exact-passage citations bound to immutable source states | Higher validation/display cost, but citations remain reproducible and complete |
| P-06 | Rights/access are admissibility; changes create lifecycle signals, never silent substitution | Some reports become stale or unavailable, but history and source rights remain truthful |

## Validation invariants

1. A URL, domain, publisher label, search rank, source count, or provenance record
   alone never makes an item admissible or a set sufficient.
2. Every counted Evidence Item exact-matches one bounded passage in one identified
   source state and addresses named material claim elements.
3. Reports derived from one underlying origin count once for independence. Unknown
   independence is not assumed.
4. A directional Finding satisfies the default two-origin rule or one exact
   predeclared one-origin exception. The model cannot nominate its own exception.
5. Every material support, qualification, and contrary position found by the
   frozen search is retained. Absence of a result is not contradiction.
6. Every required query family and source/jurisdiction slice completes before a
   sufficient result. Supporting-source count cannot terminate contrary search;
   incomplete retrieval is technical failure, not Unresolved or direction.
7. Conflict is resolved only by a recorded, predeclared claim-relevant
   discriminator. Otherwise the Finding is `Unresolved / conflicting_evidence`.
8. Every material claim element has sufficient assertion-level citation support.
   Source lists, topic mentions, and uncited bridge prose fail validation.
9. Claim time, evidence-valid time, publication/update time, source-state time,
   retrieval time, cutoff, and jurisdiction remain distinct. A scope mismatch
   cannot be hidden in a generic as-of date.
10. Missing acquisition, display, snapshot, retention, deletion, or jurisdictional
   authority makes the item inadmissible. The provider cannot override it.
11. Source changes, corrections, unavailability, and rights expiry never mutate an
    Evidence Item or Report Version and never silently substitute evidence.
12. An inaccessible or changed sole support cannot leave a current directional
    Report visible unless the exact governed rights, snapshot, verifiability, and
    availability policy still passes.
13. Evidence Check content never enters Summary or Video Chat grounding, public
    indexing, person/channel scoring, or a global source-reputation record.
14. A source outside the approved evidence-language scope cannot become a cited
    beta Evidence Item through an ungoverned provider translation.

## Stress cases

| Scenario | Required result |
| --- | --- |
| Five articles repeat one company press release. | One origin, not five. The press release establishes what the company said, not the external fact; seek independent evidence or abstain. |
| One low-risk public registry is the constitutive record for an exact current status. | One-origin sufficiency only if that claim type/authority route is predeclared, scope and date match, contrary search is clear, and the citation is lawful and verifiable. |
| A study article, conference abstract, and press release describe the same experiment. | One origin group. Preserve distinct details; do not count them as independent corroboration. |
| A transparent synthesis and two studies included by that synthesis agree. | Record the provenance relationship. Do not count the synthesis and included studies as three naive independent votes. |
| Two independent reports agree on the topic, but neither passage establishes the Video's quantity. | `Unresolved`; topic relevance and source count do not cover the material element. |
| A direct record supports the claim while three derivative articles repeat an older contrary record that was formally corrected. | Apply the authenticated correction/supersession discriminator, preserve the contrary history, and explain the dated scope. |
| Two independent, competent, time- and jurisdiction-fit origins materially disagree with no principled discriminator. | `Unresolved / conflicting_evidence`; show both positions without averaging or choosing a winner. |
| Two supporting origins arrive before the contradiction query times out. | Run failure and no Finding; support count cannot convert incomplete contrary search into sufficiency. |
| Search metadata reveals a material contrary record behind an access control, but no passage can be lawfully verified. | Preserve the access limitation and abstain unless admissible independent evidence establishes that position and the inaccessible item is not otherwise policy-required. |
| A claim concerns 2022, and a 2025 report retrospectively publishes the applicable 2022 data. | The evidence may address the 2022 state, but publication/retrieval remain dated 2025 and cannot be presented as information available in 2022. |
| A source is authoritative for one country but the claim is about another. | Exclude it from directional sufficiency or use it only as explicit context; unresolved if applicable evidence is insufficient. |
| The cited page changes one word outside the passage. | Emit a change signal, compare the identified source state and material scope, and recheck only as policy requires; do not mutate history. |
| The cited passage or its correction changes the material proposition. | `cited_passage_changed` or `source_corrected_or_superseded`; recompute freshness and run a governed recheck. No silent replacement. |
| The only support is now inaccessible and no authorized snapshot/display right remains. | Suppress/clear current display under #388 and seek lawful replacement evidence; the historical tombstone remains content-free. |
| A paywalled article is lawfully retrieved but the beta may not display enough passage to verify the assertion. | It may not be sole directional support. Corroboration only if counsel-approved; otherwise exclude it. |
| An exact passage is visible, but the rationale adds an uncited causal explanation. | Validation failure; citation correctness for one clause does not make the adjacent new assertion complete. |
| The model labels an official page authoritative despite an unknown source-state hash and missing rights record. | Inadmissible; authority prose cannot repair identity or rights. |
| A model translates an otherwise admissible Spanish passage into English and cites only its translation. | Inadmissible in the English-only beta. Preserve it only as a retrieval lead until an approved multilingual source/translation contract exists. |

## Cross-issue dependencies

| Owner | Contract consumed or still required |
| --- | --- |
| #381 — beta decision map | Must incorporate the exact Evidence Item, origin independence, sufficiency, scope, citation, and source-change contract without altering Summary/Chat grounding |
| #382 — Finding semantics | Supplies the four relationships, material-element fidelity, complete Finding, controlled rationale, and no-confidence boundary; this policy supplies deterministic sufficiency inputs |
| #383 — eligibility | Supplies preflight, high-risk/visual exclusions, Not eligible, Partially completed, and Unresolved distinctions; source availability remains a neutral preflight, not a weak Finding |
| #385 — claims and Coverage | Must replace the provisional material-claim identity with its canonical unit/denominator and supply material-element IDs, selection, cap, omissions, and the non-compensatory partial floor consumed here |
| #386 — compliance | Counsel/platform must approve source classes, acquisition, excerpts, snapshots, retention, deletion, notices, and jurisdictions before Learner exposure |
| #387 — evaluation | Must measure document/passage recall, stance, sufficiency, authority, independence, temporal/jurisdictional fit, citation correctness/completeness, contrary retrieval, and change handling separately |
| #388 — lifecycle | Consumes each dependency's recheck/hard-expiry/change signals and controls immutable history, current pointer, availability, corrections, and rights deletion |
| #389 — launch gates | Must set non-compensatory measured thresholds; it cannot replace this policy with a weighted score or make missing authority pass |
| #390 — interaction prototype | Must make exact evidence, material positions, scope, limitations, accessibility/change state, and citations comprehensible without source-count confidence or person-level judgment |

## Open human and counsel choices

This proposal intentionally does not invent:

- the counsel/platform-approved acquisition, quotation, minimal display, snapshot,
  retention, deletion, vendor, and territory rules for each source class;
- the owner-reviewed domain authority registry and reviewer qualifications;
- the exact low-risk claim types and authority routes eligible for the one-origin
  exception;
- the claim types, if any, where secondary-only synthesis may be directional;
- whether any lawful but Learner-inaccessible source may be more than
  corroboration;
- bounded retrieval depth, query families, source-class breadth, and stopping
  rules needed to call the contrary search complete;
- evidence-item and position-display caps, whose presentation belongs to #390;
  or
- source-class recheck windows, hard rights expiries, and the exact material-change
  review boundary.

Each value must be frozen prospectively with an owner, version, scope, and review
path. Missing authority or configuration yields `Unresolved`, `Not eligible`, or a
launch `hold` according to the owning contract; engineering and the provider may
not supply a convenient default.

## Evidence behind the proposal

- [Primary-source research for this decision](../research/2026-08-11-evidence-source-policy.md)
- [Evidence Check policy and legal constraints](https://github.com/xtan9/youtubeai_chat_frontend/blob/db5a2be6c57b0771c2cc67f9dee383556a318c07/docs/research/2026-08-10-evidence-check-policy-legal-constraints.md)
- [Evidence Check evaluation and calibration](https://github.com/xtan9/youtubeai_chat_frontend/blob/15209cf2e4d0737f1d097c3224ab6fa0abc6112d/docs/research/2026-08-10-evidence-check-evaluation-calibration.md)
- [Evidence Finding semantics](./2026-08-11-evidence-finding-semantics-proposal.md)
- [Evidence Check lifecycle](./2026-08-11-evidence-check-lifecycle-proposal.md)
