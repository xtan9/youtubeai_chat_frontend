# Product analytics event taxonomy

This document is the contract for YouTubeAI.chat funnel events. Event names use
lowercase `object_verb` form, carry `analytics_schema_version: 1`, and are
emitted only after the application can confirm the named outcome.

PostHog's automatic history-change capture is the single source of `$pageview`.
Do not add a second manual route-change capture.

## Funnel events

| Event | Authoritative trigger | Properties |
| --- | --- | --- |
| `signup_completed` | Supabase email sign-up returns a newly created identity. Obfuscated existing-user responses are excluded. | `auth_method`, `email_confirmation_required`, `source_surface` |
| `summary_succeeded` | The summary stream reaches a terminal summary event with non-empty summary output. | `account_type`, `source_surface`, `result_origin`, `output_language`, `transcription_seconds`, `summary_seconds`, `total_seconds` |
| `summary_failed` | The summary request returns a terminal HTTP/query error or the accepted stream emits a terminal processing error. | `account_type`, `source_surface`, `output_language`, `failure_category`, `error_code`, optional `http_status` |
| `chat_started` | The first chat stream for a video in the mounted client session completes with assistant output. | `account_type`, `source_surface` |
| `checkout_started` | The authenticated billing API returns a Stripe Checkout URL. A pricing-page click or failed API call is not counted. | `account_type`, `source_surface`, `plan`, `billing_interval` |
| `subscription_activated` | A signed Stripe webhook persists an `active` or `trialing` Pro subscription. Subscription updates emit only on a non-Pro to Pro transition. | `source_surface`, `plan`, `billing_interval`, `subscription_status` |

`signup_completed` intentionally covers authoritative email account creation
only. The shared Google OAuth callback cannot currently distinguish a new
registration from a returning login without a Supabase auth hook or durable
signup-intent state. Do not count OAuth initiation as completion.

## Analysis model

- Acquisition: `$pageview` and PostHog's standard referrer/UTM properties.
- Activation: the first `summary_succeeded` per person.
- Signup conversion: `signup_completed` after an acquisition page view.
- Engagement and retention: repeat `summary_succeeded` events and adoption of
  `chat_started`, sliced by day since first activation.
- Paid conversion: `checkout_started` followed by `subscription_activated`,
  sliced by plan and billing interval.
- Reliability: `summary_failed / (summary_failed + summary_succeeded)`, with
  quota, auth, rate-limit, request, and processing failures reported
  separately.

Client events use the same stable Supabase user ID that
`PostHogUserIdentifier` identifies. Server-side subscription events use that
ID as PostHog's `distinctId`, linking the activation to the same person.

## Privacy rules

Never add any of the following to general product analytics:

- YouTube URLs or video titles;
- transcript, summary, prompt, or chat content;
- email addresses, names, or other profile fields;
- Stripe customer, checkout-session, or subscription identifiers;
- raw error messages that might contain user-provided or upstream content.

Use enumerated categories, booleans, counts, durations, status codes, and
billing-plan labels instead. PostHog capture failures must never block signup,
summarization, chat, logout, checkout, or webhook processing.

References:

- [PostHog Next.js integration](https://posthog.com/docs/libraries/next-js)
- [PostHog Node.js serverless capture](https://posthog.com/docs/libraries/node#short-lived-processes-like-serverless-environments)
