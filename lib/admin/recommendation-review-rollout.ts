import "server-only";

import { requireAdminPage } from "@/app/admin/_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";

type RecommendationRpcResult = Record<string, unknown>;

type ReviewInput = {
  recommendationSetId: string;
  recommendationOrdinal: number;
  admissionCompliant: boolean;
  relationshipSupported: boolean;
  explanationSupported: boolean;
  explanationSafe: boolean;
  useful: boolean;
  rejectionReason: string | null;
};

type ReviewFilters = {
  sourceVideoId?: string | null;
  relationship?: string | null;
  evidenceLevel?: string | null;
  setPolicyVersion?: string | null;
  buildState?: string | null;
  failureClass?: string | null;
  semanticModelIdentifier?: string | null;
  assessmentModelIdentifier?: string | null;
  candidatePairPolicyVersion?: string | null;
  relationshipPolicyVersion?: string | null;
  candidatePairModelIdentifier?: string | null;
  sourceCatalogAdmissionPolicyVersion?: string | null;
  candidateCatalogAdmissionPolicyVersion?: string | null;
};

async function recommendationAdminClient() {
  const principal = await requireAdminPage();
  const client = requireAdminClient(
    { email: principal.email },
    principal.allowlist,
  );
  return { client, principal };
}

async function callRecommendationRpc<T extends RecommendationRpcResult>(
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { client } = await recommendationAdminClient();
  const { data, error } = await client.rpc(functionName, args);
  if (error) throw error;
  return data as T;
}

/**
 * Server-only adapter for the dormant Review RPC. The caller cannot supply an
 * administrator identity: requireAdminPage produces the gated principal and
 * the service-role client is created only after that check succeeds.
 */
export async function submitRecommendationReviewAsAdmin(
  input: ReviewInput,
): Promise<RecommendationRpcResult> {
  const { client, principal } = await recommendationAdminClient();
  const { data, error } = await client.rpc("submit_recommendation_review", {
    p_recommendation_set_id: input.recommendationSetId,
    p_recommendation_ordinal: input.recommendationOrdinal,
    p_reviewer_id: principal.userId,
    p_reviewer_email: principal.email,
    p_admission_compliant: input.admissionCompliant,
    p_relationship_supported: input.relationshipSupported,
    p_explanation_supported: input.explanationSupported,
    p_explanation_safe: input.explanationSafe,
    p_useful: input.useful,
    p_rejection_reason: input.rejectionReason,
  });
  if (error) throw error;
  return data as RecommendationRpcResult;
}

export async function listRecommendationReviewsAsAdmin(
  filters: ReviewFilters = {},
): Promise<RecommendationRpcResult> {
  return callRecommendationRpc("list_recommendation_reviews", {
    p_source_video_id: filters.sourceVideoId ?? null,
    p_relationship: filters.relationship ?? null,
    p_evidence_level: filters.evidenceLevel ?? null,
    p_set_policy_version: filters.setPolicyVersion ?? null,
    p_build_state: filters.buildState ?? null,
    p_failure_class: filters.failureClass ?? null,
    p_semantic_model_identifier: filters.semanticModelIdentifier ?? null,
    p_assessment_model_identifier: filters.assessmentModelIdentifier ?? null,
    p_candidate_pair_policy_version:
      filters.candidatePairPolicyVersion ?? null,
    p_relationship_policy_version: filters.relationshipPolicyVersion ?? null,
    p_candidate_pair_model_identifier:
      filters.candidatePairModelIdentifier ?? null,
    p_source_catalog_admission_policy_version:
      filters.sourceCatalogAdmissionPolicyVersion ?? null,
    p_candidate_catalog_admission_policy_version:
      filters.candidateCatalogAdmissionPolicyVersion ?? null,
  });
}

export async function computeRecommendationQualityReportAsAdmin(
  reviewPolicyVersion: string,
): Promise<RecommendationRpcResult> {
  return callRecommendationRpc("compute_recommendation_quality_report", {
    p_review_policy_version: reviewPolicyVersion,
  });
}

export async function recordRecommendationReadyReadAsAdmin(
  recommendationSetId: string,
  recommendationOrdinal: number,
): Promise<RecommendationRpcResult> {
  return callRecommendationRpc("record_recommendation_ready_read", {
    p_recommendation_set_id: recommendationSetId,
    p_recommendation_ordinal: recommendationOrdinal,
  });
}

export async function setRecommendationRolloutAsAdmin(input: {
  requestedState: "off" | "shadow" | "pilot" | "on";
  killSwitch: boolean;
  qualityReportId: string | null;
}): Promise<RecommendationRpcResult> {
  const { client, principal } = await recommendationAdminClient();
  const { data, error } = await client.rpc("set_recommendation_rollout", {
    p_requested_state: input.requestedState,
    p_kill_switch: input.killSwitch,
    p_quality_report_id: input.qualityReportId,
    p_admin_id: principal.userId,
    p_admin_email: principal.email,
  });
  if (error) throw error;
  return data as RecommendationRpcResult;
}

export async function getRecommendationRolloutAsAdmin(): Promise<RecommendationRpcResult> {
  return callRecommendationRpc("get_recommendation_rollout", {});
}
