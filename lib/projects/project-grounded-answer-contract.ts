import { z } from "zod";
import {
  ProjectTranscriptPassageSchema,
  ProjectUnavailableVideoSchema,
} from "./project-passage-search-contract";
import {
  ProjectSourceSetEventListSchema,
  ProjectSourceSetEventSchema,
} from "./project-source-set-audit";
import {
  PROJECT_DEFAULT_CONVERSATION_MODE,
  ProjectConversationModeSchema,
  type ProjectConversationMode,
} from "./project-grounded-synthesis";

export {
  PROJECT_DEFAULT_CONVERSATION_MODE,
  ProjectConversationModeSchema,
} from "./project-grounded-synthesis";
export type { ProjectConversationMode } from "./project-grounded-synthesis";

export const PROJECT_QUESTION_MIN_LENGTH = 2;
export const PROJECT_QUESTION_MAX_LENGTH = 200;
export const PROJECT_GROUNDED_PASSAGE_LIMIT = 8;
export const PROJECT_GROUNDED_RETRIEVAL_LIMIT = 10;
export const PROJECT_GROUNDED_ANSWER_MAX_LENGTH = 20_000;
export const PROJECT_QUESTION_MESSAGE_ID_HEADER =
  "X-Project-Question-Message-ID";
export const PROJECT_CONVERSATION_NAME_MAX_LENGTH = 120;

export function projectGroundedQuestionCodePointLength(value: string) {
  return Array.from(value).length;
}

