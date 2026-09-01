import {
  evaluateYouTubeChannelAssessmentGate,
} from "@/lib/compliance/youtube-channel-clearance";
import {
  evaluateYouTubeOAuthVerificationGate,
} from "./oauth-verification";
import { YOUTUBE_READONLY_SCOPE_SET } from "./scopes";

export type ChannelOnboardingGates = Readonly<{
  complianceClearance: unknown;
  oauthVerification: unknown;
}>;

export type ChannelOnboardingGateResult =
  | Readonly<{ status: "open" }>
  | Readonly<{
      status: "blocked";
      reason: "compliance_clearance_required" | "oauth_verification_required";
    }>;

/**
 * Keep external launch evidence separate from account identity and require
 * both records at every connection boundary. Missing or malformed evidence
 * is indistinguishable from a closed gate to callers.
 */
export function evaluateChannelOnboardingGates(
  gates: ChannelOnboardingGates | null | undefined,
): ChannelOnboardingGateResult {
  if (!gates) {
    return { status: "blocked", reason: "compliance_clearance_required" };
  }

  const compliance = evaluateYouTubeChannelAssessmentGate(
    gates.complianceClearance,
  );
  if (compliance.status !== "open") {
    return { status: "blocked", reason: "compliance_clearance_required" };
  }

  const oauth = evaluateYouTubeOAuthVerificationGate(
    gates.oauthVerification,
    YOUTUBE_READONLY_SCOPE_SET,
  );
  if (oauth.status !== "open") {
    return { status: "blocked", reason: "oauth_verification_required" };
  }

  return { status: "open" };
}
