/**
 * PostHog properties shared by client and server business analytics.
 *
 * The synthetic value is deliberately separate from Auth's trusted
 * `app_metadata.is_smoke_account` marker. Auth remains the source of truth;
 * this value is the durable measurement marker used by PostHog queries after
 * the identity has been resolved.
 */
export const ANALYTICS_SUBJECT_PROPERTY = "analytics_subject" as const;
export const ANALYTICS_HUMAN_SUBJECT = "human" as const;
export const ANALYTICS_SYNTHETIC_SUBJECT = "synthetic_smoke_account" as const;

export const SMOKE_ACCOUNT_ANALYTICS_PROPERTIES = {
  [ANALYTICS_SUBJECT_PROPERTY]: ANALYTICS_SYNTHETIC_SUBJECT,
} as const;

