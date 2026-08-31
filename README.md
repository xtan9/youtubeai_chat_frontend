# YouTube AI Chat — Frontend

Next.js 16 + TypeScript + React 19 app that summarizes YouTube videos. All server work runs in Vercel API routes; the only external service we still operate is a small transcription microservice used for caption extraction + Whisper fallback.

## Architecture

```
Browser ──> Next.js (Vercel)
             ├─ /api/summarize/stream  (SSE orchestration)
             │    ├─ Supabase auth + rate limit
             │    ├─ Supabase cache lookup/write
             │    ├─ VPS /metadata     (detect video language + available caption codes)
             │    ├─ VPS /captions     (language-pinned caption extraction)
             │    ├─ VPS /transcribe   (Whisper fallback, audio → text)
             │    └─ llm-gateway       (CLIProxyAPI OpenAI-compatible gateway)
             └─ Supabase (Auth + Postgres: videos, summaries, rate_limits, user_video_history)
```

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | Supabase publishable key (`sb_publishable_...`; variable name retained for compatibility) |
| `NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME` | browser + server | Stable Auth cookie/storage key; keep it unchanged across Supabase hostname changes |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Supabase secret key (`sb_secret_...`; variable name retained for compatibility) for cache writes and rate limiting |
| `VPS_API_URL` | server only | Whisper microservice base URL |
| `VPS_API_KEY` | server only | Bearer token for the VPS service |
| `VPS_TIMEOUT_MS` | server only, optional | VPS transcription timeout in milliseconds; values are bounded to a positive 300s maximum |
| `VPS_METADATA_TIMEOUT_MS` | server only, optional | VPS metadata timeout in milliseconds; values are bounded to a positive 60s maximum |
| `VPS_CAPTIONS_TIMEOUT_MS` | server only, optional | VPS captions timeout in milliseconds; values are bounded to a positive 60s maximum |
| `LLM_GATEWAY_URL` | server only | OpenAI-compatible endpoint (e.g. `https://llm.betterr.me/v1`) |
| `LLM_GATEWAY_API_KEY` | server only | Bearer token for the gateway |
Semantic Profiles use the existing server-only LLM Gateway for validated JSON
generation. The first implementation does not require `OPENAI_API_KEY`, an
embedding provider, pgvector, or a learner-request model call.
Generation and retrieval remain disabled until private evaluation and human-
approval ledgers contain a matching, passed Gateway evaluation and named
approval for the exact model/schema/prompt tuple; setting `LLM_MODEL` alone
never activates a model. Durable queue requests bind that exact activation,
so switching or retiring a model cannot run stale work.
| `LLM_MODEL` | server only, optional | Set to `gpt-5.3-codex-spark`; the application pins summary and chat requests to Spark. |
| `NEXT_PUBLIC_POSTHOG_KEY` | browser, optional | PostHog analytics |
| `GOOGLE_YOUTUBE_CLIENT_ID` | server only | Google OAuth web client used by Comment Shield. |
| `GOOGLE_YOUTUBE_CLIENT_SECRET` | server only | Secret for the Comment Shield OAuth client. |
| `YOUTUBE_OAUTH_REDIRECT_URI` | server only | Exact registered callback; defaults to the current origin plus `/api/youtube/oauth/callback`. |
| `YOUTUBE_OAUTH_STATE_SECRET` | server only | 32+ character HMAC key that binds OAuth callbacks to a signed-in user. |
| `YOUTUBE_TOKEN_ENCRYPTION_KEY` | server only | 32+ character key material for AES-GCM encryption of Google provider tokens. |

The dormant 56-call Semantic Profile evidence command and mandatory
human-review handoff are documented in
[`docs/semantic-profile-evaluation.md`](docs/semantic-profile-evaluation.md).

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
- `summaries` — one row per `video_id`. Stores the summary text, transcript, transcript source, model used, and timing columns.
- `user_video_history` — per-user read history, RLS-scoped to the owner.
- `rate_limits` — `(user_id, window_start)` counter mutated via `increment_rate_limit` RPC.

## Rate limits

- Anonymous: 10 req/min
- Authenticated: 30 req/min
- Enforced atomically via an `INSERT ... ON CONFLICT DO UPDATE RETURNING` RPC.
- Fail-open if Supabase is unreachable; every fail-open path logs so abuse-wall regressions are visible.

## Paywall (freemium)

Spec: [`docs/superpowers/specs/2026-04-29-paywall-design.md`](docs/superpowers/specs/2026-04-29-paywall-design.md)

- **Anon:** 1 lifetime summary per browser (HMAC-signed cookie via `lib/services/anon-cookie.ts`). No chat. No history.
- **Free:** 10 summaries/month (UTC reset on the 1st), 5 chat messages/video, 10-item history with FIFO eviction.
- **Pro:** unlimited summaries / chat / history. Yearly is $4.99/month equivalent and $59.88 charged once per year; monthly is $6.99 charged every month via Stripe.
- Pricing page at `/pricing`. Manage subscription via the user dropdown (Pro users only) → opens Stripe Customer Portal.

### Paywall endpoints

