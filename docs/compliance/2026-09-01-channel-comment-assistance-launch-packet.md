# Channel comment-assistance launch packet

## Status

**Blocked.** The machine-readable packet is
[`2026-09-01-channel-comment-assistance-launch-packet.json`](./2026-09-01-channel-comment-assistance-launch-packet.json).
It preserves the repository location and expected privacy URL, but has no live
disclosure URL or external evidence because deployment and human verification
have not been performed in this repository task.

`lib/compliance/channel-launch.ts` evaluates this packet together with the
current YouTube clearance and OAuth verification records. It fails closed on
invalid records, pending or rejected gates, missing evidence, mismatched OAuth
contracts, or a disclosure record that does not contain the expected live URL.

## Evidence required before release

The owner must replace each pending slot only with evidence for this exact
implementation and observation window:

| Gate | Evidence to preserve |
| --- | --- |
| YouTube compliance | The reviewed packet and written determination covering the exact per-comment assessment, model-provider flow, and retention/refresh/revocation/deletion approach |
| Google OAuth verification | Verified application identity, consent text, authorized domain, exact callback URI, exact incremental scopes, reviewer/authority, and stable evidence reference |
| Live disclosures | The deployed privacy/disclosure URL(s), a redacted verification run or review reference, and confirmation that the live copy covers data use, provider processing, excluded author identity, retention, refresh, deletion, revocation, downgrade grace, and YouTube fallback |
| Offline quality | The fixed multilingual corpus result and zero-prohibited-draft evidence |
| Lifecycle | End-to-end publication, uncertainty reconciliation, revocation, downgrade, and deletion evidence |
| Retention | Verified 30-day refresh/deletion behavior and seven-day downgrade cleanup evidence |
| Accessibility | Keyboard, screen-reader, non-color status, async progress, focus, privacy reveal, reduced-motion, and 390px evidence |
| Quota/load | Bounded scan/publication/delete quota and cost evidence |
| Production readiness | Redacted deployment, configuration, monitoring, and incident-readiness evidence |

No field in this packet is satisfied by a test fixture, a planned URL, a
repository path, an unreviewed packet, an unverified provider promise, a live
channel, creator consent, or a production smoke run that was not actually
performed. Evidence must not contain credentials, tokens, authorization codes,
raw YouTube API Data, comment text, author identity, or sensitive safety
evidence.

## Update rules

1. Preserve the immutable record revision and the exact evidence reference for
   every satisfied gate.
2. Keep the packet blocked while any gate is pending or rejected.
3. If YouTube rejects the assessment, leave the no-go decision in force; do not
   rename or reroute the use case.
4. Re-run the relevant repository tests and the complete launch review after
   any evidence update. A passing evaluator makes the release eligible for
   authorized human review; it does not deploy or enable the flow itself.
