# Engineering onboarding

This repository is the canonical home for YouTube AI Chat product terminology, end-to-end architecture, and user journeys. The companion [`youtube-ai-service`](https://github.com/xtan9/youtube-ai-service) repository owns its transcription API, container stack, deployment, and operational documentation.

## Current product boundary

The current product is a single-video learning workflow:

1. A Learner submits a YouTube URL.
2. The system acquires a timestamped Transcript.
3. The system produces a structured Summary.
4. The Learner asks transcript-grounded questions with Timestamp Citations.
5. Signed-in Learners can return to previously processed Videos through History.

Categorization, multi-video chat, collections, and NotebookLM-style projects are future capabilities, not part of the current engineering boundary.

## Repository ownership

| Repository | Owns | Deploys to |
| --- | --- | --- |
| `youtubeai_chat_frontend` | Web UI, Next.js API orchestration, product rules, Supabase access, billing, analytics | Vercel |
| `youtube-ai-service` | YouTube metadata, caption extraction, audio acquisition, Groq transcription, local Whisper fallback | Docker on the VPS |

The repositories communicate through the authenticated `/metadata`, `/captions`, and `/transcribe` service endpoints. Keep cross-system concepts here and service-specific operational detail in the service repository.

## Local baseline

Use Node.js 22 and pnpm 10. Copy `.env.example` to `.env.local`, then provide the development credentials described in the root README.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm exec tsc --noEmit
pnpm test --coverage
pnpm build
```

The production build can use placeholder public Supabase values for code verification; authenticated flows and end-to-end tests require real non-production credentials.

## Change and risk policy

Development is pull-request oriented. Low-risk changes may merge after review and green checks. Require explicit approval before merging database migrations or backfills, authentication or billing changes, secrets or production configuration, provider changes that affect cost or output, destructive data changes, public API behavior changes, or major dependency upgrades.

Never weaken a check merely to make a PR green. Fix the defect, or document why a platform-specific check belongs in the Linux CI backstop.

## Production dependencies

- Vercel: application hosting and preview deployments
- Supabase: authentication and Postgres data
- Stripe: subscriptions and customer portal
- PostHog: privacy-safe product analytics
- LLM gateway: summary and chat model access
- VPS transcription service: metadata, captions, and Whisper fallback
- Groq: primary Whisper transcription provider
- Tailscale exit node and PO-token provider: reliable YouTube extraction from the VPS

Treat changes to these boundaries as operationally significant even when the code diff is small.
