# Product analytics event taxonomy

This document is the contract for YouTubeAI.chat funnel events. Event names use
lowercase `object_verb` form, carry `analytics_schema_version: 1`, and are
emitted only after the application can confirm the named outcome.

PostHog's automatic history-change capture is the single source of `$pageview`.
Do not add a second manual route-change capture.

## Subscription discovery

Subscription discovery uses the runtime-validated contract in
`lib/analytics/subscription-discovery.ts`. New emitters must use the four shared
dimensions below. The schemas are strict: misspelled values, unapproved event
names, and extra fields fail validation before an analytics transport is called.

| Dimension | Governed values | Meaning |
| --- | --- | --- |
| `source_surface` | `global_header`, `public_footer`, `plan_and_billing`, `account`, `summary_limit`, `video_chat_limit`, `history_limit`, `project_limit`, `direct_pricing` | The earliest governed Subscription-discovery surface for the interaction. Preserve it through Pricing and checkout; use `project_limit` when a registered Free Researcher sees the Upgrade to Pro action at the Project allowance, and use `direct_pricing` only when Pricing was entered without a governed source. `account` is reserved for retained migration links from the legacy Account billing presentation. |
| `presentation_state` | `pricing`, `upgrade_to_pro`, `pro_plan`, `billing_issue`, `plans`, `activating_pro` | The truthful label/state presented to the Learner. A loading placeholder is not an impression because it presents no plan action. |
| `authentication_state` | `logged_out`, `anonymous_session`, `registered` | Privacy-safe identity state. Combine `registered` with `presentation_state` to segment Free Plan, active Pro Plan, and billing-issue journeys. |
| `device_class` | `mobile`, `desktop` | The responsive presentation at interaction time. Use `SUBSCRIPTION_DISCOVERY_MOBILE_MEDIA_QUERY` (`max-width: 767px`) so this matches the governed `md` breakpoint. |

The governed event sequence is:

| Event | Authoritative trigger | Additional properties |
| --- | --- | --- |
| `subscription_discovery_viewed` | A visible, truthfully resolved plan or Upgrade control is presented. Emit once per mounted interaction surface. | None |
| `subscription_discovery_clicked` | The Learner activates that control, before navigation. | None |
| `pricing_viewed` | Pricing has resolved enough identity and Subscription state to attach truthful dimensions. This is distinct from the automatic `$pageview`. | None |
| `plan_choice_attempted` | The Learner chooses monthly or yearly Pro, before the flow branches to sign-up, Plan & Billing, or checkout. | `plan`, `billing_interval` |
| `checkout_started` | The authenticated billing API returns a Stripe Checkout URL. | Existing `account_type`, `plan`, and `billing_interval` fields remain; new emitters add the four shared dimensions. |
| `checkout_failed` | Checkout cannot produce a redirect because the request is rejected, unavailable, malformed, or throws. | `account_type`, `plan`, `billing_interval`, governed `failure_category`, optional `http_status` |
| `subscription_activated` | A signed Stripe webhook persists an `active` or `trialing` Pro Subscription on a non-Pro-to-Pro transition. | Existing `plan`, `billing_interval`, and `subscription_status` fields remain; attributed emitters add the four shared dimensions. |

`checkout_started` and `subscription_activated` keep their existing event names,
schema version, and established properties. The compatibility schema continues
to accept the current `source_surface: pricing` checkout payload and
`source_surface: stripe_webhook` activation payload while producers migrate to
the governed dimensions. This compatibility is intentionally limited to those
two existing payloads; all new discovery events require complete attribution.

Interaction-boundary tests should build or validate events with
`emitSubscriptionDiscoveryEvent`, `createSubscriptionDiscoveryEvent`, and
`SubscriptionDiscoveryEventSchema`, or mock the public capture boundary when
rendering a component. Transport-adapter tests may mock PostHog to verify the
adapter's failure isolation; interaction tests must not assert transport
configuration.

## Funnel events