const ProjectQuestionSchema = z
  .string()
  .transform((question) => question.trim())
  .superRefine((question, context) => {
    const length = projectGroundedQuestionCodePointLength(question);
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
  .object({
    questionId: z.uuid(),
    question: ProjectQuestionSchema,
    conversationId: z.uuid().optional(),
    mode: ProjectConversationModeSchema
      .optional()
      .default(PROJECT_DEFAULT_CONVERSATION_MODE),
  })
  .strict();

export const ProjectGroundedCancellationRequestSchema = z
  .object({ userMessageId: z.uuid() })
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

export { ProjectSourceSetEventListSchema, ProjectSourceSetEventSchema };
export type { ProjectSourceSetEvent } from "./project-source-set-audit";

const ProjectCitationDiagnosticRawSchema = z
  .string()
  .superRefine((raw, context) => {
    const length = projectGroundedQuestionCodePointLength(raw);
    if (length < 1 || length > 80) {
      context.addIssue({
        code: "custom",
        message: "Citation diagnostic text must be 1 to 80 characters.",
      });
    }
  });

export const ProjectCitationDiagnosticSchema = z
  .object({
    kind: z.enum([
      "malformed",
      "unknown_source",
      "timestamp_not_in_evidence",
    ]),
    raw: ProjectCitationDiagnosticRawSchema,
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
    const snapshotPassageIds = new Set<string>();
    for (const passage of evidenceSnapshot.passages) {
      snapshotVideos.add(passage.videoId);
      if (snapshotPassageIds.has(passage.passageId)) {
        context.addIssue({
          code: "custom",
          message: "Evidence Snapshot passage identities must be unique.",
        });
      }
      snapshotPassageIds.add(passage.passageId);
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

export type ProjectAnswerArtifacts = z.infer<
  typeof ProjectAnswerArtifactsSchema
>;

const ProjectConversationContentSchema = z
  .string()
  .superRefine((content, context) => {
    const length = projectGroundedQuestionCodePointLength(content);
    if (length < 1 || length > PROJECT_GROUNDED_ANSWER_MAX_LENGTH) {
      context.addIssue({
        code: "custom",
        message: "Conversation content must be 1 to 20,000 characters.",
      });
    }
  });

const ConversationMessageBaseSchema = z.object({
  id: z.uuid(),
  // Added by the #326 database wrappers. Optional keeps pre-rollout fixtures
  // readable; trust analytics never infer a substitute from the loaded page.
  messageOrdinal: z.number().int().min(1).max(1_000_000).optional(),
  inReplyToMessageId: z.uuid().nullable(),
  content: ProjectConversationContentSchema,
  createdAt: z.iso.datetime({ offset: true }),
});

const ProjectConversationUserMessageSchema =
  ConversationMessageBaseSchema.extend({
    role: z.literal("user"),
    // Optional keeps legacy rows readable; new reservations always carry the
    // server-selected synthesis mode.
    mode: ProjectConversationModeSchema.optional(),
    inReplyToMessageId: z.null(),
    answerClassification: z.null(),
    // Legacy reservations may predate revision stamping. New reservations
    // always carry the exact ready Source Set revision at creation time.
    sourceSetRevision: z.number().int().nonnegative().nullable(),
    completionState: z.enum(["reserved", "completed", "cancelled"]),
    sourceManifest: z.null(),
    sourceCoverage: z.null(),
    evidenceSnapshot: z.null().optional(),
    citationDiagnostics: z.null(),
  }).strict();

export const ProjectConversationAssistantMessageSchema =
  ConversationMessageBaseSchema.extend({
    role: z.literal("assistant"),
    // Assistant mode is immutable metadata paired with the user turn.
    mode: ProjectConversationModeSchema.optional(),
    inReplyToMessageId: z.uuid(),
    answerClassification: ProjectAnswerClassificationSchema,
    completionState: z.null(),
    sourceSetRevision: z.number().int().nonnegative(),
    sourceManifest: ProjectAnswerSourceManifestSchema,
    sourceCoverage: ProjectAnswerCoverageSchema,
    // Optional keeps old client fixtures and legacy rows readable; every new
    // completed answer persists this immutable artifact.
    evidenceSnapshot: ProjectEvidenceSnapshotSchema.optional(),
    citationDiagnostics: z.array(ProjectCitationDiagnosticSchema).max(20),
    feedbackRating: z.enum(["helpful", "not_helpful"]).optional(),
  }).strict();

export const ProjectConversationMessageSchema = z.discriminatedUnion("role", [
  ProjectConversationUserMessageSchema,
  ProjectConversationAssistantMessageSchema,
]);

export type ProjectConversationMessage = z.infer<
  typeof ProjectConversationMessageSchema
>;

const ProjectConversationNameValueSchema = z
  .string()
  .trim()
  .superRefine((name, context) => {
    const length = projectGroundedQuestionCodePointLength(name);
    if (length < 1 || length > PROJECT_CONVERSATION_NAME_MAX_LENGTH) {
      context.addIssue({
        code: "custom",
        message: "Conversation names must be between 1 and 120 characters.",
      });
    }
  });

/** A selector/list representation that never includes conversation content. */
export const ProjectConversationSummarySchema = z
  .object({
    conversationId: z.uuid(),
    name: ProjectConversationNameValueSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    messageCount: z.number().int().nonnegative(),
  })
  .strict();

export type ProjectConversationSummary = z.infer<
  typeof ProjectConversationSummarySchema
>;

export const ProjectConversationListSchema = z
  .object({
    conversations: z.array(ProjectConversationSummarySchema),
    messagesUsed: z.number().int().nonnegative(),
    messagesLimit: z.literal(5).nullable(),
    tier: z.enum(["free", "pro"]),
  })
  .strict();

export type ProjectConversationList = z.infer<
  typeof ProjectConversationListSchema
>;

export const ProjectConversationDatabaseSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    messageCount: z.number().int().nonnegative(),
  })
  .strict();

export const ProjectConversationDatabaseListResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("ready"),
        conversations: z.array(ProjectConversationDatabaseSummarySchema),
        messagesUsed: z.number().int().nonnegative(),
        messagesLimit: z.literal(5).nullable(),
        tier: z.enum(["free", "pro"]),
      })
      .strict(),
    z.object({ outcome: z.literal("missing") }).strict(),
  ],
);

export const ProjectConversationNameSchema =
  ProjectConversationNameValueSchema;

export const ProjectConversationCreateRequestSchema = z
  .object({ name: ProjectConversationNameSchema.optional() })
  .strict();

export const ProjectConversationRenameRequestSchema = z
  .object({ name: ProjectConversationNameSchema })
  .strict();

export const ProjectConversationMutationDatabaseResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("created"),
        conversation: ProjectConversationDatabaseSummarySchema,
      })
      .strict(),
    z.object({ outcome: z.literal("renamed") }).strict(),
    z.object({ outcome: z.literal("cleared") }).strict(),
    z.object({ outcome: z.literal("missing") }).strict(),
    z.object({ outcome: z.literal("invalid") }).strict(),
  ]);

