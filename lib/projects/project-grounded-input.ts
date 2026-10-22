import { z } from "zod";
import {
  PROJECT_DEFAULT_CONVERSATION_MODE,
  ProjectConversationModeSchema,
} from "./project-grounded-synthesis";

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
