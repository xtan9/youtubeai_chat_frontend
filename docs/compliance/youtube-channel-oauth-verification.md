# Supported Creator Channel Google OAuth verification

## Repository status

**Blocked — pending external Google OAuth verification.**

The machine-readable record is
[`youtube-channel-oauth-verification.json`](./youtube-channel-oauth-verification.json).
It is deliberately checked in as `pending_external_verification`. This
repository does not contain a Google client ID or secret, does not exchange
authorization codes, and does not claim that Google has verified or approved
the application.

The public contract is defined in
[`lib/channel-oauth/index.ts`](../../lib/channel-oauth/index.ts) and is shared
with the #471 onboarding and #488 publication authorization seams. The
contract is intentionally narrow:

| Flow | Requested scope | Intended use | Not granted by this flow |
| --- | --- | --- | --- |
| Identity connection | `https://www.googleapis.com/auth/youtube.readonly` | Verify exactly one public, provider-owned Channel identity returned by `mine=true` | Publish, edit, delete, moderate, or read held-for-review/likely-spam comments |
| First write action | `https://www.googleapis.com/auth/youtube.force-ssl` | A single user-confirmed reply write or product-assisted deletion while grant and provenance remain valid | Automatic, bulk, scheduled, or silent publication; uploads; channel management |

The write scope is requested incrementally and never inferred from the initial
read grant. A cumulative read-plus-write provider response is accepted only for
the later write action; all other scopes, duplicate scopes, missing scopes,
invalid state, missing authenticated account, and missing explicit consent fail
closed.

## External verification checklist

An authorized Google Cloud maintainer must verify the exact public contract
before changing the record to `verified`:

1. The OAuth application identity is the approved **YouTubeAI** identity for
   the Channel Hub use case.
2. `youtubeai.chat` is an authorized domain and the deployed callback URI is
   exactly `https://youtubeai.chat/api/channel/oauth/callback`.
3. The consent-screen text in the JSON record is the text shown to users.
4. The read and later write scope requests match the two entries above, with no
   broader or additional scope.
5. The evidence reference, verification date, and responsible Google reviewer
   or authority are preserved in the JSON record. Never commit client secrets,
   access tokens, refresh tokens, authorization codes, or private user data.

If Google rejects the application or requires a materially different scope,
identity, consent, domain, or callback, preserve the rejection evidence and
leave the gate blocked. Do not rename the Channel flow, request a broader
scope, or route around the rejection.

## Relationship to release

The OAuth route is an inert release-boundary route. It returns a blocked
response while this record is pending and ignores callback query parameters so
an authorization code cannot be echoed or exchanged accidentally. A verified
record alone still does not enable release: written YouTube clearance, the
live privacy/provider disclosures, offline quality, lifecycle, retention,
accessibility, quota/load, and production-readiness evidence must all be
recorded in the launch packet.

The user-facing disclosure is maintained at `/privacy` by the copy in
[`lib/compliance/channel-disclosures.ts`](../../lib/compliance/channel-disclosures.ts).
Its current text describes the intended handling and the pending external
gates; it is not evidence that the flow is live.