export const ProjectConversationPageCursorSchema = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    userMessageId: z.uuid(),
  })
  .strict();
export type ProjectConversationPageCursor = z.infer<
  typeof ProjectConversationPageCursorSchema
>;

export const ProjectSourceSetEventPageCursorSchema = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    eventId: z.uuid(),
  })
  .strict();
export type ProjectSourceSetEventPageCursor = z.infer<
  typeof ProjectSourceSetEventPageCursorSchema
>;

export const ProjectSourceSetEventPageDatabaseResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("ready"),
        events: ProjectSourceSetEventListSchema,
        nextCursor: ProjectSourceSetEventPageCursorSchema.nullable(),
      })
      .strict(),
    z.object({ outcome: z.literal("missing") }).strict(),
  ]);

export const ProjectSourceSetEventPageSchema = z
  .object({
    events: ProjectSourceSetEventListSchema,
    nextCursor: z.string().min(1).max(512).nullable(),
  })
  .strict();
export type ProjectSourceSetEventPage = z.infer<
  typeof ProjectSourceSetEventPageSchema
>;

export const ProjectConversationSchema = z
  .object({
    conversationId: z.uuid().nullable(),
    messages: z.array(ProjectConversationMessageSchema).max(100),
    sourceSetEvents: ProjectSourceSetEventListSchema.optional(),
    messagesUsed: z.number().int().nonnegative(),
    messagesLimit: z.literal(5).nullable(),
    tier: z.enum(["free", "pro"]),
    nextCursor: z.string().min(1).max(512).nullable(),
    // Optional keeps the DB-first rollout readable while old application
    // instances still return the pre-pagination conversation envelope.
    nextEventCursor: z.string().min(1).max(512).nullable().optional(),
  })
  .strict();

export type ProjectConversation = z.infer<typeof ProjectConversationSchema>;

export const ProjectConversationDatabaseResultSchema = z.discriminatedUnion(
  "outcome",
  [
    ProjectConversationSchema.omit({
      nextCursor: true,
      nextEventCursor: true,
    })
      .extend({
        outcome: z.literal("ready"),
        nextCursor: ProjectConversationPageCursorSchema.nullable(),
      })
      .strict(),
    z.object({ outcome: z.literal("missing") }).strict(),
  ],
);

export const ProjectQuestionStartDatabaseResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("started"),
        created: z.boolean(),
        conversationId: z.uuid(),
        userMessageId: z.uuid(),
        attemptToken: z.uuid(),
        completionState: z.enum(["reserved", "completed", "cancelled"]),
        messageOrdinal: z.number().int().min(1).max(1_000_000).optional(),
        messagesUsed: z.number().int().positive(),
        messagesLimit: z.literal(5).nullable(),
        tier: z.enum(["free", "pro"]),
        mode: ProjectConversationModeSchema.optional(),
        history: z.array(ProjectConversationMessageSchema).max(16),
        goal: z.string().min(1).max(2_000).nullable(),
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
  "outcome" | "created" | "completionState" | "goal"
>;

export const ProjectQuestionCancellationDatabaseResultSchema =
  z.discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("cancelled") }).strict(),
    z
      .object({
        outcome: z.literal("completed"),
        assistantMessageId: z.uuid(),
      })
      .strict(),
    z.object({ outcome: z.literal("forbidden") }).strict(),
    z.object({ outcome: z.literal("stale") }).strict(),
  ]);

export type ProjectQuestionCancellationResolution =
  | { readonly status: "cancelled" }
  | { readonly status: "completed"; readonly assistantMessageId: string }
  | { readonly status: "stale" }
  | { readonly status: "unavailable" };

export const ProjectGroundedAttemptDatabaseResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("ready"),
        userMessageId: z.uuid(),
        state: z.enum(["reserved", "completed", "cancelled"]),
        assistant: ProjectConversationAssistantMessageSchema.nullable(),
      })
      .strict()
      .superRefine((attempt, context) => {
        if (
          (attempt.state === "completed") !== (attempt.assistant !== null)
        ) {
          context.addIssue({
            code: "custom",
            message: "Completed attempts must include their assistant.",
          });
        }
      }),
    z.object({ outcome: z.literal("missing") }).strict(),
  ]);

