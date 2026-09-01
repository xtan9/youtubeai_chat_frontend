import { z } from "zod";

import launchPacket from "../../docs/compliance/2026-09-01-channel-comment-assistance-launch-packet.json";
import {
  CURRENT_YOUTUBE_CHANNEL_COMPLIANCE_CLEARANCE,
  YouTubeComplianceClearanceSchema,
  evaluateYouTubeChannelAssessmentGate,
} from "./youtube-channel-clearance";
import {
  CURRENT_YOUTUBE_CHANNEL_OAUTH_VERIFICATION,
  evaluateYouTubeChannelOAuthVerificationGate,
} from "./youtube-channel-oauth-verification";

const EvidenceReferenceSchema = z.string().trim().min(1).max(2_000);
const CHANNEL_DISCOVERY_SPEC_URL =
  "https://github.com/xtan9/youtubeai_chat_frontend/blob/main/docs/specs/2026-08-31-comment-assistance-discovery.md";

const EvidenceGateSchema = z
  .object({
    status: z.enum(["pending", "verified", "rejected"]),
    evidenceRef: EvidenceReferenceSchema.nullable(),
  })
  .strict()
  .superRefine((gate, context) => {
    if (gate.status === "verified" && gate.evidenceRef === null) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRef"],
        message: "A verified release gate must link to its evidence.",
      });
    }
    if (gate.status === "pending" && gate.evidenceRef !== null) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRef"],
        message: "A pending release gate cannot present evidence.",
      });
    }
    if (gate.status === "rejected" && gate.evidenceRef === null) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRef"],
        message: "A rejected release gate must preserve the rejection evidence.",
      });
    }
  });

const LiveDisclosureGateSchema = z
  .object({
    status: z.enum([
      "pending_live_verification",
      "live_verified",
      "rejected",
    ]),
    repositoryPath: z.literal("app/privacy/page.tsx"),
    canonicalPath: z.literal("/privacy"),
    expectedCanonicalUrl: z.literal("https://youtubeai.chat/privacy"),
    liveUrls: z.array(z.string().url()).max(10),
    evidenceRef: EvidenceReferenceSchema.nullable(),
  })
  .strict()
  .superRefine((gate, context) => {
    if (gate.status === "pending_live_verification") {
      if (gate.liveUrls.length > 0 || gate.evidenceRef !== null) {
        context.addIssue({
          code: "custom",
          path: ["liveUrls"],
          message:
            "Repository copy is not live evidence; pending disclosures cannot contain live URLs or evidence.",
        });
      }
    }
    if (gate.status === "live_verified") {
      if (!gate.liveUrls.includes(gate.expectedCanonicalUrl)) {
        context.addIssue({
          code: "custom",
          path: ["liveUrls"],
          message: "Live disclosure evidence must include the expected privacy URL.",
        });
      }
      if (gate.evidenceRef === null) {
        context.addIssue({
          code: "custom",
          path: ["evidenceRef"],
          message: "Live disclosure verification must link to its evidence.",
        });
      }
    }
    if (gate.status === "rejected" && gate.evidenceRef === null) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRef"],
        message: "A rejected disclosure gate must preserve the rejection evidence.",
      });
    }
  });

const ChannelLaunchGatesSchema = z
  .object({
    youtubeCompliance: EvidenceGateSchema,
    oauthVerification: EvidenceGateSchema,
    liveDisclosures: LiveDisclosureGateSchema,
    offlineQuality: EvidenceGateSchema,
    lifecycleEvidence: EvidenceGateSchema,
    retentionEvidence: EvidenceGateSchema,
    accessibilityEvidence: EvidenceGateSchema,
    quotaLoadEvidence: EvidenceGateSchema,
    productionReadinessEvidence: EvidenceGateSchema,
  })
  .strict();

export const ChannelLaunchPacketSchema = z
  .object({
    recordType: z.literal("youtube-channel-comment-assistance-launch-packet"),
    recordVersion: z.literal(1),
    issueNumber: z.literal(490),
    sourceSpec: z
      .object({
        path: z.literal("docs/specs/2026-08-31-comment-assistance-discovery.md"),
        url: z.literal(CHANNEL_DISCOVERY_SPEC_URL),
      })
      .strict(),
    gates: ChannelLaunchGatesSchema,
  })
  .strict();

export type ChannelLaunchPacket = z.infer<typeof ChannelLaunchPacketSchema>;

