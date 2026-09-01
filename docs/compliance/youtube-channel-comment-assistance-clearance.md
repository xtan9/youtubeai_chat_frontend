# YouTube Channel comment-assistance compliance clearance

## Current status

**Blocked — pending the reviewed packet and an external written determination.**

This record is the repository-side evidence slot for issue [#470](https://github.com/xtan9/youtubeai_chat_frontend/issues/470). It deliberately makes no claim that YouTube has reviewed or permitted the use case. The machine-readable record is [youtube-channel-comment-assistance-clearance.json](./youtube-channel-comment-assistance-clearance.json), and its current decision is `pending_external_determination`.

The blocking issue [#469](https://github.com/xtan9/youtubeai_chat_frontend/issues/469) has not produced a reviewed packet on this branch. No packet submission or YouTube API Compliance Audit result is evidenced in this repository, and no reviewer or authority can be named in the record yet. Until both artifacts exist, real YouTube API Data assessment remains blocked; offline work is limited to synthetic or separately governed data as required by the approved [Channel comment-assistance discovery spec](../specs/2026-08-31-comment-assistance-discovery.md).

Existing video metadata, caption, and player behavior are not Channel comment assessment and are outside this gate. There is currently no Channel comment assessment or publication integration in the repository to unblock.

## Required evidence when the external response arrives

Replace the pending record only after the reviewed packet from #469 has been submitted. Preserve the following without paraphrasing away scope:

| Field | Requirement |
| --- | --- |
| `packet.issueNumber` | Must remain `469`. |
| `packet.status` | Must be `reviewed`; include the packet artifact path, immutable revision, review date, and reviewer. |
| `determination.responseDate` | Date the written response was issued. |
| `determination.reviewerOrAuthority` | Named YouTube reviewer, team, or other authority. |
| `determination.applicablePolicies` | Every policy or policy version relied on by the response, including any derived-metrics or NLP rule. |
| `determination.permittedScope` | Exact operations and data use that are permitted. Use `None` when nothing is permitted. |
| `determination.prohibitedScope` | Exact operations and data use that remain prohibited or were not decided. |
| `determination.sourceReference` | Stable evidence reference, such as an audit ID, response URL, or restricted evidence location. Do not commit credentials or private tokens. |
| `determination.verbatimResponse` | The complete written response, preserved exactly. Redact secrets only with the redaction recorded in the evidence process. |

The response must be one of these decisions:

### Permitted

Set `decision` to `permitted` only if the response explicitly covers all three items below, not merely a general approval:

1. custom per-comment behavioral assessment for a Channel Steward;
2. the proposed model-provider flow, including what is sent and excluded and the provider's no-training terms; and
3. the proposed YouTube API Data retention, refresh, revocation, and deletion approach.

The typed gate in [youtube-channel-clearance.ts](../../lib/compliance/youtube-channel-clearance.ts) requires all three coverage flags to be literal `true` and requires the packet to be marked `reviewed`.

### Conditional

Set `decision` to `conditional` when permission depends on any condition. Record every condition as an item in `conditions`, with:

- a stable ID;
- `prerequisite` set to `launch` or `implementation`;
- the complete condition text;
- `status` set to `open` until satisfied; and
- an evidence reference before changing it to `satisfied`.

The gate remains blocked while any condition is open. Conditions cannot be dropped, merged, or treated as advice to make a conditional approval appear unconditional.

Conditional records use the same three explicit coverage flags as permitted records. A conditional response must therefore address custom per-comment behavioral assessment, the proposed model-provider flow, and the retention approach before its prerequisites can be satisfied.

### Rejected

Set `decision` to `rejected` when the written response prohibits the approved use case. Preserve the exact no-go outcome and set `noGo.integrationStatus` to `blocked`. Do not rename the feature, route around the finding, substitute a different assessment integration, or use a different YouTube surface to claim compliance. A materially different product requires new discovery under decision D53.

## Submission and update checklist

The human owner must complete these external steps; repository code cannot perform them:

1. Review and approve the packet produced by #469.
2. Submit that exact reviewed revision through the applicable YouTube API Compliance Audit or equivalent support channel.
3. Preserve the complete response and evidence metadata in the fields above.
4. For a permitted response, confirm the three explicit scope statements and update the coverage flags.
5. For a conditional response, record and evidence every launch and implementation prerequisite; leave the gate blocked until all are satisfied.
6. For a rejection, preserve the no-go response and leave every real YouTube assessment path blocked.
7. Re-run the compliance unit tests and have the final launch packet review verify this record before any user-visible Channel release.

No external response is present as of this commit, so issue #470 remains blocked on human submission, YouTube review, and evidence preservation.