| Path | Purpose |
|---|---|
| `POST /api/billing/checkout` | Auth-required. Creates Stripe Customer + Checkout Session. Body `{ plan: "monthly" \| "yearly", source_surface?: string, device_class?: "desktop" \| "mobile", attempt_id?: string }`; send a stable valid `attempt_id` matching `[A-Za-z0-9][A-Za-z0-9._:-]{7,127}` in the body or `Idempotency-Key` (if both are present they must match) so a lost response can be retried safely. Approved source/device attribution is copied to both Checkout and Subscription metadata. The cancel URL preserves Pricing intent/source; the success URL is session-scoped (`/billing/success?session_id=...`). |
| `POST /api/billing/portal` | Auth-required. Returns Stripe Customer Portal URL. |
| `POST /api/webhooks/stripe` | Signature-verified, idempotent. Source of truth for `user_subscriptions.tier`. |
| `GET /api/me/entitlements` | Returns `{ tier, caps, subscription? }` for the UI. |

### Stripe env vars (Vercel)

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `NEXT_PUBLIC_SITE_URL`. Plus `ANON_COOKIE_SECRET` (32+ random chars) for the anon-id signed cookie.

### Local Stripe webhook testing

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Copy the printed `whsec_...` into `.env.local` as `STRIPE_WEBHOOK_SECRET`. Test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 0341` (declines after subscribing — useful for past_due flow).

### Middleware note

The Stripe webhook plus all `/api/billing/*` routes and `/api/me/entitlements` are in the public-path list in `lib/supabase/middleware.ts` — they handle their own auth (signature verification or JSON 401), and middleware-redirecting them would 307 webhooks to `/auth/login` and clobber JSON billing responses into HTML.

## Model routing

The summarize and chat routes use `gpt-5.3-codex-spark` for every video. The
gateway is CLIProxyAPI's OpenAI-compatible endpoint. The summary route still
records the existing routing reasons for observability, but no video type is
sent to a different model:

1. **Token-count gate** — the existing thresholds preserve `very_short` and `long_content` telemetry.
2. **Classifier (middle zone)** — the first 4K chars of transcript + title are sent to Spark with a strict JSON schema prompt (`lib/prompts/routing-classifier.ts`). Returns `{density, type, structure}`.
3. **Single model** — every branch returns Spark, including lectures, news, casual videos, and long transcripts.
4. **Graceful degradation** — if the classifier fails (timeout, malformed JSON, schema miss), routing falls back to token-count only (`classifier_failed_short`/`classifier_failed_long`). Caller-abort exits silently.

Every request emits one structured log line for later analysis:

```json
{
  "event": "routing_decision",
  "youtubeUrl": "https://www.youtube.com/watch?v=abc",
  "userId": "...",
  "model": "gpt-5.3-codex-spark",
  "reason": "default_haiku",
  "tokens": 18420,
  "wordCount": 14170,
  "classifierRan": true,
  "dimensions": { "density": "medium", "type": "casual", "structure": "structured" }
}
```

Classifier failures log at error level with `errorId: "CLASSIFIER_FAILED"` — useful for alerting if the rate spikes. Caller-aborts are intentionally silent to keep that signal clean.

Thresholds (`SHORT_TOKENS`, `LONG_TOKENS`, `FALLBACK_HAIKU_TOKENS`, char budgets) are exported constants in `lib/services/model-routing.ts` — tune from one week of `routing_decision` logs.

## Structure

```
app/api/summarize/stream/route.ts   Orchestration: auth, rate limit, cache, SSE stream
lib/services/                       One module per external boundary
  caption-extractor.ts              VPS /captions client (language-pinned)
  vps-client.ts                     VPS /transcribe client (whisper, language-pinned)
  vps-metadata.ts                   VPS /metadata client (detected language + caption codes)
  llm-client.ts                     Streaming LLM gateway + callLlmJson helper
  model-routing.ts                  Spark routing: metadata + classifier + telemetry reasons
  summarize-cache.ts                Supabase cache read/write
  rate-limit.ts                     Atomic per-user quota
  video-metadata.ts                 YouTube oEmbed (title/channel for Whisper path)
  language-detect.ts                CJK → zh, else en (post-hoc PromptLocale derivation)
  youtube-url.ts                    Video ID extraction
lib/prompts/
  summarization.ts                  Summarization prompt (language-agnostic; model matches video's language)
  routing-classifier.ts             Haiku-as-router classifier prompt (EN + ZH)
supabase/migrations/                DB schema + RPCs
```

## Feedback

File issues against this repo. The frontend hits same-origin `/api/*` — no backend pointer is required anymore.

## Comment Shield

Authenticated users can connect a YouTube channel at `/moderation`, scan recent
comments on their own channel, or scan replies under a comment they left on a
specific video. The classifier deliberately separates personal attacks from
ordinary criticism. Replies require approval by default; an explicit setting
can publish only high-confidence `hostile` results, with a cap of three replies
per manual scan.

Setup, API quota costs, storage boundaries, and the Google OAuth verification
requirement are documented in
[`docs/comment-shield.md`](docs/comment-shield.md).
