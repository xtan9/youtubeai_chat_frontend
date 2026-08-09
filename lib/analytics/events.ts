import type {
  LegacyCheckoutStartedProperties,
  LegacySubscriptionActivatedProperties,
  SubscriptionDiscoveryEventProperties,
} from "./subscription-discovery";
import type { ProjectLimitEventProperties } from "./project-limits";
import type { ProjectSearchEventProperties } from "./project-search";
import type { ProjectVideoProcessingEventProperties } from "./project-video-processing";

export const ANALYTICS_SCHEMA_VERSION = 1;

export type AccountType = "anonymous" | "registered" | "free" | "pro";
export type BillingPlan = "monthly" | "yearly" | "unknown";
export type PaywallVariant = "summary-cap" | "chat-cap" | "history-cap";
export type PaywallCta = "primary" | "secondary";
export type EntitlementTier = "anon" | "free" | "pro";

export const ANALYTICS_EVENT_NAMES = [
  "signup_completed",
  "summary_succeeded",
  "summary_failed",
  "chat_started",
  "subscription_discovery_viewed",
  "subscription_discovery_clicked",
  "pricing_viewed",
  "plan_choice_attempted",
  "checkout_started",
  "checkout_failed",
  "subscription_activated",
  "summary_button_clicked",
  "new_summary_button_clicked",
  "hero_demo_sample_selected",
  "paywall_cap_hit_viewed",
  "paywall_cap_cta_clicked",
  "project_limit_reached",
  "project_limit_cta_clicked",
  "project_search_completed",
  "project_video_processing_started",
  "project_video_processing_succeeded",
  "project_video_processing_failed",
] as const satisfies readonly AnalyticsEventName[];

const analyticsEventNames = new Set<string>(ANALYTICS_EVENT_NAMES);

export function isAnalyticsEventName(
  event: unknown,
): event is AnalyticsEventName {
  return typeof event === "string" && analyticsEventNames.has(event);
}

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
  subscription_discovery_viewed: SubscriptionDiscoveryEventProperties["subscription_discovery_viewed"];
  subscription_discovery_clicked: SubscriptionDiscoveryEventProperties["subscription_discovery_clicked"];
  pricing_viewed: SubscriptionDiscoveryEventProperties["pricing_viewed"];
  plan_choice_attempted: SubscriptionDiscoveryEventProperties["plan_choice_attempted"];
  checkout_started:
    | LegacyCheckoutStartedProperties
    | SubscriptionDiscoveryEventProperties["checkout_started"];
  checkout_failed: SubscriptionDiscoveryEventProperties["checkout_failed"];
  subscription_activated:
    | LegacySubscriptionActivatedProperties
    | SubscriptionDiscoveryEventProperties["subscription_activated"];
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
  project_limit_reached: ProjectLimitEventProperties["project_limit_reached"];
  project_limit_cta_clicked: ProjectLimitEventProperties["project_limit_cta_clicked"];
  project_search_completed: ProjectSearchEventProperties["project_search_completed"];
  project_video_processing_started: ProjectVideoProcessingEventProperties["project_video_processing_started"];
  project_video_processing_succeeded: ProjectVideoProcessingEventProperties["project_video_processing_succeeded"];
  project_video_processing_failed: ProjectVideoProcessingEventProperties["project_video_processing_failed"];
}

export type AnalyticsEventName = keyof AnalyticsEventProperties;
