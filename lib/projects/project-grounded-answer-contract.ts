import { z } from "zod";
import {
  ProjectSourceSetEventListSchema,
  ProjectSourceSetEventSchema,
} from "./project-source-set-audit";
import {
  ProjectConversationModeSchema,
  type ProjectConversationMode,
} from "./project-grounded-synthesis";
import {
  ProjectAnswerClassificationSchema,
  type ProjectAnswerClassification,
  ProjectAnswerSourceManifestSchema,
  ProjectAnswerCoverageSchema,
  ProjectCitationDiagnosticSchema,
  ProjectAnswerArtifactsSchema,
} from "./project-answer-evidence-contract";
import {
  ProjectConversationAssistantMessageSchema,
  ProjectConversationMessageSchema,
  type ProjectConversationMessage,
  type ProjectConversationPageCursor,
  type ProjectSourceSetEventPageCursor,
  type ProjectSourceSetEventPage,
  type ProjectConversation,
} from "./project-conversation-contract";

export {
  PROJECT_DEFAULT_CONVERSATION_MODE,
  ProjectConversationModeSchema,
} from "./project-grounded-synthesis";

export type { ProjectConversationMode } from "./project-grounded-synthesis";

export { ProjectSourceSetEventListSchema, ProjectSourceSetEventSchema };

export type { ProjectSourceSetEvent } from "./project-source-set-audit";

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

export {
  PROJECT_QUESTION_MIN_LENGTH,
  PROJECT_QUESTION_MAX_LENGTH,
  PROJECT_GROUNDED_PASSAGE_LIMIT,
  PROJECT_GROUNDED_RETRIEVAL_LIMIT,
  PROJECT_GROUNDED_ANSWER_MAX_LENGTH,
  PROJECT_QUESTION_MESSAGE_ID_HEADER,
  PROJECT_CONVERSATION_NAME_MAX_LENGTH,
  projectGroundedQuestionCodePointLength,
  ProjectGroundedQuestionRequestSchema,
  ProjectGroundedCancellationRequestSchema,
  type ProjectGroundedQuestionRequest,
} from "./project-grounded-input";

export {
  ProjectAnswerClassificationSchema,
  type ProjectAnswerClassification,
  ProjectAnswerManifestSourceSchema,
  type ProjectAnswerManifestSource,
  ProjectAnswerSourceManifestSchema,
  type ProjectAnswerSourceManifest,
  ProjectAnswerCoverageSchema,
  type ProjectAnswerCoverage,
  ProjectEvidenceSnapshotSchema,
  type ProjectEvidenceSnapshot,
  ProjectCitationDiagnosticSchema,
  type ProjectCitationDiagnostic,
  ProjectAnswerArtifactsSchema,
  type ProjectAnswerArtifacts,
} from "./project-answer-evidence-contract";

export {
  ProjectConversationAssistantMessageSchema,
  ProjectConversationMessageSchema,
  type ProjectConversationMessage,
  ProjectConversationSummarySchema,
  type ProjectConversationSummary,
  ProjectConversationListSchema,
  type ProjectConversationList,
  ProjectConversationDatabaseSummarySchema,
  ProjectConversationDatabaseListResultSchema,
  ProjectConversationNameSchema,
  ProjectConversationCreateRequestSchema,
  ProjectConversationRenameRequestSchema,
  ProjectConversationMutationDatabaseResultSchema,
  ProjectConversationPageCursorSchema,
  type ProjectConversationPageCursor,
  ProjectSourceSetEventPageCursorSchema,
  type ProjectSourceSetEventPageCursor,
  ProjectSourceSetEventPageDatabaseResultSchema,
  ProjectSourceSetEventPageSchema,
  type ProjectSourceSetEventPage,
  ProjectConversationSchema,
  type ProjectConversation,
  ProjectConversationDatabaseResultSchema,
  type ProjectConversationListResolution,
  type ProjectConversationMutationResolution,
  type ProjectConversationManagementCapability,
} from "./project-conversation-contract";
