# Channel production launch packet

Issue #492 defines the immutable evidence boundary for the first user-visible
Channel release. The packet is a release-review artifact, not a feature flag,
cohort allowlist, entitlement, kill switch, rollback contract, or production
activation mechanism. A passing packet makes a release eligible for the
authorized production review; it never activates Channel by itself.

## Current repository state

[`docs/compliance/channel-production-launch-packet.json`](../compliance/channel-production-launch-packet.json)
is intentionally blocked. It contains the complete checklist shape, but it
does not claim YouTube clearance, OAuth verification, live disclosure URLs,
licensed data, human approval, or production/live evidence. The verification
command must therefore exit nonzero on this checkout.

The packet also keeps issue #479 (retention and cleanup), #480 (bounded audit
and observation metrics), #481 (Channel Hub), #487 (frozen quality gate), and
#491 (real public replies) as explicit evidence dependencies. Code or a branch
existing for a dependency is not evidence that the dependency's launch gate
has passed.

## Verification command

From the repository root:

```powershell
node_modules/.bin/tsx.cmd scripts/channel-launch-packet.ts
```

The default input is the checked-in packet. To verify a separately assembled
candidate without changing the repository:

```powershell
$env:CHANNEL_LAUNCH_PACKET_INPUT = 'C:\absolute\channel-production-launch-packet.json'
node_modules/.bin/tsx.cmd scripts/channel-launch-packet.ts
```

The command reads JSON, validates the strict schema, verifies the packet
fingerprint, checks every required slot, and exits nonzero for malformed,
missing, failed, stale, mismatched, or unverified evidence. It never fetches a
provider, writes an output file, changes a route, or grants an entitlement.

## Required packet contents

Every evidence slot has a status of `passed`, `failed`, or `not_available`.
Passing evidence must include an immutable reference, SHA-256 artifact hash,
verification timestamp, and exact source revision. `failed` and
`not_available` slots must include a reason and cannot carry passing metadata.

The strict packet schema requires all of the following:

| Family | Required records |
| --- | --- |
| External gates | Written YouTube clearance, exact production OAuth verification and incremental scopes, live HTTPS privacy/provider/deletion/revocation URLs, and a passing reproducible frozen quality report |
| End-to-end | Onboarding, identity switching, scanning, assessment, Safety Flags, review, drafting, stale drafts, publication, Publication Uncertain, deletion, downgrade, disconnect, and account deletion |
| Accessibility | Keyboard, screen readers, non-color state, live progress, focus restoration, privacy reveal, reduced motion, and 390px layout |
| Quota/load | Scan limits, daily reply limits, shared quota exhaustion, concurrent Scan Runs, atomic publication claims, and cleanup workers |
| Retention/deletion | 30-day refresh/deletion, seven-day downgrade cleanup, disconnect cleanup, account-deletion cleanup, provider outcome tracking, and public-reply deletion provenance |
| Production configuration | Evidence that feature flags, cohorts, beta entitlements, kill switches, rollback contracts, and global OAuth revocation control are absent; Channel remains unreachable until the packet passes |

The quality slot accepts the versioned offline evaluation artifact and checks
its own evaluation fingerprint, frozen blind corpus, complete provenance,
result-set hash, measured metrics, passing gate, and approved thresholds. The
packet does not turn synthetic or governed evaluation data into production
evidence.

## Updating a packet

The packet constructor in [`lib/channel-launch/contracts.ts`](../../lib/channel-launch/contracts.ts)
sorts and fingerprints the exact body, then recursively freezes the returned
value. A later recheck creates a new packet revision; an existing packet is not
edited in place. Operators must preserve the source revision and every
artifact's evidence reference in the review record.

Do not fill a slot with a placeholder URL, guessed credential, unreviewed
approval, scraped YouTube comment, synthetic live result, or a claim that a
dependency branch is sufficient. If an external gate is unavailable, retain
`not_available`, explain the blocker, and keep the result blocked.

## Release boundary

Channel remains inert and unreachable from production navigation and routes
until the complete packet is reviewed and the normal deployment decision is
made. This contract deliberately does not add a runtime release switch or
automatic activation path. The existing Channel Hub and onboarding release
boundary tests must continue to prove that inert infrastructure is not a
production consumer.
