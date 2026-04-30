# YouTube AI Chat — Frontend

Next.js 15 + TypeScript + React 19 app that summarizes YouTube videos. All server work runs in Vercel API routes; the only external service we still operate is a small transcription microservice used for caption extraction + Whisper fallback.

## Architecture

```
Browser ──> Next.js (Vercel)
             ├─ /api/summarize/stream  (SSE orchestration)
             │    ├─ Supabase auth + rate limit
             │    ├─ Supabase cache lookup/write
             │    ├─ VPS /metadata     (detect video language + available caption codes)
             │    ├─ VPS /captions     (language-pinned caption extraction)
             │    ├─ VPS /transcribe   (Whisper fallback, audio → text)
             │    └─ llm-gateway       (OpenAI-compatible Claude proxy)
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
| `LLM_MODEL` | server only, optional | Legacy fallback for `streamLlmSummary` callers that don't pass an explicit model. The summarize route does NOT use this — see "Model routing" below. |
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
- **Pro:** unlimited summaries / chat / history. $4.99/mo billed yearly ($59.88/yr) or $6.99/mo monthly via Stripe.
- Pricing page at `/pricing`. Manage subscription via the user dropdown (Pro users only) → opens Stripe Customer Portal.

### Paywall endpoints

| Path | Purpose |
|---|---|
| `POST /api/billing/checkout` | Auth-required. Creates Stripe Customer + Checkout Session. Body `{ plan: "monthly" \| "yearly" }`. |
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

The summarize route picks between Claude Haiku 4.5 and Claude Sonnet 4.6 automatically per request. Routing happens in `lib/services/model-routing.ts`:

1. **Token-count gate** — `tokens < 5K` → Haiku via `very_short`; `tokens > 150K` → Sonnet via `long_content`. Classifier is skipped in both cases.
2. **Classifier (middle zone)** — first 4K chars of transcript + title sent to Haiku with a strict JSON schema prompt (`lib/prompts/routing-classifier.ts`). Returns `{density, type, structure}`.
3. **Rules** map classifier dimensions to a model: `high_density` → Sonnet, `type ∈ {lecture, news}` → Sonnet, low-density rambling → Haiku, else `default_haiku`. First-match-wins; see `chooseModel` for the full table.
4. **Graceful degradation** — if the classifier fails (timeout, malformed JSON, schema miss), routing falls back to token-count only (`classifier_failed_short`/`classifier_failed_long`). Caller-abort exits silently.

Every request emits one structured log line for later analysis:

```json
{
  "event": "routing_decision",
  "youtubeUrl": "https://www.youtube.com/watch?v=abc",
  "userId": "...",
  "model": "claude-haiku-4-5",
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
  model-routing.ts                  Haiku vs Sonnet routing: metadata + classifier + rules
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