| Event | Authoritative trigger | Properties |
| --- | --- | --- |
| `signup_completed` | Supabase email sign-up returns a newly created identity. Obfuscated existing-user responses are excluded. | `auth_method`, `email_confirmation_required`, `source_surface` |
| `summary_succeeded` | The summary stream reaches a terminal summary event with non-empty summary output. | `account_type`, `source_surface`, `result_origin`, `output_language`, `transcription_seconds`, `summary_seconds`, `total_seconds` |
| `summary_failed` | The summary request returns a terminal HTTP/query error or the accepted stream emits a terminal processing error. | `account_type`, `source_surface`, `output_language`, `failure_category`, `error_code`, optional `http_status` |
| `chat_started` | The first chat stream for a video in the mounted client session completes with assistant output. | `account_type`, `source_surface` |
| `project_video_processing_started` | An owned Project atomically grants this request the only processing lease for a canonical Video membership. | Governed `status`, 1â€“5 `ordinal`, and `attempt_kind` only. |
| `project_video_processing_succeeded` | The leased Summary Run completes and durable Transcript + Summary evidence is verified before membership becomes ready. | Governed `status`, `ordinal`, cache/generated origin, and stage timings only. |
| `project_video_processing_failed` | A leased Summary Run or its durable evidence handoff reaches a classified failure, including an expired interrupted lease. | Governed `status`, `ordinal`, `error_class`, and processing duration only. |
| `checkout_started` | The authenticated billing API returns a Stripe Checkout URL. A plan choice or failed API call is not counted. | See the Subscription-discovery contract above. |
| `subscription_activated` | A signed Stripe webhook persists an `active` or `trialing` Pro Subscription. Subscription updates emit only on a non-Pro-to-Pro transition. | See the Subscription-discovery contract above. |

`signup_completed` intentionally covers authoritative email account creation
only. The shared Google OAuth callback cannot currently distinguish a new
registration from a returning login without a Supabase auth hook or durable
signup-intent state. Do not count OAuth initiation as completion.

## Project Search

`project_search_completed` is emitted only after direct Project passage search
returns a classified `ready`, `no_results`, or `not_ready` outcome. Its strict
properties are `source_set_revision`, `outcome`, `result_count`,
`total_videos`, `ready_videos`, `unavailable_videos`, and `passages_examined`.
The schema rejects extra properties. Never record a Project identifier or name,
Project Goal, search query, Transcript passage, Video title or URL, channel
name, or other Project content in this event.

The Search interface is also a PostHog no-capture subtree: autocapture and
session replay must not record its input, result text, accessible labels, or
YouTube links. Search uses a POST JSON body so the query is absent from request
URLs, and the replay network privacy callback drops the entire Search request
and response rather than masking selected fields.

## Analysis model

- Acquisition: `$pageview` and PostHog's standard referrer/UTM properties.
- Activation: the first `summary_succeeded` per person.
- Signup conversion: `signup_completed` after an acquisition page view.
- Engagement and retention: repeat `summary_succeeded` events and adoption of
  `chat_started`, sliced by day since first activation.
- Paid conversion endpoints remain `checkout_started` followed by
  `subscription_activated`, sliced by plan and billing interval. The
  discovery diagnostic sequence is `subscription_discovery_viewed` ->
  `subscription_discovery_clicked` -> `pricing_viewed` ->
  `plan_choice_attempted` -> `checkout_started` ->
  `subscription_activated`, sliced by source surface, presentation state,
  authentication state, device class, plan, and billing interval.
- Reliability: `summary_failed / (summary_failed + summary_succeeded)`, with
  quota, auth, rate-limit, request, and processing failures reported
  separately.

Before registration, client events use PostHog's anonymous visitor identity;
Supabase anonymous user IDs are not identified. When the visitor registers,
`PostHogUserIdentifier` identifies the registered Supabase user without a
preceding reset, preserving the pre-signup funnel on the same PostHog person.
Server-side subscription events use that registered Supabase ID as PostHog's
`distinctId`, linking paid activation to the same person. Logout and a switch
between registered accounts reset the client identity.

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

Smoke Account events are suppressed at the authenticated client identity
boundary and at the trusted server activation boundary. Canonical business
queries also exclude the durable `synthetic_smoke_account` marker from both
event and person properties, so anonymous activity later merged into a Smoke
Account cannot enter real-user conversion totals.

References:

- [PostHog Next.js integration](https://posthog.com/docs/libraries/next-js)
- [PostHog Node.js serverless capture](https://posthog.com/docs/libraries/node#short-lived-processes-like-serverless-environments)
