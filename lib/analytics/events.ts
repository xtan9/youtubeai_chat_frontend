export const ANALYTICS_SCHEMA_VERSION = 1;

export type AccountType = "anonymous" | "registered" | "free" | "pro";
export type BillingPlan = "monthly" | "yearly" | "unknown";

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
}

export type AnalyticsEventName = keyof AnalyticsEventProperties;
