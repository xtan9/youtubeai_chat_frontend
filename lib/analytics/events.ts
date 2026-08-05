export const ANALYTICS_SCHEMA_VERSION = 1;

export type AccountType = "anonymous" | "registered" | "free" | "pro";
export type BillingPlan = "monthly" | "yearly" | "unknown";
export type PaywallVariant = "summary-cap" | "chat-cap" | "history-cap";
export type PaywallCta = "primary" | "secondary";
export type EntitlementTier = "anon" | "free" | "pro";

export interface AnalyticsEventProperties {
  signup_completed: {
    auth_method: "email";
    email_confirmation_required: boolean;
    source_surface: "sign_up_form";
  };
  summary_succeeded: {
    account_type: "anonymous" | "registered";
    source_surface: "summary";
    result_origin: "cache" | "generated";
    output_language: string;
    transcription_seconds: number;
    summary_seconds: number;
    total_seconds: number;
  };
  summary_failed: {
    account_type: "anonymous" | "registered";
    source_surface: "summary";
    output_language: string;
    failure_category:
      | "auth"
      | "quota"
      | "rate_limit"
      | "request"
      | "processing";
    error_code: string;
    http_status?: number;
  };
  chat_started: {
    account_type: "anonymous" | "registered";
    source_surface: "summary" | "hero_demo";
  };
  checkout_started: {
    account_type: "free";
    source_surface: "pricing";
    plan: Exclude<BillingPlan, "unknown">;
    billing_interval: Exclude<BillingPlan, "unknown">;
  };
  subscription_activated: {
    source_surface: "stripe_webhook";
    plan: BillingPlan;
    billing_interval: BillingPlan;
    subscription_status: "active" | "trialing";
  };
  summary_button_clicked: {
    source_surface: "homepage";
  };
  new_summary_button_clicked: {
    source_surface: "summary";
  };
  hero_demo_sample_selected: {
    sample_id: string;
  };
  paywall_cap_hit_viewed: {
    variant: PaywallVariant;
    tier: EntitlementTier | null;
    summaries_used: number | null;
    summaries_limit: number | null;
  };
  paywall_cap_cta_clicked: {
    variant: PaywallVariant;
    cta: PaywallCta;
    tier: EntitlementTier | null;
  };
}

export type AnalyticsEventName = keyof AnalyticsEventProperties;
