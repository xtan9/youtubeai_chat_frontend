import { z } from "zod";
import { ProjectSourceSetEventListSchema } from "./project-source-set-audit";
import { ProjectConversationModeSchema } from "./project-grounded-synthesis";
import {
  PROJECT_GROUNDED_ANSWER_MAX_LENGTH,
  PROJECT_CONVERSATION_NAME_MAX_LENGTH,
  projectGroundedQuestionCodePointLength,
} from "./project-grounded-input";
import {
  ProjectAnswerClassificationSchema,
  ProjectAnswerSourceManifestSchema,
  ProjectAnswerCoverageSchema,
  ProjectEvidenceSnapshotSchema,
  ProjectCitationDiagnosticSchema,
} from "./project-answer-evidence-contract";

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
