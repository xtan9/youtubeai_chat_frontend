# Evidence Check rollout gates proposal

**Decision ticket:** [#389](https://github.com/xtan9/youtubeai_chat_frontend/issues/389)

**Parent map:** [#381](https://github.com/xtan9/youtubeai_chat_frontend/issues/381)

**Status:** Owner-reviewed provisional proposal; independent review and the named
observed-data/counsel choices remain open

Passing a Gate Packet does not itself change a feature flag, entitlement, or
publication state.

## Inherited boundaries

- #382 defines an Evidence Finding as one evidence-relative relationship:
  `supported`, `qualified`, `conflicts`, or `unresolved`. It forbids truth,
  speaker-intent, author-reliability, and model-certainty framing.
- #383 makes eligibility, `not_eligible`, `partially_completed`, and governed
  abstention reasons separate from technical failure.
- #386 permits rights-cleared internal evaluation but blocks a Learner beta until
  lawful Transcript sourcing, written YouTube approval, and counsel approval are
  complete. A metric cannot compensate for missing launch authority.
- #387 makes the frozen Video-first, human-adjudicated gold set the launch
  authority. Public benchmarks are regression suites, not launch judges. The
  primary safety statistic is the upper confidence bound on silent consequential
  error, always reported beside Coverage.
- #388 separates mutable Runs from immutable atomically published Report Versions
  and keeps cost, entitlement, retry, correction, freshness, and availability
  auditable rather than collapsing them into a success rate.

## P-01 — Govern each rollout action with a versioned Gate Packet

There is no single Evidence Check launch score. Each proposed action is evaluated
by an immutable **Gate Packet** for one named system version, policy bundle,
eligible population, observation period, and intended action:

- continue or stop internal shadow evaluation;
- open or hold the private Learner beta;
- expand or reduce the beta population or topic/jurisdiction scope;
- add, remove, or change entitlement;
- begin, continue, or stop an aggregate-score experiment;
- pivot to a narrower product or source model; or
- pause or stop the feature.

The packet contains the exact frozen metric definitions, dataset and cohort
versions, evaluation pipeline and reviewer rubric versions, exclusions, slices,
numerators and denominators, estimates, relevant one-sided 95% confidence bounds,
minimum sample requirements, allowed regression from the last accepted system,
evidence dates, owner, and remediation path. A later measurement appends a new
packet; it does not rewrite the decision evidence used previously.

### Measurement grammar

Every passing rule is one of three predeclared measurement classes. A packet may
not switch classes after observing its decision data.

1. **Frozen-study estimator.** Claim, citation, relationship, comprehension,
   overreliance, and other sampled-study metrics use the frozen #387 population
   and exclusions. Binary rates are the ratio of rubric-positive eligible units
   to all rubric-eligible units. F1 uses the harmonic mean of precision and
   recall from the frozen confusion matrix. The packet uses 10,000 deterministic
   cluster-bootstrap resamples of whole Videos and reports the relevant
   one-sided 95% percentile bound: the fifth percentile for a lower-bound rule
   and the ninety-fifth for an upper-bound rule. A required slice is independently
   resampled and must meet its own minimum sample. URL resolution is resolved
   canonical citation URLs divided by all canonical citations in the frozen
   sample, with no provider, locale, or failure exclusion, and its lower bound
   must meet the stated threshold. A zero-event rule is a separately named hard
   invariant and still reports its exposure denominator and one-sided upper bound.
2. **Finite-window production census.** Operational, cost, correction, support,
   and demand metrics count every governed event in the stated UTC window after
   only the named exclusions. Rates use the stated numerator divided by that
   census denominator; means are arithmetic means; p95/p99 use nearest-rank
   empirical quantiles over all eligible observations. These are complete-window
   controls, not population estimates, so they pass on the stated census value
   and additionally report a one-sided 95% bound when the rule names one.
   A named bound uses 10,000 deterministic cluster-bootstrap resamples, clustered
   by Learner for Run/demand outcomes and by Report lineage for publication or
   correction outcomes, with the same fifth/ninety-fifth percentile convention.
   Missing, late, unattributed, or schema-invalid events are failures or
   attribution gaps, never silently excluded.
3. **Hard invariant.** Authority, privacy, invalid-publication, fabricated-
   citation, deletion/suppression, budget-cap, and other rules explicitly marked
   zero-event or exact require a complete governed census and tolerate no event.
   A zero-event proportion reports the exact one-sided 95% Clopper-Pearson upper
   bound over its stated exposure denominator.

For any comparison or non-inferiority rule, the estimand is the predeclared
difference on the same eligible units and the pass decision uses the adverse
one-sided cluster-bootstrap bound. "Overall" never substitutes for a required
slice. An absent denominator, incomplete window, invalid event, or unpowered
resample yields `hold`.

### Non-compensatory gates

Every action packet has a **universal veto core**: authority for the exact data
and action scope, privacy and cross-Learner isolation, immutable provenance and
reproducibility, content-free authorized audit, a working containment path, and
the applicable hard budget ceiling. Failure or missing evidence in that core
blocks every action, including internal shadow work.

Beyond that core, a packet includes each family applicable to the proposed
action. Strong performance in one applicable family cannot offset failure or
missing evidence in another:

1. **Authority and compliance** — Transcript/source authority, written platform
   approval, counsel-approved jurisdictions, presentation, correction, privacy,
   retention, deletion, and vendor paths.
2. **Safety and integrity** — silent consequential error, fabricated or
   misattached citations, temporal leakage, prompt injection/control-flow
   violations, prohibited person/channel scoring, and correction/suppression
   failures.
3. **End-to-end evidence quality** — material-claim discovery, normalization,
   evidence sufficiency, relationship correctness, citation correctness and
   completeness, Coverage, and governed abstention.
4. **Learner comprehension** — factual decision quality, overreliance, and correct
   understanding of Evidence Relationship, Coverage, abstention, and the
   claim-level rather than person-level scope.
5. **Operational fitness** — completion and failure modes, latency, freshness,
   correction service, deletion operations, and bounded retry behavior.
6. **Economic and product evidence** — actual marginal cost, demand, use,
   observed return/retention, correction burden, and support burden for the exact
   eligible cohort.

`not_applicable` is allowed only when the packet demonstrates that the family has
no causal path to the proposed action: for example, Learner comprehension and
return are not applicable to content-never-published internal shadow evaluation,
and demand is not applicable to first private-beta exposure. It records the
structural reason and approving authority. A missing, stale, underpowered, or
failing applicable gate can never be relabeled `not_applicable`. Learner launch
and continued exposure always require families 1 through 5; expansion requires
all six; entitlement and aggregate-score actions require the exact families in
the action table below.

Unknown, stale, underpowered, or non-reproducible blocking evidence yields
`hold`. It never silently passes and cannot be imputed from a different cohort.
Passing produces only `eligible_for_owner_review`; a separately authorized human
decision is required before any flag, entitlement, audience, jurisdiction, or
report format changes.

### Decision authority

Three kinds of thresholds must remain visibly distinct:

- **Evidence-derived:** a pilot and power analysis determine whether a proposed
  operating point, confidence bound, sample, slice, and non-inferiority margin can
  detect the governed harm. Candidate numbers from research are hypotheses to
  test, not inherited facts.
- **Owner-selected:** risk appetite, latency objective, cost and system-budget
  ceilings, retry caps, demand thresholds, entitlement economics, audience size,
  and observed-return requirements are predeclared before evaluating the packet.
- **Counsel/platform-authorized:** lawful Transcript/source routes, jurisdictions,
  retention and appeal obligations, wording, and platform approval are binary
  prerequisites whose scope cannot be inferred from quality metrics.

Retention is reported first as observed, cohort-qualified D7/D30 return and usage
behavior. No launch or expansion target is invented from an unobserved baseline.
An owner may set a target only prospectively, after measurement is available and
before the decision cohort is evaluated.

### Alternatives not recommended

- **One weighted product score:** simple to rank, but it permits high citation or
  demand performance to conceal a catastrophic safety, quality, or compliance
  failure.
- **One universal checklist for every action:** preserves vetoes but incorrectly
  demands the same maturity for internal shadow work, a narrow beta, an
  entitlement change, and a public aggregate-score experiment.
- **Automatic rollout when metrics pass:** confuses reproducible decision evidence
  with the accountable human authorization required to change exposure.

## P-02 — Scheduled promotion and narrow asynchronous containment are separate

Promotion and containment have different evidence requirements. Launch,
expansion, entitlement, and aggregate-score changes occur only at a scheduled
decision window with a complete, adequately powered Gate Packet and explicit
owner and, where applicable, counsel/platform authorization. A rolling metric,
alert, successful deployment, or automatic evaluator can never promote exposure.

A server-owned `controlled_pause` may stop new Learner Runs before the next
scheduled packet only for a confirmed deterministic hard-invariant breach:

- a required authority, retention, deletion, or vendor-propagation path is absent,
  expired, revoked, or unhealthy beyond its governed bound;
- cross-Learner disclosure or another confirmed privacy boundary breach;
- provider delta, candidate, invalid Finding, or other unvalidated content reaches
  a Learner or editorial persistence;
- the frozen validator or authorized audit proves a fabricated or misattached
  citation, forbidden post-date evidence, or provider instruction controlling the
  product result;
- the correction, suppression, or emergency kill-switch path is unavailable; or
- the predeclared system budget or spend ceiling is exhausted.

A versioned sequential safety rule may also pause when its predeclared one-sided
confidence bound and minimum sample requirement fire. The rule, population,
look frequency, multiplicity control, and containment action must be frozen before
observing the decision cohort. Point estimates, support anecdotes, isolated demand
dips, and ordinary regressions instead produce `hold_expansion` and an
investigation until a complete Gate Packet exists.

### Trigger-specific containment

- Unsafe or unvalidated candidate content is aborted and never published.
- An authority, rights, privacy, provenance, correction, or safety concern pauses
  new Runs and applies #388's report-only availability lifecycle to affected
  Report Versions.
- A cost ceiling closes new admission but permits already reserved, bounded work
  to settle unless an independent safety reason requires cancellation.
- A narrow affected cohort may be disabled only when the isolation key and
  containment are themselves validated; uncertainty fails closed to the broader
  governed scope.

Each pause records only content-free trigger kind, affected policy/system/cohort
versions, authority, evidence-packet reference, time, containment, and remediation
state. Delivery is idempotent. Recovery never occurs by timeout, alert clearance,
or metric rebound alone: remediation, a new passing packet for every breached
gate, and explicit human resume authorization are all required. `stop` and `pivot`
remain owner/counsel decisions; an incident monitor cannot silently redefine the
product.

### Alternatives not recommended

- **Scheduled packets only:** too slow for a confirmed privacy, publication,
  authority, deletion, or budget-control failure.
- **Any metric can auto-stop:** lets noisy or repeatedly inspected point estimates
  thrash product state without statistical or human accountability.
- **Auto-resume after a quiet period:** mistakes absence of a new alert for evidence
  that the breached invariant was repaired.

## P-03 — Predeclare separate beta and expansion quality profiles

The following numbers are provisional owner risk choices and study-design targets,
not scientific facts or claims inherited from public benchmarks. A pilot must
estimate clustering within Videos and power the final gold-set sample and required
slices against them. Wider-than-planned achieved intervals, insufficient slice
counts, or an underpowered pilot yield `hold`; they never waive a threshold.

The recommended planning range for the private beta is 250–350 Videos and
2,000–3,500 material claims. It is a budget range, not a substitute for the pilot
power analysis. Every metric reports its exact numerator and denominator, system
and rubric version, and Video-clustered estimate and confidence interval.

### Private Learner beta

| Gate | Provisional passing rule |
| --- | --- |
| Material-claim recall | Lower one-sided 95% bound at least 0.80 overall and 0.70 in every required slice; no published report violates #385's non-compensatory central-claim/partial-publication floor |
| Normalization faithfulness | Lower bound at least 0.95 and zero observed polarity, quantity, entity, attribution, or conjunction reversals |
| Citation integrity | Lower bound at least 0.95 for correct claim-to-passage attachment; URL-resolution lower bound at least 0.99; zero fabricated or misattributed citations and zero forbidden temporal leakage |
| Contrary-evidence handling | Recall lower bound at least 0.85 on the frozen conflict-enriched set |
| Evidence Relationship | `conflicts` precision lower bound at least 0.90; each required relationship class has an F1 lower bound at least 0.75 |
| Selective prediction | Upper one-sided 95% bound on silent consequential error at most 0.05 while claim Coverage lower bound is at least 0.60 |
| Abstention and eligibility | Correct-abstention lower bound at least 0.90 independently for each governed ineligible, unreliable-Transcript, missing-visual, and insufficient-evidence reason; a directional Finding where abstention was required is consequential error |
| Adversarial and temporal integrity | Zero observed provider-instruction control-flow violations, poisoned-evidence acceptance, or post-cutoff evidence leakage in the frozen suites |

Zero-observed rules are hard product invariants, not claims of zero population
risk. The packet still reports their sample and confidence bound. Any confirmed
production occurrence follows P-02 containment.

### Expansion

Expansion means any larger audience, new topic/domain, new Transcript/source path,
or new jurisdiction. The proposed cohort and every new slice must pass its own
packet; it cannot borrow the beta cohort's average.

| Gate | Provisional passing rule |
| --- | --- |
| Material-claim recall | Lower bound at least 0.90 overall and 0.85 for central claims in every required slice; #385's report floor remains a veto |
| Normalization faithfulness | Lower bound at least 0.98 and the same zero-reversal invariant |
| Citation integrity | Correctness lower bound at least 0.98 and completeness lower bound at least 0.95; all beta hard invariants remain |
| Contrary-evidence handling | Recall lower bound at least 0.90 |
| Selective prediction | Consequential-error upper bound at most 0.02 while Coverage lower bound is at least 0.75 |
| Abstention | Correct-abstention lower bound at least 0.95 plus a prospectively owner-set unnecessary-abstention ceiling |
| Regression | No consequential regression against the last accepted system overall or in a required slice |

Required slices include Evidence Relationship, claim importance, eligibility and
abstention reason, topic, Transcript provenance and quality, temporal sensitivity,
evidence-source class and count, and launch cohort. The pilot may add a slice when
it discovers a plausible harm boundary; it may not pool away a failing predeclared
slice.

### Calibration and confidence boundary

Beta confidence remains server-owned `unavailable` under #382. The accepted count
of provider/model confidence or certainty fields and prose is zero; their presence
rejects the candidate rather than becoming a learner-visible score. The internal
abstention operating point is selected once on a held-out calibration split and
frozen with the complete model, prompt, retriever, source, Transcript, and
validator bundle before the final test.

P-03's consequential-error upper bound and Coverage lower bound are the blocking
calibration-at-operation thresholds. Reliability diagrams, ECE, Brier score,
per-class calibration, AURC, and AUGRC are reported diagnostics, not compensatory
launch scores. No ECE threshold makes confidence visible. A future visible
reviewer-agreement probability requires its own population/versioned calibration
decision and remains `hold`; an aggregate report experiment follows P-04 and is
not model confidence.

### Alternatives not recommended

- **Choose thresholds after seeing final-test output:** permits target moving and
  makes the confidence interval meaningless as a launch decision.
- **Use only overall accuracy:** hides central-claim omission, selective refusal,
  relationship imbalance, and Transcript/source failures.
- **Adopt public benchmark cutoffs:** those scorers do not measure the product's
  claim selection, source policy, temporal integrity, or Learner-facing behavior.

## P-04 — Behavioral safety precedes expansion and aggregation

Satisfaction, reported trust, source opening, and task time cannot establish that
the product helps Learners reason correctly. The behavioral study is preregistered,
randomized, includes seeded incorrect Findings whose evidence permits correction,
and compares the complete Evidence Check experience with a no-Evidence-Check
control. Study populations, exclusions, literacy/accessibility slices, primary
outcomes, margins, stopping rules, and analysis are frozen before unblinding.

The following margins are provisional owner risk choices, not published scientific
standards. The pilot must power the clustered study against them; inadequate power
or an underpopulated required slice yields `hold`.

### Private beta comprehension packet

- The lower 95% bound on the Evidence Check minus control factual-decision-
  accuracy difference must be greater than -5 percentage points.
- The upper 95% bound on the overreliance-rate difference must be less than +5
  percentage points. Overreliance means accepting a wrong directional Finding
  when the displayed evidence permits correction.
- The lower 95% bound must be at least 0.80 independently for correct explanation
  of each concept: claim-level scope rather than author truth/reliability;
  Evidence Relationship rather than truth; `Unresolved`/abstention; Coverage and
  omission; and server-owned `confidence: unavailable`.
- No required accessibility, literacy, or demographic slice may have a factual-
  accuracy or overreliance estimate more than 10 percentage points beyond the
  relevant adverse direction. An underpowered slice is studied or held separately,
  not pooled away.

This is a non-inferiority gate for a narrow private beta, not proof of product
benefit.

### Expansion comprehension packet

Expansion additionally requires the lower 95% bound on the predeclared factual-
comprehension or decision-accuracy primary benefit to exceed zero. The upper bound
on overreliance-rate difference must be below +2 percentage points, and each of
the five concept-comprehension lower bounds must be at least 0.90. All beta safety
and subgroup gates remain non-compensatory.

### Aggregate-score experiment

An aggregate-score experiment is not part of beta launch or ordinary expansion.
It is eligible for owner review only after the expansion technical and
comprehension gates pass, Finding behavior is calibrated on a held-out versioned
gold set, counsel approves the exact definition and wording, and #385 supplies a
non-gameable Coverage denominator. The score is private and report-level only; it
never rates a person, speaker, creator, channel, or general trustworthiness.

The report-with-score arm runs behind an independent flag against the unchanged
claim-level report. Continuing the experiment requires one predeclared useful
benefit: either a factual-comprehension/decision-accuracy lower bound above zero or
a task-time improvement lower bound of at least 10%. It must also keep factual
accuracy non-inferior at a -2-point margin, overreliance upper bound below +2
points, scope-comprehension lower bound at least 0.90, correction rate below
P-07's limit, and every subgroup adverse bound within 5 points. Complaint and
Intake volumes remain descriptive workload signals because P-07 deliberately
does not treat allegations as votes or define an unsupported complaint-rate gate.
Failure removes the score without changing Findings, Coverage, or the ordinary
report lifecycle.

### Alternatives not recommended

- **Require demonstrated benefit before a private beta:** produces stronger value
  evidence but overpowers an exploratory, tightly bounded exposure before the
  operating point has real usage data.
- **Use usability or self-reported trust as the beta gate:** misses the documented
  risk that persuasive explanations increase reliance on wrong output.
- **Ship a score with the claim report:** prevents causal measurement and makes a
  harmful aggregation difficult to remove independently.

## P-05 — Bound beta operations, retries, and spend before exposure

The following limits are conservative owner-set beta exposure controls, not
research findings. The packet reports exact denominators, exclusions, stage-level
failure reasons, and confidence bounds; it cannot call an eligibility decline,
idempotent join, or Learner cancellation a platform success or failure.

### Private beta operating packet

The operating census is the trailing seven complete UTC days ending at the
packet cutoff. Its Run denominator is every server-admitted Run in the exact
beta cohort. Only `not_eligible`, an idempotent join to an already-counted Run,
and an explicit Learner cancellation before the first billable step are excluded,
and each exclusion is reported. Queue wait begins at admission and ends when
execution starts; terminal latency begins at admission and ends at the first
terminal Run transition. Runs without the relevant end timestamp remain in the
denominator as deadline/orphan failures rather than disappearing from a quantile.
Status availability is successful schema-valid current/history/status responses
divided by every authorized read attempt in the same seven-day window; only a
prospectively declared maintenance interval is excluded and reported.

| Gate | Passing rule |
| --- | --- |
| Publication success | Among eligible admitted Runs, excluding `not_eligible`, idempotent joins, and explicit pre-billable Learner cancellations, the lower 95% bound for `completed` plus valid `partially_completed` is at least 0.90 |
| Platform failure | Among admitted billable Runs, the upper 95% bound for post-billable platform failure is at most 0.05; provider, retrieval, validation, persistence, and delivery stages remain separate |
| Queue and completion latency | Queue-wait p95 at most 5 minutes; admitted-to-terminal p95 at most 15 minutes and p99 at most 30 minutes |
| Orphan control | Zero Runs remain nonterminal more than 5 minutes after the 30-minute terminal deadline and reconciler bound |
| Durable status | Current/history/status load availability at least 99.5% over a rolling 7 days, excluding declared maintenance; zero cross-Learner or stale-current responses |
| Retry authorization | At most one #388 authorization for a qualifying post-billable platform-failed Run and none from a Retry Run; redeemed authorizations at most 5% of admitted billable Runs over a rolling 7 days |

The retry count is a versioned beta policy choice owned here, not a change to
#388's authorization semantics. Crossing the redemption-rate gate creates Hold
and an incident packet; it never silently grants more retries.

### Private beta cost packet

Per-Run cost distributions use the same complete seven-day admitted-billable-Run
census, including failed, retried, partially completed, and zero-cost Runs. The
mean denominator is all such Runs; the p95 is the nearest-rank value over the
same set. Attribution coverage is billable stages with a valid Run and rate-card
version divided by all billable stages. Reconciliation discrepancy is the
absolute ledger-to-provider difference divided by provider-recorded cost, with a
zero provider total requiring exact zero ledger cost. Daily caps use each complete
UTC day independently, not a seven-day average.

- Every billable provider and retrieval stage is attributed to its Run and a
  versioned rate card. Coverage is 100%, and reconciliation discrepancy is at most
  1%.
- Mean actual marginal cost is at most $0.50 per admitted billable Run, p95 is at
  most $1.00, and each Run reserves no more than $2.00.
- The hard aggregate spend cap is the lesser of $100 per day and any lower
  owner-approved cap. Alert at 70% and fail closed to new admission at 100%.
- At least 20% of the cap is reserved for governed freshness, correction, and
  appeal work so Learner demand cannot starve required lifecycle actions.
- Cost, reservation, usage, and retry ledgers reconcile without mutable refund or
  double-counting.

Missing or stale rate-card data, unattributed billable work, a missing budget, or
an unobserved cost baseline yields `hold` or P-02 containment; it cannot be filled
with a vendor list price or another feature's average.

### Expansion operations

Expansion requires publication-success lower bound at least 0.97, post-billable
platform-failure upper bound at most 0.02, terminal p95 at most 10 minutes and p99
at most 20 minutes, durable-status availability at least 99.9%, and zero orphaned
Runs. These use the same complete seven-day census definitions and exclusions as
the beta operating packet. The expanded cohort must pass independently.

There is deliberately no invented lower expansion dollar target. After beta, the
owner must predeclare per-Run, rolling-30-day budget, and contribution-margin
limits using observed cost, demand, and actual pricing before evaluating expansion
or entitlement. Until then those actions remain `hold`.

### Alternatives not recommended

- **No dollar cap until demand is known:** exposes the trial to unbounded spend
  before demand and provider tails are measured.
- **Use one success rate:** lets eligibility declines, user cancellations, and
  partial reports conceal technical failure.
- **Refund or grant retries until success:** converts reliability failure into an
  unbounded cost path and biases completion metrics.

## P-06 — Observe return before setting retention or entitlement targets

Demand does not gate the first private beta because no Evidence Check exposure has
occurred. It gates expansion and entitlement only through a cohort packet with
server-owned, mutually exclusive event definitions:

- **Eligible opportunity:** one unique invited authenticated Learner has at least
  one rights-cleared, preflight-eligible Video during the observation window.
- **Activated:** the Learner starts an admitted first Run. Activation conversion is
  activated Learners divided by eligible opportunities, never all accounts,
  impressions, or clicks.
- **Report consumed:** the Learner loads a published Report Version after terminal
  success. Its denominator is Learners with a published Report Version.
- **D7 return:** an activated Learner starts at least one admitted intentional
  Run for a distinct Video during `[activation + 7 days, activation + 14 days)`.
  The denominator is every activated Learner whose day-14 boundary is at or
  before the packet cutoff.
- **D30 return:** the same event during `[activation + 30 days, activation + 37
  days)`. The denominator is every activated Learner whose day-37 boundary is at
  or before the packet cutoff.

Enrollment cohorts are fixed complete UTC calendar weeks by first activation.
Each reported cohort closes only after every member has reached the relevant
day-14 or day-37 boundary, so members have equal opportunity to return. A member
whose boundary has not elapsed is right-censored and appears only in the reported
pending count, never in that metric's numerator or denominator. Once eligible for
a denominator, inactivity, account conversion, later feature suppression,
service failure, or loss of source eligibility does not censor the member; absent
return remains a non-return and the limiting condition is reported separately.
The only population exclusions are prospectively identified Smoke, staff, test,
or confirmed synthetic/duplicate identities, all removed before activation and
reported by reason. Same-Video refresh/recheck, automated work, notifications,
Retries, duplicate joins, and governed system rechecks never satisfy the return
numerator. Privacy deletion may remove the identity link, but the permitted
content-free cohort membership and return bit remain in the aggregate census; if
law forbids retaining even that aggregate, the cohort is incomplete and yields
`hold`, not an adjusted denominator.

Before any expansion or entitlement review, the packet requires at least two fully
observed 30-day enrollment cohorts, each followed through day 37, at least 100
unique eligible opportunities total,
activation-conversion lower 95% bound at least 0.20, report-consumption lower bound
at least 0.70, and complete D7/D30 numerator, denominator, and slice reporting.
D7 and D30 are descriptive in these first cohorts. They have no passing target and
cannot support promotion.

After the baseline exists, the owner may prospectively set D7/D30 target values,
required slices, and minimum sample before a new cohort begins. Expansion or an
entitlement change then requires two subsequent fully observed cohorts meeting
those targets plus every applicable P-03 through P-05 and P-07 gate. Until that
evidence exists, the action is `hold`; the target cannot be back-fit to the
observed cohort.

### Entitlement change

An entitlement packet also reports plan- and cohort-specific usage, exhaustion,
quality, Coverage, abstention, and actual-cost distributions plus a rolling-30-day
forecast. An increase is eligible for owner review only when the forecast with a
25% tail buffer is at most 80% of the owner-approved plan and system budget and all
non-compensatory parity and quality gates pass. A decrease or new paywall requires
explicit owner review and a separate Learner comprehension and notice check; high
use never changes entitlement automatically.

### Alternatives not recommended

- **Choose D7/D30 now:** invents a retention target with no Evidence Check cohort.
- **Fit the target after seeing the evaluation cohort:** converts a decision rule
  into a description and guarantees apparent success.
- **Use report opens or same-Video refresh as return:** measures notification and UI
  behavior rather than a new intentional Evidence Check need.

## P-07 — Correction capacity and critical safety are launch gates

Correction is measured over an equal 30-day maturation window. **Material
correction rate** is the number of published Report Versions that require an
authorized new version because a displayed material Finding or Coverage statement
was wrong or materially incomplete, divided by all published versions with the
full observation window. Ordinary freshness/policy supersession is excluded and
reported separately. The beta upper 95% bound must be at most 0.03; expansion must
be at most 0.01.

The following confirmed critical events have a zero-observed hard gate:

- cross-Learner or other private-report disclosure;
- provider delta, candidate, malformed, or invalid output shown or persisted as
  editorial content;
- a fabricated or misattributed citation that supports a displayed material
  assertion;
- a prohibited person, speaker, creator, or channel score;
- unlicensed or otherwise unauthorized content publication; or
- failure of a required suppression or withdrawal action.

Zero observed is not a claim of zero population risk. The packet reports the
exposure count and bound, and a confirmed event invokes P-02 immediately.

### Correction and support operations

Subject to counsel approval for the launch jurisdiction, the beta service targets
are:

- generic non-confirming Intake receipt immediately;
- plausibly critical triage within 4 hours;
- complete Report Version suppression within 1 hour after a plausible-harm
  determination;
- routine triage within 2 business days; and
- terminal Case disposition within 10 business days unless a counsel-authorized
  hold and bounded reason apply.

There are zero overdue critical actions and the routine overdue rate is at most
5%. The critical census is every required critical action whose deadline falls
inside the trailing 30 complete UTC days; any action incomplete at its deadline
is overdue. The routine overdue numerator is routine Cases whose applicable
triage or disposition deadline fell in that window and was missed, divided by all
routine Cases with a deadline in the window. A counsel-authorized hold pauses a
deadline only when its bounded reason and start/end times were recorded before the
deadline; it remains reported and is the sole exclusion. Every material correction
publishes a complete atomic Report Version, applies
#388's nullable current-pointer rules, preserves the dated content-free audit, and
sends every required private notice. The passing rate for those actions is 100%;
there is no in-place edit or fallback resurrection.

Intake and complaint volume are not votes and do not enter the Finding numerator.
The packet separately reports deduplicated Intake, matched/upheld Case, reversal,
human-review-hour, and support-ticket rates. Over a rolling 30 days, incoming work
must be at most 50% of staffed resolution capacity and routine backlog-age p95 must
remain within the 10-business-day service target. Missing staffing, correction
workflow, suppression control, or counsel-approved service policy yields `hold`.
Incoming work is the sum of predeclared reviewer-hours assigned by case class for
all nonduplicate authorized Cases opened in the trailing 30 complete UTC days;
staffed capacity is scheduled qualified reviewer-hours in that same window after
leave, training, and reserved critical-response time. Backlog age is elapsed
business time for every open routine Case at the packet cutoff, including held
Cases; its p95 is the nearest-rank census quantile. Deduplicated Intakes without an
authorized Case are reported separately and do not enter either workload term.

## Action decision table

Every row produces evidence for an authorized human decision; no row changes
product state automatically except P-02's bounded containment.

| Proposed action | Required passing packet | Failure or missing evidence |
| --- | --- | --- |
| Continue internal shadow evaluation | Rights-cleared internal corpus, cost budget, privacy/security controls, frozen evaluation provenance; failures never reach Learners | Hold or stop the affected internal run; no inference about beta readiness |
| Launch private Learner beta | #386 Transcript/platform/counsel authority; #388 retention, deletion, correction, and suppression operations; P-03 beta quality/calibration; P-04 beta behavioral safety; P-05 beta operations/cost; P-07 correction capacity; zero open critical incident | `hold`; deterministic critical breach uses `controlled_pause`. Demand and retention do not gate first exposure |
| Continue beta | All launch gates remain current; rolling operational, cost, correction, and sequential safety packets pass | `hold_expansion`, remediation, or `controlled_pause` according to P-02 |
| Expand audience, topic, Transcript/source route, or jurisdiction | Independent authority for new scope; expansion P-03, P-04, P-05, and P-07; P-06 prospective return targets pass in two new complete cohorts; no open critical incident | `hold`; never borrow the original beta average or authority |
| Increase entitlement | Current applicable quality/parity/safety gates; P-06 prospective cohorts and plan packet; 25%-buffered forecast at most 80% of approved plan/system budget | `hold`; no automatic quota increase from high engagement |
| Decrease entitlement or add paywall | Same current quality/safety evidence, observed cost/usage distribution, explicit owner economics, separate comprehension and notice check | `hold`; high cost or use alone cannot silently reduce entitlement |
| Start or continue aggregate-score experiment | P-04 expansion, calibration, counsel, causal-experiment, benefit, non-inferiority, subgroup, correction, and report-only requirements | Remove or do not start score arm; claim-level Findings and Coverage remain unchanged |
| Pause new Learner Runs | P-02 deterministic breach or predeclared sequential safety trigger | `controlled_pause` with trigger-specific containment and content-free audit |
| Resume after pause | Remediation plus a new passing packet for every breached gate and explicit human authorization | Remain paused; timeout, quiet alerts, or a rebound point estimate cannot resume |
| Pivot | Same non-compensatory quality, Coverage, operational, or economic gate fails in two consecutive complete packets after at least one scoped remediation; a prospectively measured demand/return gate fails in two complete cohorts; or the intended lawful Transcript/evidence route is unavailable | `eligible_for_pivot_review`; prefer narrower eligible scope or creator-supplied, licensed, or user-provided material, never weaker evidence rules |
| Stop | Required authority is denied or revoked with no lawful pivot; correction/deletion/suppression cannot be operated; a critical breach cannot be contained; or the same critical breach recurs after documented remediation and authorized resume | `eligible_for_stop_review`; owner/counsel decides while exposure stays paused |

## Decision table

| ID | Provisional decision | Principal trade-off |
| --- | --- | --- |
| P-01 | Immutable action-specific Gate Packets with a universal veto core plus explicitly applicable gate families; Pass means only owner-review eligibility | More packets and provenance, but no weighted score or misuse of `not_applicable` can hide a blocking harm |
| P-02 | Scheduled human promotion plus narrow asynchronous controlled pause | Faster containment without noisy automatic rollout or fleet thrash |
| P-03 | Predeclared beta and expansion technical profiles with clustered bounds and slice Holds | Conservative abstention/quality frontier and larger human gold-set cost |
| P-04 | Beta behavioral non-inferiority, expansion benefit, and separately removable aggregate-score experiment | Slower expansion, but persuasive wrong output cannot pass on usability alone |
| P-05 | Explicit beta SLO, retry, attribution, per-Run, and daily spend ceilings | Bounded exposure may deny demand before economic evidence matures |
| P-06 | Observe two beta cohorts before prospectively choosing return targets | Entitlement and expansion wait, but retention cannot be back-fit or invented |
| P-07 | Material-correction bounds, zero critical events, counsel-approved service levels, and staffed capacity | High operational burden, but correction is a launch control rather than future cleanup |

## Validation invariants

1. No weighted or aggregate metric can compensate for a failed universal-core or
   action-applicable authority, safety, citation, quality, comprehension,
   operational, cost, or correction veto. `not_applicable` requires a structural
   reason and cannot conceal missing or failing evidence.
2. Every metric is reproducible from a frozen population, unit, window, numerator,
   denominator, exclusions, slices, versions, and confidence-bound direction.
3. Insufficient sample, missing baseline, stale policy, missing authority, or
   unmeasured required slice yields `hold`, never imputation or pooling.
4. A final-test result never tunes the threshold, operating point, prompt,
   retriever, source policy, or reviewer rubric used to evaluate it.
5. Zero-observed invariants report their sample and bound and still invoke
   containment on a confirmed production occurrence.
6. Confidence remains `unavailable`; provider certainty is rejected, and internal
   calibration diagnostics never become Learner-visible truth or source quality.
7. Expansion evidence belongs to the proposed new cohort and scope. It cannot
   borrow authority, quality, comprehension, return, cost, or correction averages.
8. D7/D30 targets are absent until observed baselines exist and are valid only when
   chosen before the evaluation cohort begins.
9. Smoke, staff, test, automated recheck, notification, Retry, and duplicate-join
   events cannot inflate Learner demand, retention, or entitlement evidence.
10. Passing produces `eligible_for_owner_review`; only P-02 containment changes
    exposure without a scheduled decision, and resumption always requires a human.

## Stress cases

| Scenario | Required result |
| --- | --- |
| Accuracy rises while one fabricated citation is found. | Hard citation gate fails and P-02 containment applies; accuracy cannot compensate. |
| Consequential error meets 0.05 but Coverage lower bound is 0.42. | Beta remains `hold`; abstention cannot manufacture safety through non-use. |
| Overall expansion quality passes but one new Transcript-source slice is underpowered. | Expansion remains `hold`; do not borrow the original cohort or pool the slice away. |
| Provider latency improves after three repeated dashboard looks. | No action unless the predeclared complete packet passes; repeated looks cannot create a promotion or pause rule. |
| Daily spend reaches the hard cap with safe Runs in flight. | Fail closed to new admission; let already reserved bounded work settle unless independently unsafe. |
| The first beta cohorts have 18% D30 return. | Report 18% with its cohort and bound only; do not call it good, bad, or a target. |
| Owner sees the baseline and sets 17% for that same cohort. | Invalid post-hoc threshold; choose prospectively and observe two new complete cohorts. |
| Many duplicate Intakes allege one Finding is wrong. | Deduplicate and triage under #388; volume is not a vote and cannot change the relationship metric. |
| A normal freshness recheck changes a Finding. | Report separately from material correction unless the prior published output was wrong under its then-governing evidence and policy. |
| Aggregate score worsens overreliance while reducing task time 20%. | Remove/stop the score arm; time cannot compensate for behavioral harm. |
| A critical privacy breach is fixed and alerts are quiet for a week. | Remain paused until the breached packet passes and an authorized human resumes. |
| Quality fails twice because the source route lacks admissible evidence. | Open pivot review toward a narrower or licensed/source-supplied product; do not lower evidence sufficiency. |

## Cross-issue dependencies

| Owner | Contract consumed or still required |
| --- | --- |
| #381 — beta decision map | Must use the action packet and Hold semantics, keep Evidence Check opt-in/private/asynchronous, and never turn a passing packet into automatic rollout |
| #382 — Finding semantics | Supplies complete Evidence Relationships, server-owned unavailable confidence, auditable explanation, and technical-failure boundaries |
| #383 — eligibility | Supplies the eligible population, governed reasons, no-charge `not_eligible`, and partial/unresolved distinctions used in denominators |
| #384 — evidence policy | Supplies admissibility, source rights, snapshots, temporal cutoff, source-change, and citation rules used by hard integrity gates |
| #385 — claims and Coverage | Must supply the frozen material-claim denominator, non-compensatory central-claim/partial floor, and aggregate-score denominator protections |
| #386 — compliance | Supplies binary lawful Transcript/source, platform, jurisdiction, correction, privacy, retention, and counsel authority; metrics cannot replace it |
| #387 — evaluation | Supplies the frozen Video-first gold set, rubric, benchmark/challenge suites, calibration split, clustered analysis, and human study protocol |
| #388 — lifecycle | Supplies Run/Report publication, retry authorization, freshness/availability, correction, audit, and retention semantics measured here |
| #390 — interaction prototype | Must validate the exact learner concepts, seeded-error behavior, accessibility slices, progress/failure states, and optional score experiment used by P-04 |

## Remaining human and observed-data choices

This proposal intentionally leaves the following values unresolved rather than
inventing evidence:

- pilot-derived final sample sizes, clustering estimates, and any additional harm
  slices;
- counsel/platform approval and jurisdiction-specific correction, retention,
  deletion, notice, and source-use requirements;
- D7/D30 targets and minimum sample sizes, chosen only after the first two complete
  beta cohorts and before two new evaluation cohorts;
- expansion per-Run cost, rolling-30-day budget, pricing, and contribution-margin
  limits, chosen from observed beta cost and actual entitlement economics; and
- any future visible reviewer-agreement probability or aggregate-score definition,
  which requires a separate calibrated and counsel-reviewed contract.

Until the applicable value and authority are frozen prospectively, its dependent
action is `hold`. This is a decision outcome, not an incomplete metric to fill with
industry folklore.

## Evidence behind the proposal

- The #387 evaluation research rejects a single benchmark or weighted score as a
  launch authority and identifies Video-clustered consequential-error bounds plus
  Coverage, claim selection, citations, abstention, temporal/adversarial testing,
  and Learner behavior as separate gates.
- The evaluation research's numeric beta and broader-product profiles are adopted
  here explicitly as provisional owner choices, not represented as benchmark-
  proven safety standards.
- #386 and its policy research make lawful Transcript sourcing, written YouTube
  approval, counsel review, corrections, privacy, and bounded retention binary
  launch prerequisites.
- #382 prevents confidence and relationship labels from becoming truth or author
  judgments; #388 preserves atomic publication, correction, and cost evidence.
- Demand, return, marginal cost, and support burden have no Evidence Check product
  baseline. Their prospective Hold rules prevent post-hoc target invention while
  still defining exactly what must be measured.
