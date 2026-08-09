import { z } from "zod";
import {
  ProjectTranscriptPassageSchema,
  ProjectUnavailableVideoSchema,
} from "./project-passage-search-contract";

export const PROJECT_QUESTION_MIN_LENGTH = 2;
export const PROJECT_QUESTION_MAX_LENGTH = 200;
export const PROJECT_GROUNDED_PASSAGE_LIMIT = 8;
export const PROJECT_GROUNDED_RETRIEVAL_LIMIT = 10;

function codePointLength(value: string) {
  return Array.from(value).length;
}

const ProjectQuestionSchema = z
  .string()
  .transform((question) => question.trim())
  .superRefine((question, context) => {
    const length = codePointLength(question);
    if (length < PROJECT_QUESTION_MIN_LENGTH) {
      context.addIssue({
        code: "custom",
        message: "Enter at least 2 characters for your question.",
      });
    }
    if (length > PROJECT_QUESTION_MAX_LENGTH) {
      context.addIssue({
        code: "custom",
        message: "Questions must be 200 characters or fewer.",
      });
    }
  });

export const ProjectGroundedQuestionRequestSchema = z
  .object({ question: ProjectQuestionSchema })
  .strict();

export type ProjectGroundedQuestionRequest = z.infer<
  typeof ProjectGroundedQuestionRequestSchema
>;

export const ProjectAnswerClassificationSchema = z.enum([
  "supported",
  "abstained",
  "unsupported",
]);
export type ProjectAnswerClassification = z.infer<
  typeof ProjectAnswerClassificationSchema
>;

const ManifestPassageSchema = z
  .object({
    passageId: z.string().min(1).max(80),
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().nonnegative().nullable(),
  })
  .strict();

export const ProjectAnswerManifestSourceSchema = z
  .object({
    sourceId: z.string().regex(/^S[1-5]$/),
    videoId: z.uuid(),
    youtubeVideoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
    title: z.string().nullable(),
    channelName: z.string().nullable(),
    passages: z.array(ManifestPassageSchema).min(1).max(10),
  })
  .strict();

export type ProjectAnswerManifestSource = z.infer<
  typeof ProjectAnswerManifestSourceSchema
>;

export const ProjectAnswerSourceManifestSchema = z
  .object({
    projectId: z.uuid(),
    sourceSetRevision: z.number().int().nonnegative(),
    sources: z.array(ProjectAnswerManifestSourceSchema).max(5),
  })
  .strict()
  .superRefine((manifest, context) => {
    const sourceIds = new Set<string>();
    const videoIds = new Set<string>();
    const passageIds = new Set<string>();
    manifest.sources.forEach((source, sourceIndex) => {
      if (source.sourceId !== `S${sourceIndex + 1}`) {
        context.addIssue({
          code: "custom",
          path: ["sources", sourceIndex, "sourceId"],
          message: "Source aliases must be sequential and stable.",
        });
      }
      if (sourceIds.has(source.sourceId) || videoIds.has(source.videoId)) {
        context.addIssue({
          code: "custom",
          path: ["sources", sourceIndex],
          message: "Manifest sources must be unique.",
        });
      }
      sourceIds.add(source.sourceId);
      videoIds.add(source.videoId);
      for (const passage of source.passages) {
        if (passageIds.has(passage.passageId)) {
          context.addIssue({
            code: "custom",
            path: ["sources", sourceIndex, "passages"],
            message: "Manifest passage identities must be unique.",
          });
        }
        passageIds.add(passage.passageId);
      }
    });
  });

export type ProjectAnswerSourceManifest = z.infer<
  typeof ProjectAnswerSourceManifestSchema
>;

export const ProjectAnswerCoverageSchema = z
  .object({
    totalVideos: z.number().int().min(0).max(5),
    readyVideos: z.number().int().min(0).max(5),
    usedVideos: z.number().int().min(0).max(5),
    unavailableVideos: z.array(ProjectUnavailableVideoSchema).max(5),
    passagesExamined: z.number().int().nonnegative(),
    passagesUsed: z.number().int().min(0).max(10),
  })
  .strict()
  .superRefine((coverage, context) => {
    if (
      coverage.readyVideos + coverage.unavailableVideos.length !==
      coverage.totalVideos
    ) {
      context.addIssue({
        code: "custom",
        message: "Project answer coverage totals are incoherent.",
      });
    }
    if (coverage.usedVideos > coverage.readyVideos) {
      context.addIssue({
        code: "custom",
        message: "Used Videos cannot exceed ready Videos.",
      });
    }
    if (coverage.passagesUsed > coverage.passagesExamined) {
      context.addIssue({
        code: "custom",
        message: "Used passages cannot exceed examined passages.",
      });
    }
  });

