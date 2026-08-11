# Evidence Check source-policy research

**Decision ticket:** [#384](https://github.com/xtan9/youtubeai_chat_frontend/issues/384)

**Research question:** What primary-source evidence supports a reproducible policy
for source sufficiency, authority, independence, temporal and jurisdictional fit,
conflict handling, exact citations, and inaccessible or changing sources?

This note supplies evidence for a product decision. It does not itself authorize
source use, public launch, or a universal hierarchy of publishers.

## Findings

### Citation quality is claim-adjacent and end to end

ALCE evaluates citation correctness separately from citation completeness: a
citation must support the adjacent assertion, and externally checkable assertions
must not go uncited. Its authors also found substantial room for improvement even
in strong systems, so a link-shaped model response is not adequate evidence of a
valid citation. ([Gao et al., EMNLP 2023](https://aclanthology.org/2023.emnlp-main.398/))

AVeriTeC likewise treats a claim as accurately verified only when both the result
and the retrieved evidence meet the evaluation threshold. The product should
therefore validate the complete claim/evidence relationship, not a relationship
label and a source list independently. ([Schlichtkrull et al., FEVER
2024](https://aclanthology.org/2024.fever-1.1/))

The repo's evaluation research translates those findings into separate document
and passage retrieval, citation correctness, citation completeness, evidence-set
sufficiency, authority, independence, freshness, and contrary-evidence measures.
([Evidence Check evaluation and calibration](https://github.com/xtan9/youtubeai_chat_frontend/blob/15209cf2e4d0737f1d097c3224ab6fa0abc6112d/docs/research/2026-08-10-evidence-check-evaluation-calibration.md))

**Implication:** every material assertion in a Finding rationale must be supported
by a governed evidence item whose exact passage entails that assertion. A
directional Finding needs a sufficient complete evidence set; valid individual
citations do not compensate for an uncovered material claim element.

### Source count must count independent origins, not reports

The European Fact-Checking Standards Network requires relevant supporting and
undermining evidence, primary sources where suitable, and normally at least two
sources for the central claim, with an explanation when only one relevant source
exists or secondary sources must be used. It also requires enough access for a
reader to replicate the verification. ([EFCSN Code of
Standards](https://efcsn.com/code-of-standards/))

Cochrane's handbook warns that one study may generate several reports and requires
those reports to be collated so the study, rather than each publication, remains
the unit of interest. Conflicting reports are retained, and the choice of the
primary report must be justified. ([Cochrane Handbook, Chapter
4.6](https://training.cochrane.org/handbook/current/chapter-04))

**Implication:** two URLs are not necessarily two sources. Reports that derive
from the same study, dataset, press release, wire report, official record, or
named expert must share an origin group and count once for independence. Unknown
independence is not assumed; it is treated conservatively as one origin and shown
as a limitation.

The cited standards do not establish one universal primary-over-secondary
hierarchy. What is direct and competent depends on the proposition: a statute is
authoritative for enacted text in its jurisdiction, a registry for its recorded
state, an original study for what that study did, and a governed synthesis for
what its stated evidence base supports. Publisher reputation alone does not make
a source authoritative for every claim.

### Supporting and contrary evidence require symmetric treatment

EFCSN requires relevant evidence that appears to support the claim and relevant
evidence that appears to undermine it. Cochrane requires an explicit procedure
for resolving discrepant extraction and says unresolved disagreement should be
reported rather than silently discarded. ([EFCSN Article 2](https://efcsn.com/code-of-standards/),
[Cochrane Handbook, Chapter
5.5](https://training.cochrane.org/handbook/current/chapter-05))

**Implication:** retrieval must search separately for support, qualification, and
contradiction, and preserve the material positions found. Source majority is not
an adjudication rule. A conflict may be resolved only by a predeclared,
claim-relevant discriminator such as competence for the exact fact, directness,
methodological fit, independence, applicable time, applicable jurisdiction, or a
documented correction/supersession. Otherwise the result is governed
`Unresolved / conflicting_evidence`.

### Time is part of the evidence relationship and source identity

Temporal fact-verification research shows that publication dates and time
expressions materially affect claim/evidence reasoning. TSVer separately annotates
claim time frames, evidence time series, and justifications, and reports that
current frontier models remain challenged by this reasoning. ([Allein et al.,
EACL 2023](https://aclanthology.org/2023.findings-eacl.13/), [Strong and Vlachos,
EMNLP 2025](https://aclanthology.org/2025.emnlp-main.1519/))

The W3C Web Annotation model provides a `TimeState` for the version of a mutable
resource from which a selection was made. RFC 7089 defines datetime-based access
to prior web-resource states and distinguishes an original resource from a dated
Memento. ([W3C Selectors and States](https://www.w3.org/TR/selectors-states/),
[RFC 7089](https://www.rfc-editor.org/info/rfc7089/))

**Implication:** claim time, evidence valid time, source publication/update time,
source-state time, and retrieval cutoff are separate fields. Later evidence may
describe an earlier state, but it cannot be presented as information available at
that earlier time. A Finding must state which time or interval and which as-of
cutoff it assesses.

Jurisdictional fit follows the same non-compensatory principle. A competent record
for one territory cannot establish a materially jurisdiction-bound proposition in
another. Missing or ambiguous jurisdiction produces the already governed
`jurisdiction_indeterminate` abstention instead of a globalized directional
Finding.

### Exact passages need a stable target and source state

W3C defines a `TextQuoteSelector` with exact text plus optional prefix and suffix,
and a `TextPositionSelector` with start/end offsets. It recommends combining
position selection with a source state because mutable documents can invalidate
bare offsets. ([W3C Selectors and States](https://www.w3.org/TR/selectors-states/))

W3C PROV distinguishes versions, derivation, quotation, generation, and
invalidation. Its provenance-access guidance also cautions that a provenance
record is not itself guaranteed to be authoritative or correct. ([W3C PROV
namespace](https://www.w3.org/ns/prov), [PROV-AQ](https://www.w3.org/TR/prov-aq/))

**Implication:** an evidence item binds the exact Unicode passage and its bounded
context/offsets to a content-identified source version. Provenance is necessary
for audit and change detection, but it never substitutes for passage entailment or
source-policy validation.

### Rights and accessibility are admissibility gates

U.S. copyright law has no fixed safe quotation length; criticism, comment,
scholarship, and research are purposes considered under a multi-factor fair-use
test. EU commercial text-and-data mining depends on lawful access and may be
reserved by rights holders. ([17 U.S.C. §§102, 105–107](https://www.copyright.gov/title17/92chap1.html),
[Copyright Office fair-use guidance](https://www.copyright.gov/fair-use/more-info.html),
[Directive (EU) 2019/790, Articles 4 and
15](https://eur-lex.europa.eu/eli/dir/2019/790/oj/eng))

The repo's policy research consequently requires the shortest passage necessary,
canonical attribution and dates, a source-rights ledger, no bypass of access or
technical controls, no full-page persistence by default, and rights-bounded
snapshots and retention. ([Evidence Check policy and legal
constraints](https://github.com/xtan9/youtubeai_chat_frontend/blob/db5a2be6c57b0771c2cc67f9dee383556a318c07/docs/research/2026-08-10-evidence-check-policy-legal-constraints.md))

**Implication:** inaccessible, confidential, anonymous, or display-prohibited
material cannot be the sole learner-facing support in the beta. A paywalled or
otherwise restricted source may be retained as corroboration only when access,
processing, minimal display, retention, and deletion are lawful and the remaining
visible evidence is independently sufficient. Counsel may later authorize a
narrower exact path; engineering cannot infer it.

### Source change is a lifecycle signal, not permission to rewrite history

W3C's time-state and provenance models distinguish a resource, a dated state, a
revision, and invalidation. They support retaining the identity of what was used
even after the live resource changes. NIST's AI RMF separately calls for validity,
reliability, limitations, ongoing evaluation, and fail-safe behavior under the
conditions of intended use. ([W3C Selectors and States](https://www.w3.org/TR/selectors-states/),
[W3C PROV](https://www.w3.org/ns/prov), [NIST AI RMF
1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10))

**Implication:** a redirect, disappearance, correction, cited-span change,
license change, or authority change creates a versioned `source_changed` or
`source_unavailable` signal. It never mutates an immutable Finding or silently
replaces the evidence item. The #388 lifecycle decides whether the dated Report
remains visible, becomes stale, is suppressed, or is rechecked; expired rights or
an unavailable sole support fail closed.

## Recommended decision shape

1. Use a versioned, domain-specific authority policy rather than a global source
   reputation score.
2. Require two independent origin groups for a directional central claim by
   default. Permit one-source sufficiency only for a predeclared narrow claim type
   where one competent record is constitutive or uniquely authoritative and a
   contrary-evidence search finds no material conflict.
3. Count reports from one underlying origin once. Preserve their differing details
   without treating publication count as corroboration.
4. Validate the complete material proposition against exact passages. Search and
   display material supporting, qualifying, and contrary evidence symmetrically.
5. Abstain when authority, independence, material-element coverage, temporal fit,
   jurisdictional fit, lawful access, or a principled conflict discriminator is
   missing.
6. Bind each citation to an immutable source-state identity, exact passage,
   context/offsets, origin group, dates, jurisdiction, rights basis, and
   recheck/expiry policy.
7. Treat inaccessible or changed sources as explicit lifecycle inputs. Never
   preserve a directional relationship by silently swapping evidence.

## Decisions that research cannot make

- counsel-approved acquisition, excerpt, snapshot, display, retention, and
  deletion paths by source class and launch jurisdiction;
- the owner-reviewed registry of competent source authorities by claim domain;
- the narrow claim types allowed to use the one-source exception;
- whether a lawful but learner-inaccessible source may ever be more than
  corroboration;
- bounded retrieval depth, contrary-search stopping rules, and evidence-display
  caps; and
- source-class recheck windows and hard rights expiries.

Missing approval for any applicable item remains a launch blocker, not a default
for the implementation to invent.
