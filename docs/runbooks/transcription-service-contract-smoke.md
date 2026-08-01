# Transcription service contract smoke

Run this live smoke after deploying `youtube-ai-service` and before treating
the deployment as production-ready. It is intentionally separate from pull
request CI, the hourly frontend smoke, Preview deployments, and the controlled
Vercel Production deployment chain. It makes real YouTube and Whisper calls,
so dispatch it only when a service deployment needs verification.

## One-time GitHub configuration

Configure these settings in `xtan9/youtubeai_chat_frontend`:

- Repository variable `VPS_API_URL`: the deployed service HTTPS origin.
- Repository secret `VPS_API_KEY`: the current service bearer key.

The workflow never prints the key, request/response bodies, full Video URLs,
or Transcript text. The retained report contains only check names, endpoint
paths, HTTP statuses, durations, safe schema facts, and request IDs.

## Safe public Videos

The workflow defaults were rechecked on 2026-07-31. YouTube can add captions
or remove a Video later, so confirm drift before diagnosing a service release.

| Purpose | Video | Expected outcome |
| --- | --- | --- |
| Captioned | [Rick Astley - Never Gonna Give You Up](https://www.youtube.com/watch?v=dQw4w9WgXcQ) | `/metadata` returns a valid English record; `/captions` returns non-empty segments with `source=auto_captions`. This is also the long-lived caption fixture used by the service deploy smoke. |
| Captionless / Whisper | [JFK warns possible war over Berlin (public-domain newsreel)](https://www.youtube.com/watch?v=R1uK1QPwYfY) | `/captions` returns the documented safe `404`; `/transcribe` returns non-empty segments with `source=whisper`. The Video is short (about 90 seconds), public, spoken, and had no subtitle or automatic-caption tracks when selected. |
| Multilingual | [Chinese Video from the original language regression](https://www.youtube.com/watch?v=xMZqTuLWSA4) | `/metadata` reports primary language `zh` and a matching caption track; `/captions` with `lang=zh` returns non-empty `zh` segments. |
| Failure | Literal invalid input `not-a-youtube-url` | `/metadata` returns `400` with only `error`, `errorId`, and `requestId`; headers and body IDs agree and no secret, full Video URL, or Transcript content appears. |

If a default Video drifts, use the workflow inputs for that run. Replace a
default in code only with a public, non-sensitive, non-age-gated Video that is
short enough for the service limits and whose expected caption state has been
verified immediately before review. A captionless replacement must contain
clear speech so an empty Whisper result cannot pass as readiness.

## Dispatch after a service deployment

1. Open **Actions → Transcription Service Contract Smoke → Run workflow**.
2. Select `main`, leave the public Video defaults unchanged unless one has
   drifted, and optionally enter a service URL override for the deployment.
3. Run the workflow. It performs these checks in order:
   `health`, `authenticated-metadata`, `captioned-video`,
   `captionless-caption-miss`, `captionless-whisper`,
   `multilingual-metadata`, `multilingual-captions`, and `safe-failure`.
4. Require **all eight** checks to pass. Read the request IDs in the job
   summary and download `transcription-service-smoke-report` for the durable
   JSON record.

For a local operator run, load `VPS_API_URL` and `VPS_API_KEY` into the process
environment from an approved secret store, then run:

```sh
pnpm exec tsx smoke-tests/transcription-service-smoke.ts
```

The local report is written to
`test-results/transcription-service-smoke.json`. Optional override variables
match the workflow: `SMOKE_CAPTIONED_VIDEO_URL`,
`SMOKE_CAPTIONLESS_VIDEO_URL`, `SMOKE_MULTILINGUAL_VIDEO_URL`, and
`SMOKE_MULTILINGUAL_LANGUAGE`.

## Failure response and escalation

Use the failed check's request ID to search service logs. Do not copy response
bodies or bearer values into issues, chat, or incident notes.

| Failed check | First response |
| --- | --- |
| `health` | Stop promotion. Confirm the process, reverse proxy, and deployment health checks. Roll back immediately if the new release does not become healthy. |
| `authenticated-metadata` | Check the workflow variable, current/previous key overlap, and service auth configuration. If credentials are correct, treat it as a deployed contract regression and roll back. |
| `captioned-video` | Check YouTube egress, PO-token support, caption extraction, and the Video's current caption state. Roll back when the failure began with the deployment. |
| `captionless-caption-miss` | Confirm the Video still has no caption tracks. A `200` means fixture drift; an unexpected status means the caption-miss contract regressed. |
| `captionless-whisper` | Check duration/media limits, capacity, Groq, and local Whisper fallback. Do not accept a deploy that cannot return canonical Whisper segments. |
| `multilingual-*` | Confirm the `zh` track still exists, then inspect language detection and BCP-47 matching. Roll back a release that changed the observed language behavior. |
| `safe-failure` | Treat as a security boundary failure. Roll back immediately if the response exposes extra fields, Transcript content, a URL, or a secret. Rotate a key if independent evidence suggests exposure. |

After rollback or remediation, redeploy through the service repository's normal
procedure and dispatch this workflow again. Production readiness is restored
only when a fresh run passes all eight checks. Escalate persistent provider or
Video drift with the redacted report, service deploy SHA, UTC timestamp, and
request IDs; never attach raw bodies.
