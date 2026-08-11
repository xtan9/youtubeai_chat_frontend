# Evidence workspace interaction prototype

**Issue:** #390

**Status:** Throwaway, fixture-only prototype for owner review

**Route:** `/summary?evidencePrototype=1` in a non-production Next environment

## Question answered

How can an opt-in, asynchronous Evidence Check become a peer of Summary,
Transcript, and Chat without turning a report into a truth score or overwhelming
the existing single-Video workspace?

The prototype keeps one orientation layer in every state:

1. **where the learner is** — the Evidence peer tab and Video title;
2. **what state the work is in** — request, named progress, terminal no-report,
   dated report, recheck, correction, or availability action;
3. **what was examined** — exact Coverage numerator and denominator, central and
   consequential breakouts, and explicit governed exclusions;
4. **what a Finding means** — bounded Transcript context, one Evidence
   Relationship, rationale, every material Evidence Origin, exact passages,
   source identities, scope, and limitation;
5. **what it does not mean** — no author verdict, accuracy score, source-count
   confidence, percentage progress, ETA, or model/provider detail.

This route never calls an API and does not persist state, emit analytics, access a
database, or invoke a model. It is excluded from production by a server-side
`NODE_ENV` guard.

## Three structural variants

| Variant | Structure | Strength | Risk |
| --- | --- | --- | --- |
| **A · Claim desk** | Coverage and claim rail beside a persistent Finding reading surface; the rail precedes the Finding in the mobile document | Strongest orientation and clearest claim → exact evidence path | A long claim rail delays detail on a phone unless later reduced to a disclosure or jump control |
| **B · Coverage ledger** | Full Coverage first, then a relationship-scannable ledger and the selected Finding below | Fastest report-level audit and easiest exclusion discovery | Relationship-first scanning can invite score-like reading before rationale and scope |
| **C · Guided dossier** | One complete Finding at a time with previous/next and a compact chapter index | Lowest mobile cognitive load and strongest progressive disclosure | Hides cross-claim patterns and makes report-wide comparison slower |

### Recommendation

Advance **A · Claim desk** as the provisional beta-study direction, retaining its desktop rail but
replacing the full mobile rail with a compact current-claim disclosure/jump sheet
in a production implementation. It made Coverage persistently discoverable while
keeping claim, Transcript, passage, scope, and limitation in one reading context.
Variant B is a useful audit affordance but should not be the default. Variant C is
an appropriate narrow-screen fallback pattern, not the only report structure.
This is a prototype recommendation, not launch evidence: P-04 still requires
owner-approved observations from real participants before production selection.

## Fixture states

Use the bottom control bar to switch independently between layout and lifecycle:

- `Request` — opt-in purpose and 8–15 material-claim boundary; visual dependency
  is described as an eligibility exclusion, never as abstention;
- `In progress` — durable named stages only; no percent, ETA, draft, or provider detail;
- `Waiting for sources` — a distinct durable waiting stage that survives leaving
  and returning, with neither a percentage nor a completion estimate;
- `Completed report` — a valid `partially_completed` report with complete Findings
  for all 10 eligible entries plus two explicit Consequential Excluded entries.
  The 12-entry inventory exposes every Finding and both exact exclusion anchors and
  governed reasons (`visual_dependency` and `pending_prediction`); no impossible
  cap omission is shown below the 15-unit selector cap;
- `Recheck due` — a clearly dated report remains accessible but is not represented
  as current-status evidence; starting recheck never replaces it with a spinner;
- `Corrected report` — immutable current and superseded versions plus a bounded
  before/after relationship explanation;
- `Not eligible` — no report and no Retry for a Transcript-inadequate visual demonstration;
- `Retryable failure` — no report or Finding, with a bounded single-use Retry action;
- `Expired report` — no active assessment, a content-free audit shell, and no
  fallback resurrection;
- `Temporarily suppressed` — the complete report is hidden while review is pending;
- `Withdrawn report` — final unavailability with only a content-free history shell.
- `Private notices` — generic in-app completion, failure, recheck, correction,
  suppression, not-eligible, restoration, withdrawal, and authorized Case
  disposition notices; private state is disclosed only after explicit account
  reauthorization;