export type ProjectAnswerCoverage = z.infer<
  typeof ProjectAnswerCoverageSchema
>;

export const ProjectEvidenceSnapshotSchema = z
  .object({
    projectId: z.uuid(),
    sourceSetRevision: z.number().int().nonnegative(),
    passages: z.array(ProjectTranscriptPassageSchema).max(10),
  })
  .strict();

export type ProjectEvidenceSnapshot = z.infer<
  typeof ProjectEvidenceSnapshotSchema
>;

export const ProjectCitationDiagnosticSchema = z
  .object({
    kind: z.enum([
      "malformed",
      "unknown_source",
      "timestamp_not_in_evidence",
    ]),
    raw: z.string().min(1).max(80),
    sourceId: z.string().max(8).optional(),
  })
  .strict();

export type ProjectCitationDiagnostic = z.infer<
  typeof ProjectCitationDiagnosticSchema
>;

export const ProjectAnswerArtifactsSchema = z
  .object({
    sourceManifest: ProjectAnswerSourceManifestSchema,
    sourceCoverage: ProjectAnswerCoverageSchema,
    evidenceSnapshot: ProjectEvidenceSnapshotSchema,
  })
  .strict()
  .superRefine((artifacts, context) => {
    const { sourceManifest, sourceCoverage, evidenceSnapshot } = artifacts;
    if (
      sourceManifest.projectId !== evidenceSnapshot.projectId ||
      sourceManifest.sourceSetRevision !== evidenceSnapshot.sourceSetRevision
    ) {
      context.addIssue({
        code: "custom",
        message: "Evidence artifacts must share one Project revision.",
      });
    }

    const manifestPassages = new Map<
      string,
      { videoId: string; youtubeVideoId: string; startSeconds: number; endSeconds: number | null }
    >();
    for (const source of sourceManifest.sources) {
      for (const passage of source.passages) {
        manifestPassages.set(passage.passageId, {
          videoId: source.videoId,
          youtubeVideoId: source.youtubeVideoId,
          startSeconds: passage.startSeconds,
          endSeconds: passage.endSeconds,
        });
      }
    }

    const snapshotVideos = new Set<string>();
    for (const passage of evidenceSnapshot.passages) {
      snapshotVideos.add(passage.videoId);
      const manifestPassage = manifestPassages.get(passage.passageId);
      if (
        !manifestPassage ||
        manifestPassage.videoId !== passage.videoId ||
        manifestPassage.youtubeVideoId !== passage.youtubeVideoId ||
        manifestPassage.startSeconds !== passage.startSeconds ||
        manifestPassage.endSeconds !== passage.endSeconds
      ) {
        context.addIssue({
          code: "custom",
          message: "Every Evidence Snapshot passage must match its manifest identity.",
        });
      }
    }
    if (manifestPassages.size !== evidenceSnapshot.passages.length) {
      context.addIssue({
        code: "custom",
        message: "Manifest and Evidence Snapshot passage counts must match.",
      });
    }
    if (
      sourceCoverage.usedVideos !== snapshotVideos.size ||
      sourceCoverage.usedVideos !== sourceManifest.sources.length ||
      sourceCoverage.passagesUsed !== evidenceSnapshot.passages.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Source Coverage must match the selected Evidence Snapshot.",
      });
    }
  });

const ConversationMessageBaseSchema = z.object({
  id: z.uuid(),
  inReplyToMessageId: z.uuid().nullable(),
  content: z.string().min(1).max(20000),
  createdAt: z.string(),
});

export const ProjectConversationMessageSchema = z.discriminatedUnion("role", [
  ConversationMessageBaseSchema.extend({
    role: z.literal("user"),
    inReplyToMessageId: z.null(),
    answerClassification: z.null(),
    sourceSetRevision: z.null(),
    sourceManifest: z.null(),
    sourceCoverage: z.null(),
    citationDiagnostics: z.null(),
  }).strict(),
  ConversationMessageBaseSchema.extend({
    role: z.literal("assistant"),
    inReplyToMessageId: z.uuid(),
    answerClassification: ProjectAnswerClassificationSchema,
    sourceSetRevision: z.number().int().nonnegative(),
    sourceManifest: ProjectAnswerSourceManifestSchema,
    sourceCoverage: ProjectAnswerCoverageSchema,
    citationDiagnostics: z.array(ProjectCitationDiagnosticSchema).max(20),
  }).strict(),
]);

