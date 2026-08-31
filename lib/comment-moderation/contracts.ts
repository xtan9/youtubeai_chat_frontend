import { z } from "zod";

export const DEFAULT_REPLY_TEMPLATE =
  "本条回复被 YouTubeAI 检测为疑似包含人身攻击或恶意挑衅。为维护讨论秩序，AI 代为回复：{{reply}}";

export const moderationSourceSchema = z.enum(["creator", "consumer"]);
export type ModerationSource = z.infer<typeof moderationSourceSchema>;

export const moderationClassificationSchema = z.enum([
  "hostile",
  "critical",
  "benign",
]);
export type ModerationClassification = z.infer<
  typeof moderationClassificationSchema
>;

export const moderationStatusSchema = z.enum([
  "draft",
  "ignored",
  "publishing",
  "replied",
  "failed",
]);
export type ModerationStatus = z.infer<typeof moderationStatusSchema>;

export const scanRequestSchema = z
  .object({
    source: moderationSourceSchema,
    videoUrl: z.string().trim().max(500).optional(),
  })
  .superRefine((value, context) => {
    if (value.source === "consumer" && !value.videoUrl) {
      context.addIssue({
        code: "custom",
        path: ["videoUrl"],
        message: "Paste the video where you left the comment.",
      });
    }
  });

export const moderationSettingsSchema = z.object({
  autoReplyEnabled: z.boolean(),
  autoReplyThreshold: z.number().min(0.8).max(0.99),
  replyTemplate: z
    .string()
    .trim()
    .min(10)
    .max(800)
    .refine((value) => value.includes("{{reply}}"), {
      message: "The template must include {{reply}}.",
    }),
});

export type ModerationSettings = z.infer<typeof moderationSettingsSchema>;

export type SafeYouTubeConnection = Readonly<{
  channelId: string;
  channelTitle: string;
  autoReplyEnabled: boolean;
  autoReplyThreshold: number;
  replyTemplate: string;
  lastScanAt: string | null;
}>;

export type ModerationItem = Readonly<{
  id: string;
  youtubeCommentId: string;
  youtubeParentCommentId: string;
  youtubeVideoId: string;
  authorDisplayName: string;
  commentText: string;
  publishedAt: string | null;
  source: ModerationSource;
  classification: ModerationClassification;
  confidence: number;
  reasonCodes: readonly string[];
  suggestedReply: string;
  renderedReply: string;
  status: ModerationStatus;
  youtubeReplyId: string | null;
  errorCode: string | null;
  createdAt: string;
}>;

export type YouTubeCommentCandidate = Readonly<{
  commentId: string;
  parentCommentId: string;
  videoId: string;
  authorChannelId: string | null;
  authorDisplayName: string;
  text: string;
  publishedAt: string | null;
}>;

export type ClassifiedComment = Readonly<{
  candidate: YouTubeCommentCandidate;
  classification: ModerationClassification;
  confidence: number;
  reasonCodes: readonly string[];
  suggestedReply: string;
}>;

export function renderReplyTemplate(template: string, reply: string): string {
  return template.replaceAll("{{reply}}", reply.trim()).trim();
}
