import { z } from "zod";

import clearanceRecord from "../../docs/compliance/youtube-channel-comment-assistance-clearance.json";

const NonEmptyStringSchema = z.string().trim().min(1);
const IsoDateSchema = NonEmptyStringSchema.regex(
  /^\d{4}-\d{2}-\d{2}$/u,
  "Expected an ISO calendar date (YYYY-MM-DD)",
);

const SourceSpecSchema = z
  .object({
    path: z.literal("docs/specs/2026-08-31-comment-assistance-discovery.md"),
    url: z.string().url(),
  })
  .strict();

const NotReviewedPacketSchema = z
  .object({
    issueNumber: z.literal(469),
    status: z.literal("not_available"),
    reason: NonEmptyStringSchema,
  })
  .strict();

const ReviewedPacketSchema = z
  .object({
    issueNumber: z.literal(469),
    status: z.literal("reviewed"),
    artifactPath: NonEmptyStringSchema,
    revision: NonEmptyStringSchema,
    reviewedAt: IsoDateSchema,
    reviewedBy: NonEmptyStringSchema,
  })
  .strict();

const DeterminationSchema = z
  .object({
    responseDate: IsoDateSchema,
    reviewerOrAuthority: NonEmptyStringSchema,
    applicablePolicies: z.array(NonEmptyStringSchema).min(1),
    permittedScope: NonEmptyStringSchema,
    prohibitedScope: NonEmptyStringSchema,
    sourceReference: NonEmptyStringSchema,
    verbatimResponse: NonEmptyStringSchema,
  })
  .strict();

const PermittedCoverageSchema = z
  .object({
    customPerCommentBehavioralAssessment: z.literal(true),
    modelProviderFlow: z.literal(true),
    retentionApproach: z.literal(true),
  })
  .strict();

const ConditionSchema = z
  .object({
    id: NonEmptyStringSchema,
    prerequisite: z.enum(["launch", "implementation"]),
    description: NonEmptyStringSchema,
    status: z.enum(["open", "satisfied"]),
    evidenceRef: NonEmptyStringSchema.optional(),
  })
  .strict()
  .superRefine((condition, context) => {
    if (condition.status === "satisfied" && !condition.evidenceRef) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRef"],
        message: "A satisfied prerequisite must link to its evidence.",
      });
    }
  });

const BaseClearanceSchema = z.object({
  recordType: z.literal(
    "youtube-channel-comment-assistance-compliance-clearance",
  ),
  recordVersion: z.literal(1),
  issueNumber: z.literal(470),
  sourceSpec: SourceSpecSchema,
});

const PendingClearanceSchema = BaseClearanceSchema.extend({
  decision: z.literal("pending_external_determination"),
  packet: NotReviewedPacketSchema,
  determination: z.null(),
}).strict();

const PermittedClearanceSchema = BaseClearanceSchema.extend({
  decision: z.literal("permitted"),
  packet: ReviewedPacketSchema,
  determination: DeterminationSchema,
  coverage: PermittedCoverageSchema,
  conditions: z.array(z.never()).length(0),
}).strict();

const ConditionalClearanceSchema = BaseClearanceSchema.extend({
  decision: z.literal("conditional"),
  packet: ReviewedPacketSchema,
  determination: DeterminationSchema,
  coverage: PermittedCoverageSchema,
  conditions: z.array(ConditionSchema).min(1),
}).strict();

const RejectedClearanceSchema = BaseClearanceSchema.extend({
  decision: z.literal("rejected"),
  packet: ReviewedPacketSchema,
  determination: DeterminationSchema,
  conditions: z.array(z.never()).length(0),
  noGo: z
    .object({
      outcome: NonEmptyStringSchema,
      integrationStatus: z.literal("blocked"),
    })
    .strict(),
}).strict();

export const YouTubeComplianceClearanceSchema = z.discriminatedUnion(
  "decision",
  [
    PendingClearanceSchema,
    PermittedClearanceSchema,
    ConditionalClearanceSchema,
    RejectedClearanceSchema,
  ],
);

export type YouTubeComplianceClearance = z.infer<
  typeof YouTubeComplianceClearanceSchema
>;

export type YouTubeComplianceDecision =
  YouTubeComplianceClearance["decision"];

export type YouTubeChannelAssessmentGate =
  | {
      status: "open";
      decision: "permitted" | "conditional";
      reason: string;
    }
  | {
      status: "blocked";
      decision?: YouTubeComplianceDecision;
      reason: string;
    };

export const CURRENT_YOUTUBE_CHANNEL_COMPLIANCE_CLEARANCE: YouTubeComplianceClearance =
  YouTubeComplianceClearanceSchema.parse(clearanceRecord);

export function evaluateYouTubeChannelAssessmentGate(
  input: unknown,
): YouTubeChannelAssessmentGate {
  const parsed = YouTubeComplianceClearanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "blocked",
      reason: "The YouTube compliance clearance record is invalid or incomplete.",
    };
  }

  const clearance = parsed.data;
  switch (clearance.decision) {
    case "pending_external_determination":
      return {
        status: "blocked",
        decision: clearance.decision,
        reason:
          "A written YouTube determination is pending; real YouTube API Data assessment remains blocked.",
      };
    case "rejected":
      return {
        status: "blocked",
        decision: clearance.decision,
        reason:
          "The written determination rejects the approved Channel assessment scope; real YouTube API Data assessment remains blocked.",
      };
    case "conditional": {
      const openConditions = clearance.conditions.filter(
        (condition) => condition.status === "open",
      );
      if (openConditions.length > 0) {
        return {
          status: "blocked",
          decision: clearance.decision,
          reason: `Conditional clearance prerequisites remain open: ${openConditions
            .map((condition) => condition.id)
            .join(", ")}.`,
        };
      }
      return {
        status: "open",
        decision: clearance.decision,
        reason: "All written conditional clearance prerequisites are evidenced.",
      };
    }
    case "permitted":
      return {
        status: "open",
        decision: clearance.decision,
        reason:
          "The written permitted determination covers the approved Channel assessment scope.",
      };
  }
}

export function parseYouTubeChannelComplianceClearance(
  input: unknown,
): YouTubeComplianceClearance {
  const parsed = YouTubeComplianceClearanceSchema.safeParse(input);
  if (!parsed.success) throw new Error("YouTubeComplianceClearanceInvalid");
  return parsed.data;
}
