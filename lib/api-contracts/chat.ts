// Shared wire contract for the /api/chat/* surface. Both server emit and
// client parse import from here so a future event-shape change fails the
// build on both sides instead of silently misrendering.

import { z } from "zod";

const YOUTUBE_URL_RE =
  /^https:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//i;

// ---------------- Request bodies ----------------

export const ChatStreamRequestSchema = z.object({
  youtube_url: z
    .url()
    .regex(YOUTUBE_URL_RE, "must be an https YouTube URL"),
  message: z.string().min(1).max(4000),
});
export type ChatStreamRequest = z.infer<typeof ChatStreamRequestSchema>;

export const ChatMessagesQuerySchema = z.object({
  youtube_url: z
    .url()
    .regex(YOUTUBE_URL_RE, "must be an https YouTube URL"),
});
export type ChatMessagesQuery = z.infer<typeof ChatMessagesQuerySchema>;

// ---------------- Persisted thread shape ----------------

export const ChatRoleSchema = z.enum(["user", "assistant"]);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: ChatRoleSchema,
  content: z.string(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatMessagesResponseSchema = z.object({
  messages: z.array(ChatMessageSchema),
});
export type ChatMessagesResponse = z.infer<typeof ChatMessagesResponseSchema>;

// ---------------- SSE event union ----------------
//
// One source of truth for the JSON shape that the route emits and the
// client parses. Adding a variant here forces both sides to handle it
// (server: `sendEvent` is typed to ChatSseEvent; client: parseSseEvent
// rejects unknown shapes with a structured log).

export const ChatSseDeltaSchema = z.object({
  type: z.literal("delta"),
  text: z.string(),
});

export const ChatSseDoneSchema = z.object({
  type: z.literal("done"),
});

export const ChatSseErrorSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
});

export const ChatSseEventSchema = z.discriminatedUnion("type", [
  ChatSseDeltaSchema,
  ChatSseDoneSchema,
  ChatSseErrorSchema,
]);
export type ChatSseEvent = z.infer<typeof ChatSseEventSchema>;
export type ChatSseDelta = z.infer<typeof ChatSseDeltaSchema>;
export type ChatSseDone = z.infer<typeof ChatSseDoneSchema>;
export type ChatSseError = z.infer<typeof ChatSseErrorSchema>;
