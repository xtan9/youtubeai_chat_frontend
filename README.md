# YouTube AI Chat — Frontend

Next.js 15 + TypeScript + React 19 app that summarizes YouTube videos. All server work runs in Vercel API routes; the only external service we still operate is a small Whisper transcription microservice used as a fallback for videos without captions.

## Architecture

```
Browser ──> Next.js (Vercel)
             ├─ /api/summarize/stream  (SSE orchestration)
             │    ├─ Supabase auth + rate limit
             │    ├─ Supabase cache lookup/write
             │    ├─ youtube-transcript-plus (captions)
             │    ├─ VPS Whisper service   (fallback, audio → text)
             │    └─ llm-gateway           (OpenAI-compatible Claude proxy)
             └─ Supabase (Auth + Postgres: videos, summaries, rate_limits, user_video_history)
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | Supabase anon key (auth) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Cache writes + rate-limit RPC |
| `VPS_API_URL` | server only | Whisper microservice base URL |
| `VPS_API_KEY` | server only | Bearer token for the VPS service |
| `VPS_TIMEOUT_MS` | server only, optional | Override the 240s VPS call ceiling |
| `LLM_GATEWAY_URL` | server only | OpenAI-compatible endpoint (e.g. `https://llm.betterr.me/v1`) |
| `LLM_GATEWAY_API_KEY` | server only | Bearer token for the gateway |
| `LLM_MODEL` | server only, optional | Defaults to `claude-sonnet-4-6` |
| `NEXT_PUBLIC_POSTHOG_KEY` | browser, optional | PostHog analytics |

## Local development

```bash
pnpm install
pnpm dev                 # Next.js on :3000; API routes serve under /api/*
```

## Testing

```bash
pnpm test                # vitest run
pnpm test:watch          # vitest --watch
```

## Linting & typecheck

```bash
pnpm lint
pnpm exec tsc --noEmit
```

## Database migrations

Migrations live in `supabase/migrations/` and are applied by `.github/workflows/db-migrate.yml` on merges to `main` that touch that directory. The cache schema:

- `videos` — one row per distinct YouTube video ID. `url_hash` stores the normalized 11-char video ID (falling back to an MD5 of the full URL) so different URL shapes for the same video collapse to one cache row.
- `summaries` — one row per `(video_id, enable_thinking)`. Enforces `thinking IS NULL` when `enable_thinking = FALSE` via CHECK constraint.
- `user_video_history` — per-user read history, RLS-scoped to the owner.
- `rate_limits` — `(user_id, minute_window)` counter mutated via `increment_rate_limit` RPC.

## Rate limits

- Anonymous: 10 req/min
- Authenticated: 30 req/min
- Enforced atomically via an `INSERT ... ON CONFLICT DO UPDATE RETURNING` RPC.
- Fail-open if Supabase is unreachable; every fail-open path logs so abuse-wall regressions are visible.

## Structure

```
app/api/summarize/stream/route.ts   Orchestration: auth, rate limit, cache, SSE stream
lib/services/                       One module per external boundary
  caption-extractor.ts              YouTube captions via Innertube
  vps-client.ts                     Whisper microservice
  llm-client.ts                     Streaming LLM gateway
  summarize-cache.ts                Supabase cache read/write
  rate-limit.ts                     Atomic per-user quota
  video-metadata.ts                 YouTube oEmbed (title/channel for Whisper path)
  language-detect.ts                CJK → zh, else en
  youtube-url.ts                    Video ID extraction
lib/prompts/summarization.ts        Language-aware prompt templates
supabase/migrations/                DB schema + RPCs
```

## Feedback

File issues against this repo. The frontend hits same-origin `/api/*` — no backend pointer is required anymore.