- `Comprehension study` — a seeded wrong Finding and executable correction task
  across bounded scope, Evidence Relationship, Unresolved, Coverage,
  Confidence-unavailable, and speaker-overreliance concepts. It is explicitly a
  simulated protocol with no human participant or launch evidence.

## Review URLs

- Claim desk / report: `/summary?evidencePrototype=1&variant=claim-desk&fixture=report`
- Coverage ledger / stale: `/summary?evidencePrototype=1&variant=coverage-ledger&fixture=recheck`
- Guided dossier / correction: `/summary?evidencePrototype=1&variant=guided-dossier&fixture=corrected`

Left and right arrow keys cycle variants only while the explicitly labelled
prototype canvas itself has focus. Radix workspace tabs retain their own arrow-key
navigation, and links, buttons, summaries, selects, and other interactive/ARIA
widgets never trigger a layout change. The fixture selector changes only in-memory
state.

## Contract coverage

The prototype consumes the merged decisions rather than redefining them:

- #382 supplies complete, auditable Finding fields and the canonical dated
  Relationship language: Supported/Qualified/Conflicts **by retrieved evidence**,
  or Unresolved. The fixtures use Conflicts when any asserted material quantity or
  quantifier is contradicted; the single Qualified fixture has every asserted
  material element supported plus a noncontradictory tested-scope boundary;
- #384 supplies exact passage/source identity, independence, scope, limitations,
  material positions, snapshot/change context, and no source-count confidence.
  Every directional fixture has two genuinely independent, claim-complete Evidence
  Origins; the Unresolved fixtures retain incomplete admissible evidence without
  pretending it establishes a direction;
- #385 supplies the Coverage numerator/denominator, Central floor, selected-claim
  completeness, exact Excluded entries, the 8–15 selector envelope, and no padding
  or aggregate score. Every one of the 12 countable entries displays its distinct
  replay-stable Material Inventory Entry ID. The 10 eligible entries additionally
  display distinct Claim Unit IDs; the two Excluded entries never receive one;
- #388 supplies durable run stages, report/current-pointer separation, recheck,
  expiry, suppression, withdrawal, Retry, immutable history, and correction semantics;
- #389 keeps exact confidence unavailable, makes comprehension a launch gate, and
  prevents a passing metric from authorizing rollout. The P-04 fixture records an
  executable six-concept response and an explicit overreliance observation; it
  does **not** claim that a real participant has passed.

## Verification seams

- Component tests exercise the peer tabs, exact report vocabulary, all 12 unique
  inventory-entry IDs, the 10 unique eligible Claim Unit IDs, all independent
  origins on every directional Finding, waiting, private notice
  reauthorization, executable comprehension, recheck, correction, Unresolved,
  availability states, Retry, and keyboard-safe variant controls.
- Playwright exercises 320 px, 390 px, and 1280 px viewports; verifies no horizontal
  or nested report scroller, no API calls, hydrated claim navigation, exact evidence
  inspection, all three structures at every viewport, representative lifecycle
  switching at both mobile widths, fixed-control non-occlusion/focus order, and
  the seeded comprehension task.
- The prototype deliberately uses document flow on phones. Only the global workspace
  tab rail and prototype control bar are sticky/fixed.

## Open owner decisions

1. Confirm Variant A as the production direction, or choose B/C for a subsequent
   implementation issue.
2. Choose whether the exact source passage starts open, as prototyped, or opens on
   demand after comprehension testing.
3. Approve the learner-facing terms “material claim,” “Evidence Coverage,” and
   “Evidence Relationship” for the beta study; the machine contract is not changed
   by copy experiments.
4. Choose the production mobile claim selector (disclosure, sheet, or compact
   previous/next header) after observed 320/390 px testing.
5. Approve the final notice placement and icon/color treatment only after the
   #389 comprehension and accessibility gates; text and non-color cues remain required.
6. Run the owner-approved P-04 protocol with real participants. This prototype
   supplies the seeded task, wrong-answer observation, and pass criteria, but no
   human observation has occurred, so the production recommendation remains
   provisional.

No choice here authorizes persistence, entitlement, notifications, analytics, or
learner rollout. Those remain with their owning implementation and release decisions.
