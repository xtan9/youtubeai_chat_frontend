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
- `duration: null` means unknown (for example, a live stream); it never means
  zero. A successful response with empty segments is invalid and must become a
  service or schema failure rather than an empty Transcript.

## HTTP contract

All data endpoints use `POST` with JSON and
`Authorization: Bearer <VPS_API_KEY>`. The health endpoint is outside this
contract and remains an unauthenticated `GET /health`.

| Endpoint | Request body | Successful response | Stable failure statuses |
| --- | --- | --- | --- |
| `/metadata` | `{ "youtube_url": string }` | `{ language, title, description, duration: number \| null, availableCaptions: string[] }` | `400` invalid JSON/fields, `500` provider failure |
| `/captions` | `{ "youtube_url": string, "lang"?: string }` | `{ segments, transcript, source: "auto_captions", language, title, channelName }` | `400` invalid JSON/fields, `404` no usable captions, `500` unexpected provider failure |
| `/transcribe` | `{ "youtube_url": string, "lang"?: string }` | `{ segments, transcript, source: "whisper", language }` | `400` invalid JSON/fields, `500` unexpected/empty result, `503` temporary capacity/provider failure |

Language hints are constrained BCP-47-style tags. The sentinels `und`, `zxx`,
`mul`, and `mis` are not processing hints and are rejected at the service
boundary. Multilingual metadata may contain script or region tags such as
`zh-Hans`, `zh-Hant-TW`, and `en-US`; the service normalizes the public
language list to primary tags for the current frontend prompt contract.

Error bodies are generic and safe for Learners. Provider diagnostics remain in
bounded structured logs and are never returned as response bodies.

## Fixture workflow

The required deterministic cases are all named in the manifest:

- caption success, `404`, and `500`
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