export type ChannelLaunchGate =
  | Readonly<{
      status: "open";
      reason: "Every Channel release gate has explicit evidence.";
    }>
  | Readonly<{
      status: "blocked";
      blockedGates: readonly string[];
      reason: string;
    }>;

export type ChannelLaunchGateDependencies = Readonly<{
  oauthVerification?: unknown;
  youtubeCompliance?: unknown;
}>;

const CURRENT_GENERIC_GATES = [
  "offlineQuality",
  "lifecycleEvidence",
  "retentionEvidence",
  "accessibilityEvidence",
  "quotaLoadEvidence",
  "productionReadinessEvidence",
] as const;

function complianceEvidenceReference(input: unknown): string | null {
  const parsed = YouTubeComplianceClearanceSchema.safeParse(input);
  if (!parsed.success) return null;
  if (
    parsed.data.decision !== "permitted" &&
    parsed.data.decision !== "conditional"
  ) {
    return null;
  }
  return parsed.data.determination.sourceReference;
}

/**
 * Evaluate every release gate without promoting any one passing artifact to a
 * release decision. External records are injected only for tests or a future
 * human-reviewed packet; the checked-in defaults remain pending.
 */
export function evaluateChannelLaunchGate(
  input: unknown = CURRENT_CHANNEL_LAUNCH_PACKET,
  dependencies: ChannelLaunchGateDependencies = {},
): ChannelLaunchGate {
  const parsed = ChannelLaunchPacketSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "blocked",
      blockedGates: ["launch_packet"],
      reason: "The Channel launch packet is invalid or incomplete.",
    };
  }

  const packet = parsed.data;
  const blockedGates: string[] = [];
  const complianceGate = evaluateYouTubeChannelAssessmentGate(
    dependencies.youtubeCompliance ?? CURRENT_YOUTUBE_CHANNEL_COMPLIANCE_CLEARANCE,
  );
  const oauthGate = evaluateYouTubeChannelOAuthVerificationGate(
    dependencies.oauthVerification ?? CURRENT_YOUTUBE_CHANNEL_OAUTH_VERIFICATION,
  );
  const packetComplianceEvidenceRef = packet.gates.youtubeCompliance.evidenceRef;
  const packetOAuthEvidenceRef = packet.gates.oauthVerification.evidenceRef;
  const complianceEvidenceMatches =
    complianceGate.status === "open" &&
    packet.gates.youtubeCompliance.status === "verified" &&
    packetComplianceEvidenceRef ===
      complianceEvidenceReference(
        dependencies.youtubeCompliance ?? CURRENT_YOUTUBE_CHANNEL_COMPLIANCE_CLEARANCE,
      );
  const oauthEvidenceMatches =
    oauthGate.status === "open" &&
    packet.gates.oauthVerification.status === "verified" &&
    packetOAuthEvidenceRef === oauthGate.evidenceRef;

  if (
    packet.gates.youtubeCompliance.status !== "verified" ||
    !complianceEvidenceMatches
  ) {
    blockedGates.push("youtube_compliance");
  }
  if (
    packet.gates.oauthVerification.status !== "verified" ||
    !oauthEvidenceMatches
  ) {
    blockedGates.push("oauth_verification");
  }
  if (packet.gates.liveDisclosures.status !== "live_verified") {
    blockedGates.push("live_disclosures");
  }
  for (const gateName of CURRENT_GENERIC_GATES) {
    if (packet.gates[gateName].status !== "verified") {
      blockedGates.push(
        gateName === "retentionEvidence"
          ? "retention"
          : gateName
              .replace(/Evidence$/u, "")
              .replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`),
      );
    }
  }

  if (blockedGates.length > 0) {
    return {
      status: "blocked",
      blockedGates,
      reason: `Channel release remains blocked on: ${blockedGates.join(", ")}.`,
    };
  }

  return {
    status: "open",
    reason: "Every Channel release gate has explicit evidence.",
  };
}

export const CURRENT_CHANNEL_LAUNCH_PACKET: ChannelLaunchPacket =
  ChannelLaunchPacketSchema.parse(launchPacket);

export function parseChannelLaunchPacket(input: unknown): ChannelLaunchPacket {
  const parsed = ChannelLaunchPacketSchema.safeParse(input);
  if (!parsed.success) throw new Error("ChannelLaunchPacketInvalid");
  return parsed.data;
}