export type ProjectGroundedAttemptResolution =
  | {
      readonly status: "ready";
      readonly userMessageId: string;
      readonly state: "reserved" | "completed" | "cancelled";
      readonly assistant: Extract<
        ProjectConversationMessage,
        { role: "assistant" }
      > | null;
    }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export const ProjectGroundedAttemptResolutionSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("ready"),
        userMessageId: z.uuid(),
        state: z.enum(["reserved", "completed", "cancelled"]),
        assistant: ProjectConversationAssistantMessageSchema.nullable(),
      })
      .strict()
      .superRefine((attempt, context) => {
        if (
          (attempt.state === "completed") !== (attempt.assistant !== null)
        ) {
          context.addIssue({
            code: "custom",
            message: "Completed attempts must include their assistant.",
          });
        }
      }),
    z.object({ status: z.literal("missing") }).strict(),
    z.object({ status: z.literal("unavailable") }).strict(),
  ],
);

export const ProjectAnswerCompletionDatabaseResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("completed"),
        assistantMessageId: z.uuid(),
        answerClassification: ProjectAnswerClassificationSchema,
        citationDiagnostics: z.array(ProjectCitationDiagnosticSchema).max(20),
      })
      .strict(),
    z
      .object({
        outcome: z.literal("already_completed"),
        assistantMessageId: z.uuid(),
        answerClassification: ProjectAnswerClassificationSchema,
        citationDiagnostics: z.array(ProjectCitationDiagnosticSchema).max(20),
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
      type: z.literal("question_reserved"),
      userMessageId: z.uuid(),
    })
    .strict(),
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
      mode: ProjectConversationModeSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal("delta"), text: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal("persistence_started"),
      userMessageId: z.uuid(),
    })
    .strict(),
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
  | (ProjectQuestionReservation & {
      readonly status: "started";
      readonly created: boolean;
      readonly completionState: "reserved" | "completed" | "cancelled";
      readonly goal: string | null;
    })
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
  load(
    conversationId?: string,
    cursor?: ProjectConversationPageCursor | null,
  ): Promise<ProjectGroundedAnswerResolution>;
  loadEvents(
    cursor?: ProjectSourceSetEventPageCursor | null,
  ): Promise<
    | ({ readonly status: "ready" } & ProjectSourceSetEventPage)
    | { readonly status: "missing" }
    | { readonly status: "unavailable" }
  >;
  loadAttempt(
    questionId: string,
    conversationId?: string,
  ): Promise<ProjectGroundedAttemptResolution>;
  start(
    questionId: string,
    question: string,
    conversationId?: string,
    mode?: ProjectConversationMode,
  ): Promise<ProjectQuestionStartResolution>;
  cancel(
    reservation: ProjectQuestionReservation,
  ): Promise<ProjectQuestionCancellationResolution>;
  beginPersistence(
    input: {
      readonly reservation: ProjectQuestionReservation;
      readonly assistantContent: string;
      readonly classification: ProjectAnswerClassification;
      readonly mode?: ProjectConversationMode;
      readonly artifacts: z.infer<typeof ProjectAnswerArtifactsSchema>;
    },
  ): Promise<ProjectAnswerCompletionResolution>;
  complete(input: {
    readonly reservation: ProjectQuestionReservation;
    readonly assistantContent: string;
    readonly classification: ProjectAnswerClassification;
    readonly mode?: ProjectConversationMode;
    readonly artifacts: z.infer<typeof ProjectAnswerArtifactsSchema>;
  }): Promise<ProjectAnswerCompletionResolution>;
}

export type ProjectConversationListResolution =
  | ({ readonly status: "ready" } & ProjectConversationList)
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export type ProjectConversationMutationResolution =
  | {
      readonly status: "created";
      readonly conversation: ProjectConversationSummary;
    }
  | { readonly status: "renamed" }
  | { readonly status: "cleared" }
  | { readonly status: "missing" }
  | { readonly status: "invalid" }
  | { readonly status: "unavailable" };

export interface ProjectConversationManagementCapability {
  list(): Promise<ProjectConversationListResolution>;
  create(name?: string): Promise<ProjectConversationMutationResolution>;
  rename(
    conversationId: string,
    name: string,
  ): Promise<ProjectConversationMutationResolution>;
  clear(conversationId: string): Promise<ProjectConversationMutationResolution>;
}
