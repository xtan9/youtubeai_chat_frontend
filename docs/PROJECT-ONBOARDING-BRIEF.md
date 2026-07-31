# YouTube AI Chat — Project Onboarding Brief

**Status:** Approved July 30, 2026

**Purpose:** Establish the product boundary, repository ownership, and operating rules before further implementation.

## Product direction

YouTube AI Chat helps people who consume many podcasts, educational videos, and stories understand each video without watching it in full.

The current experience should make one video trustworthy and useful:

1. Submit a YouTube URL.
2. Read a timestamped transcript and structured summary.
3. Ask questions answered from that video, with timestamp citations.
4. Return to previously processed videos through history.

Answers should stay grounded in the video by default and clearly say when the video does not contain the answer.

**Not in the current scope:** folders and categorization, multi-video chat, shared collections, and NotebookLM-style projects. These remain future directions.

## System ownership

| Repository | Responsibility | Runtime |
| --- | --- | --- |
| `youtubeai_chat_frontend` | Product UI, web APIs, summary and chat orchestration, accounts, billing, analytics, and shared product documentation | Vercel |
| `youtube-ai-service` | YouTube metadata, captions, audio acquisition, and transcription | Docker on the VPS |

Supabase owns authentication and product data. Stripe owns subscription payments. PostHog provides analytics. The LLM gateway powers summary and chat. Groq is the primary transcription provider, with local Whisper fallback.

## How we will work

- Development is pull-request oriented; `main` should remain releasable.
- Every change must pass the repository's lint, type, test, build, and relevant deployment checks.
- Low-risk maintenance may be merged after green checks.
- Explicit approval is required for database migrations, authentication or billing changes, production configuration, provider or cost changes, destructive data work, public API behavior, and major dependency upgrades.
- Discovery and planning end with a short reviewable document. Implementation starts only after that document is approved.
- Cross-system decisions live in the frontend repository; service-specific operations stay in the service repository.

## Current baseline

Repository onboarding and low-risk maintenance are complete:

- Both repositories build and pass their CI test suites.
- Service dependency audit reports no known vulnerabilities.
- Frontend dependency findings were reduced to one upstream-constrained `sharp` advisory.
- Runtime versions, environment templates, product terminology, and onboarding instructions are documented.
- Production is reachable; the frontend health check currently reports healthy VPS and LLM dependencies.

## Recommended next work

Proceed in this order after approval:

1. Correct stale CI workflow registration and the broken parent-document reference.
2. Propose exact `main` branch-protection rules for separate approval, then enforce required PR checks.
3. Investigate the non-blocking frontend chart build warning and verify any UI correction with Playwright.
4. Monitor the remaining `sharp` advisory and upgrade only when supported by Next.js.
5. Confirm the next scheduled read-only production smoke check succeeds.

Feature development remains paused until this onboarding baseline is accepted.

## Approval

Approval of this brief confirms the current product boundary, repository responsibilities, risk policy, and recommended maintenance order. It does not authorize any separately identified high-risk change.
