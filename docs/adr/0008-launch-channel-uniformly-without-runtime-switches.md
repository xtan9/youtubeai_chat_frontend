---
status: accepted
---

# Launch Channel uniformly and fix forward

Channel launches to every eligible Pro user at once after its policy, quality,
and launch contracts are satisfied. It has no cohort or percentage rollout,
product feature flag, or independent scan/publication kill switch because the
product owner values one uniform capability over runtime release controls.
Existing application-wide quality gates, model retirement, provider budgets,
entitlements, rate limits, and safety controls remain unchanged.

## Considered options

- Cohort or percentage rollout was rejected because users in the same paid tier
  should receive the same product.
- A safety-only publication stop was rejected because Channel should not have a
  runtime off state after launch.
- A deployment rollback contract and global OAuth revocation response were
  rejected in favor of normal fix-forward releases.
- Removing existing application controls was rejected because those controls
  govern separate products, models, providers, budgets, and abuse boundaries.

## Consequences

Channel code may be deployed only when it is ready to be on for every eligible
Pro user. A confirmed Channel defect remains active until a normal corrective
deployment reaches production; the decision intentionally provides no runtime
stop, rollback SLO, or global OAuth revocation response. With no existing real
users, the initial release relies on offline quality evidence; escalation,
complaint, correction, and reputation outcomes begin as observational postlaunch
metrics rather than prelaunch gates or governed response triggers.
