# Transcription service HTTP contract v1

**Contract version:** `transcription-http/v1`<br />
**Producer and owner:** `xtan9/youtube-ai-service`<br />
**Consumer:** `xtan9/youtubeai_chat_frontend`<br />
**Primary seam:** authenticated HTTP requests and responses at `/metadata`, `/captions`, and `/transcribe`.

This document is the cross-repository source of truth for the first reviewed
transcription boundary. The deterministic cases in
[`test-fixtures/transcription-contract/v1/cases.json`](../../test-fixtures/transcription-contract/v1/cases.json)
are a machine-readable companion to this document. The service repository
keeps an exact mirror of that fixture file so either repository can run its
normal test suite without a shared package or live paid call.

## Ownership and compatibility

- The service owns authentication, request validation, endpoint status codes,
  provider calls, and the canonical response shape.
- The frontend owns request construction, response validation, caption-to-
  Whisper fallback, timeout handling, and safe user-facing error translation.
- The current response shape is a non-empty `segments` array. Each segment has
  `text`, `start`, and non-negative finite `duration` values.
- The `/metadata` `duration` field uses `null` for an unknown video duration;
  that is distinct from the frontend's internal `duration: 0` marker on a
  synthesized untimed segment when it consumes a legacy transcript-only
  response.
- During the compatibility window, successful caption and transcription
  responses include the derived `transcript` string as an additive alias.
  The frontend accepts a legacy response containing only `transcript` and
  synthesizes one untimed segment. The alias is retired only in a separately
  reviewed cleanup change after both deployments are verified.
- The `legacy-transcript-only` fixture keeps the same canonical response under
  both producer and consumer entries, and stores the old consumer input as an
  explicit `legacyResponse` variant. This keeps the service test on the shape
  the service produces while the frontend test exercises the rollout bridge.
- New response fields may be added during the window. Existing fields and
  status meanings are not removed or repurposed.
- The frontend returns `null` from Caption Track extraction only for a bounded
  `404 CAPTIONS_NOT_FOUND` response. A bounded `422 VIDEO_UNAVAILABLE`, all
  other service failures, schema mismatches, and cancellation are terminal
  and never authorize audio Transcription.
- `duration: null` means unknown (for example, a live stream); it never means
  zero. A successful response with empty segments is invalid and must become a
  service or schema failure rather than an empty Transcript.

## HTTP contract

All data endpoints use `POST` with JSON and
`Authorization: Bearer <VPS_API_KEY>`. The health endpoint is outside this
contract and remains an unauthenticated `GET /health`.

The frontend boundary creates a bounded opaque `X-Request-ID` for each
summary request. A caller-provided ID is accepted only when it matches the
documented safe character/length contract; invalid or missing IDs are replaced
with a UUID. The frontend forwards the same ID to the service, and the service
echoes it on every health/data response. Error responses also include a stable
`X-Error-ID` header. Service error bodies are generic and bounded:
`{ "error": string, "errorId": string, "requestId": string }`.

| Endpoint | Request body | Successful response | Stable failure statuses |
| --- | --- | --- | --- |
| `/metadata` | `{ "youtube_url": string }` | `{ language, title, description, duration: number \| null, availableCaptions: string[] }` | `400` invalid JSON/fields, `401` missing/malformed auth, `403` wrong key, `413` oversized request, `429` rate limit, `503` limit configuration failure, `504` endpoint timeout, `500` provider failure |
| `/captions` | `{ "youtube_url": string, "lang"?: string }` | `{ segments, transcript, source: "auto_captions", language, title, channelName }` | `400` invalid JSON/fields, `401` missing/malformed auth, `403` wrong key, `404` no usable captions, `422` valid Video Reference unavailable, `413` oversized request, `429` rate limit, `503` limit configuration failure, `504` endpoint timeout, `500` unexpected provider failure |
| `/transcribe` | `{ "youtube_url": string, "lang"?: string }` | `{ segments, transcript, source: "whisper", language }` | `400` invalid JSON/fields, `401` missing/malformed auth, `403` wrong key, `413` oversized request/media or excessive duration, `429` rate/concurrency limit, `500` unexpected/empty result, `503` unknown media duration or temporary provider failure, `504` endpoint timeout |

Language hints are constrained BCP-47-style tags. The sentinels `und`, `zxx`,
`mul`, and `mis` are not processing hints and are rejected at the service
boundary. Multilingual metadata may contain script or region tags such as
`zh-Hans`, `zh-Hant-TW`, and `en-US`; the service normalizes the public
language list to primary tags for the current frontend prompt contract.

Error bodies are generic and safe for Learners. Provider diagnostics remain in
bounded structured logs and are never returned as response bodies. Logs use an
allowlist: request/error IDs, status, stage, video ID, bounded provider
metrics, and error class are permitted; bearer tokens, full YouTube URLs,
transcript/summary text, and chat content are not.

All configured limits are required at service startup/request evaluation and
are read fail-closed from environment variables: `MAX_REQUEST_BODY_BYTES`,
`MAX_MEDIA_SIZE_BYTES`, `MAX_MEDIA_DURATION_SECONDS`,
`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `MAX_CONCURRENT_JOBS`,
`METADATA_TIMEOUT_MS`, `CAPTIONS_TIMEOUT_MS`, and `TRANSCRIBE_TIMEOUT_MS`.
`/transcribe` rejects unknown media duration rather than treating it as
unbounded. A timeout response does not release a running transcription slot
until the underlying request settles.

### Key rotation

The service accepts `VPS_API_KEY` as the current key and optionally accepts
`VPS_API_KEY_PREVIOUS` during a short rollout overlap. To rotate, deploy the
new value as `VPS_API_KEY`, keep the old value as `VPS_API_KEY_PREVIOUS` while
both sides roll, verify requests and logs, then remove the previous value and
redeploy. The frontend retries a single `401`/`403` response with the previous
key; provider failures are not retried. Never put either key in a browser
bundle, request body, logs, or this document.

## Live post-deployment verification

The live procedure is documented in the
[transcription service contract smoke runbook](../runbooks/transcription-service-contract-smoke.md).
It is explicitly dispatched after a service deployment, records a redacted
request-ID report, and remains outside pull request CI and the frontend
deployment chain.

## Fixture workflow

The required deterministic cases are all named in the manifest:

- caption success, `404`, `422`, and `500`
- transcription success and `503`
- metadata with known and unknown duration
- multilingual language tags
- legacy transcript-only compatibility
- empty segments
- malformed JSON
- invalid language sentinels

Frontend tests feed the fixture responses through the real VPS adapters. Service
tests feed the fixture arrangements through the real Hono route handlers. Both
sets assert the HTTP-visible status and body without contacting YouTube, Groq,
Whisper, or another paid provider.

When the contract changes, update this document and both copies of
`test-fixtures/transcription-contract/v1/cases.json` in the same review. Keep
the fixture contents identical; the repository-local tests are the drift
detectors.