export type ProjectConversationMessage = z.infer<
  typeof ProjectConversationMessageSchema
>;

export const ProjectConversationSchema = z
  .object({
    conversationId: z.uuid().nullable(),
    messages: z.array(ProjectConversationMessageSchema).max(100),
    messagesUsed: z.number().int().nonnegative(),
    messagesLimit: z.literal(5).nullable(),
    tier: z.enum(["free", "pro"]),
  })
  .strict();

export type ProjectConversation = z.infer<typeof ProjectConversationSchema>;

export const ProjectConversationDatabaseResultSchema = z.discriminatedUnion(
  "outcome",
  [
    ProjectConversationSchema.extend({ outcome: z.literal("ready") }).strict(),
    z.object({ outcome: z.literal("missing") }).strict(),
  ],
);

export const ProjectQuestionStartDatabaseResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("started"),
        conversationId: z.uuid(),
        userMessageId: z.uuid(),
        attemptToken: z.uuid(),
        messagesUsed: z.number().int().positive(),
        messagesLimit: z.literal(5).nullable(),
        tier: z.enum(["free", "pro"]),
        history: z.array(ProjectConversationMessageSchema).max(16),
      })
      .strict(),
    z
      .object({
        outcome: z.literal("limit_reached"),
        messagesUsed: z.literal(5),
        messagesLimit: z.literal(5),
        tier: z.literal("free"),
      })
      .strict(),
    z.object({ outcome: z.literal("invalid") }).strict(),
    z.object({ outcome: z.literal("missing") }).strict(),
  ],
);

export type ProjectQuestionReservation = Omit<
  Extract<
    z.infer<typeof ProjectQuestionStartDatabaseResultSchema>,
    { outcome: "started" }
  >,
  "outcome"
>;

export const ProjectAnswerCompletionDatabaseResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("completed"),
        assistantMessageId: z.uuid(),
      })
      .strict(),
    z
      .object({
        outcome: z.literal("already_completed"),
        assistantMessageId: z.uuid(),
      })
      .strict(),
    z.object({ outcome: z.literal("forbidden") }).strict(),
    z.object({ outcome: z.literal("stale") }).strict(),
    z.object({ outcome: z.literal("invalid") }).strict(),
  ],
);

export type ProjectAnswerCompletion = z.infer<
  typeof ProjectAnswerCompletionDatabaseResultSchema
>;

export type ProjectAnswerCompletionResolution =
  | ProjectAnswerCompletion
  | { readonly outcome: "unavailable" };

export const ProjectGroundedSseEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("source_manifest"),
      manifest: ProjectAnswerSourceManifestSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("source_coverage"),
      coverage: ProjectAnswerCoverageSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("answer_start"),
      classification: ProjectAnswerClassificationSchema,
    })
    .strict(),
  z.object({ type: z.literal("delta"), text: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal("citation_diagnostics"),
      diagnostics: z.array(ProjectCitationDiagnosticSchema).max(20),
    })
    .strict(),
  z
    .object({ type: z.literal("done"), assistantMessageId: z.uuid() })
    .strict(),
  z.object({ type: z.literal("error"), message: z.string().min(1) }).strict(),
]);

export type ProjectGroundedSseEvent = z.infer<
  typeof ProjectGroundedSseEventSchema
>;

export type ProjectGroundedAnswerResolution =
  | { readonly status: "ready"; readonly conversation: ProjectConversation }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export type ProjectQuestionStartResolution =
  | ({ readonly status: "started" } & Omit<ProjectQuestionReservation, "outcome">)
  | {
      readonly status: "limit_reached";
      readonly messagesUsed: 5;
      readonly messagesLimit: 5;
      readonly tier: "free";
    }
  | { readonly status: "invalid" }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface ProjectGroundedAnswerCapability {
  load(): Promise<ProjectGroundedAnswerResolution>;
  start(question: string): Promise<ProjectQuestionStartResolution>;
  complete(input: {
    readonly reservation: ProjectQuestionReservation;
    readonly assistantContent: string;
    readonly classification: ProjectAnswerClassification;
    readonly artifacts: z.infer<typeof ProjectAnswerArtifactsSchema>;
    readonly citationDiagnostics: readonly ProjectCitationDiagnostic[];
  }): Promise<ProjectAnswerCompletionResolution>;
}
