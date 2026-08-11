# Anonymous Trial rollout and rollback

The Anonymous Trial is default-off and reversible. It gives a signed-out
visitor five total Grounded Answer messages across the canonical Hero Demo
Videos. It is not an unmetered chat surface: the durable identity ledger,
network-prefix ceiling, one-active-lease rule, global spend ceiling, and
server-side grounding validator must all admit a request.

## Preconditions

Before enabling production, verify all of the following on the exact release:

- every Anonymous Trial, retained-conversation, Registered Free, grounding, and
  passive-control migration is present in the Supabase migration ledger;
- the representative legacy and fresh database fixtures pass, including the
  two-session fifth/sixth-message race and conversion-to-fresh-Free allowance;
- `ANONYMOUS_TRIAL_ENABLED=true` only in the intended deployment;
- `ANONYMOUS_TRIAL_KILL_SWITCH=false` only for the bounded rollout window;
- `ANONYMOUS_TRIAL_TRUSTED_IP_ADAPTER=vercel`, `VERCEL=1`, and a rotated
  `ANONYMOUS_TRIAL_NETWORK_HMAC_SECRET` of at least 32 characters;
- `ANONYMOUS_TRIAL_GLOBAL_24H_SPEND_LIMIT_MICROS` is a positive approved hard
  ceiling, and `ANONYMOUS_TRIAL_RESERVATION_COST_MICROS` is positive and no
  greater than it; and
- the canonical Demo transcript/evidence is ready. Missing settings, trusted
  network evidence, quota dependencies, or grounding evidence fail closed.

Do not add CAPTCHA, fingerprinting, prompt content, transcript content, raw IP,
network prefix, user ID, or conversation ID to analytics. The governed funnel
events contain only their bounded source, allowance bucket, and registration
method fields.

## Bounded production smoke

This smoke is rollout evidence, not the primary correctness test. Run it only
through a manual `production-smoke` workflow dispatch:

1. Deploy with the feature enabled and kill switch `false`.
2. Dispatch with `anonymous_trial_smoke_phase=admitted`. The probe creates a
   fresh anonymous session, immediately marks it in trusted Auth app metadata
   as a synthetic Smoke identity, and asks exactly one fixed question against
   the default canonical Demo. The pre-mark bootstrap cannot reach PostHog,
   synthetic business capture remains suppressed after reload, and the
   bounded identity is deleted when the probe ends. A `200` is insufficient:
   the rendered result must contain a clickable Timestamp Citation and must
   contain no refusal, `anonymous_trial_invalid_answer`, or error UI.
3. Immediately set `ANONYMOUS_TRIAL_KILL_SWITCH=true` in the production
   environment and deploy that configuration. Do not ask another admitted
   question while waiting.
4. Dispatch with `anonymous_trial_smoke_phase=killed`. The same single request
   must fail with `503` and `X-Error-ID: ANONYMOUS_TRIAL_GLOBAL_SHUTDOWN`; no
   answer may render and the composer remains recoverable.
5. Leave the kill switch on while reviewing evidence. Re-enable only through a
   new authorized rollout decision.

The workflow deliberately cannot edit production configuration. A human with
deployment authority controls the switch, and the two explicit phases keep the
smoke bounded and auditable.

## Rollback and incident response

Set `ANONYMOUS_TRIAL_KILL_SWITCH=true` and deploy first. If configuration or a
dependency is uncertain, also set `ANONYMOUS_TRIAL_ENABLED=false`. Confirm the
`killed` smoke phase, then inspect content-free denial/error IDs and aggregate
cost/allowance events. Do not reset or delete quota, lease, or conversation
rows: retained history and consumption remain authoritative across rollback,
clear-history, browser restarts, and later registration.

The global spend ceiling is a final fail-closed boundary, not a forecasting
target. Treat a ceiling denial as an incident signal; do not raise the ceiling
to make a smoke pass.

## Accepted residual risk

The privacy-preserving controls intentionally do not fingerprint a person.
Clearing browser storage or rotating anonymous identity can create a new
identity allowance, and changing networks or rotating through proxies can
evade a single `/24` IPv4 or `/64` IPv6 prefix counter. The shared prefix and
global spend ceilings bound abuse without silently tracking people, but do not
prove person-level uniqueness. Monitor aggregate, content-free outcomes and
keep the kill switch available throughout rollout.
