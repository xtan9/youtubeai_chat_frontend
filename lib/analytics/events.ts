import type {
  LegacyCheckoutStartedProperties,
  LegacySubscriptionActivatedProperties,
  SubscriptionDiscoveryEventProperties,
} from "./subscription-discovery";
import type { ProjectLimitEventProperties } from "./project-limits";
import type { ProjectSearchEventProperties } from "./project-search";
import type { ProjectVideoProcessingEventProperties } from "./project-video-processing";
import type { ProjectGroundedAnswerEventProperties } from "./project-grounded-answer";
import type { ProjectArtifactEventProperties } from "./project-artifacts";
import type { ProjectActivityEventProperties } from "./project-activity";
import type { AnonymousTrialEventProperties } from "./anonymous-trial";

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
  "project_grounded_answer_completed",
  "project_video_processing_started",
  "project_video_processing_succeeded",
  "project_video_processing_failed",
  "project_artifact_generation_requested",
  "project_artifact_generation_completed",
  "project_artifact_generation_blocked",
  "project_artifact_exported",
  "project_created",
  "project_opened",
  "project_source_added",
  "project_activated",
  "project_message_sent",
  "project_citation_clicked",
  "project_answer_feedback_submitted",
  "project_paywall_viewed",
  "project_action_failed",
  "project_generation_cost_recorded",
  "anonymous_trial_started",
  "anonymous_trial_message_admitted",
  "anonymous_trial_exhausted",
  "anonymous_trial_registration_selected",
  "anonymous_trial_converted",
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
  project_grounded_answer_completed: ProjectGroundedAnswerEventProperties["project_grounded_answer_completed"];
  project_video_processing_started: ProjectVideoProcessingEventProperties["project_video_processing_started"];
  project_video_processing_succeeded: ProjectVideoProcessingEventProperties["project_video_processing_succeeded"];
  project_video_processing_failed: ProjectVideoProcessingEventProperties["project_video_processing_failed"];
  project_artifact_generation_requested: ProjectArtifactEventProperties["project_artifact_generation_requested"];
  project_artifact_generation_completed: ProjectArtifactEventProperties["project_artifact_generation_completed"];
  project_artifact_generation_blocked: ProjectArtifactEventProperties["project_artifact_generation_blocked"];
  project_artifact_exported: ProjectArtifactEventProperties["project_artifact_exported"];
  project_created: ProjectActivityEventProperties["project_created"];
  project_opened: ProjectActivityEventProperties["project_opened"];
  project_source_added: ProjectActivityEventProperties["project_source_added"];
  project_activated: ProjectActivityEventProperties["project_activated"];
  project_message_sent: ProjectActivityEventProperties["project_message_sent"];
  project_citation_clicked: ProjectActivityEventProperties["project_citation_clicked"];
  project_answer_feedback_submitted: ProjectActivityEventProperties["project_answer_feedback_submitted"];
  project_paywall_viewed: ProjectActivityEventProperties["project_paywall_viewed"];
  project_action_failed: ProjectActivityEventProperties["project_action_failed"];
  project_generation_cost_recorded: ProjectActivityEventProperties["project_generation_cost_recorded"];
  anonymous_trial_started: AnonymousTrialEventProperties["anonymous_trial_started"];
  anonymous_trial_message_admitted: AnonymousTrialEventProperties["anonymous_trial_message_admitted"];
  anonymous_trial_exhausted: AnonymousTrialEventProperties["anonymous_trial_exhausted"];
  anonymous_trial_registration_selected: AnonymousTrialEventProperties["anonymous_trial_registration_selected"];
  anonymous_trial_converted: AnonymousTrialEventProperties["anonymous_trial_converted"];
}

export type AnalyticsEventName = keyof AnalyticsEventProperties;
