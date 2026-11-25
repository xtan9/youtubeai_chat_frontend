import { z } from "zod";

export const publicLink = z.url({ protocol: /^https?$/ }).max(3000);
const id = z.string().min(1).max(80);
export const pageText = z.object({
  label: z.string().max(140),
  text: z.string().max(16000),
  seconds: z.number().nonnegative().optional(),
});
export const digestSchema = z.object({
  summary: z.string().max(60000),
  claims: z
    .array(
      z.object({
        id: id.optional(),
        text: z.string().max(1400),
        quote: z.string().max(1800),
        location: z.string().max(140),
        seconds: z.number().nonnegative().optional(),
      }),
    )
    .max(25),
});
export const resourceSchema = z.object({
  id,
  references: z
    .array(
      z.object({
        url: publicLink,
        label: z.string().max(300),
        location: z.string().max(140),
      }),
    )
    .max(80)
    .optional(),
  originalPdf: z.boolean().optional(),
  analyzed: z.boolean().optional(),
  kind: z.enum(["web", "pdf", "video"]),
  title: z.string().min(1).max(1000),
  url: publicLink.optional(),
  pages: z.array(pageText).max(200),
  coverage: z.string().max(300),
  digest: digestSchema.optional(),
});
export type Resource = z.infer<typeof resourceSchema>;
export const passageSchema = z.object({
  draft: id,
  title: z.string().max(140),
  start: z.number().int().nonnegative(),
  text: z.string().max(80000),
});
const marker = z.object({
  start: z.number().int().nonnegative(),
  text: z.string().max(12000),
  finding: z.uuid(),
});
const outlineSection = z.object({
  heading: z.string().trim().min(1).max(140),
  questionIds: z.array(z.uuid()).max(3),
});
const draft = z.object({
  outline: z.object({
    interviewId: z.uuid(),
    sections: z.array(outlineSection).min(1).max(6),
  }).optional(),
  id,
  version: z.uuid().optional(),
  defaultTitle: z
    .union([z.literal("opening"), z.number().int().min(1).max(50)])
    .optional(),
  title: z.string().min(1).max(140),
  text: z.string().max(80000),
  markers: z.array(marker).max(300),
});
export const messageSchema = z.object({
  interviewId: z.uuid().optional(),
  suggestion: z
    .object({
      draft: id,
      version: z.uuid().optional(),
      start: z.number().int().nonnegative(),
      length: z.number().int().nonnegative(),
      options: z.array(z.string().max(10000)).max(4),
    })
    .optional(),
  role: z.enum(["user", "assistant", "handoff"]),
  text: z.string().max(16000),
  passage: passageSchema.optional(),
  finding: z.uuid().optional(),
});
export const dialogueSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  reply: z.string().trim().min(1).max(4000),
});
const claimTurnSchema = dialogueSchema.extend({
  id: z.uuid(),
  claimId: z.string().min(1).max(120),
  created: z.string(),
  finding: z.uuid().optional(),
});
export type ClaimTurn = z.infer<typeof claimTurnSchema>;
export const intentFormat = z.enum([
  "research",
  "video",
  "blog",
  "book",
  "explore",
]);
export const questionSchema = z.object({
  id: z.uuid(),
  revision: z.uuid().optional(),
  title: z.string().trim().min(3).max(500),
  hypothesis: z.string().max(1000).optional(),
  gap: z.string().max(1000).optional(),
});
export type ProjectQuestion = z.infer<typeof questionSchema>;
export const quickRepliesSchema = z.array(z.string().trim().min(1).max(120)).max(4);
export const spaceSchema = z.object({
  purpose: intentFormat.optional(),
  interview: z.object({
    id: z.uuid(),
    turnId: z.uuid(),
    format: intentFormat.optional(),
    pending: z.boolean(),
    confirmed: z.literal(true).optional(),
    notes: z.string().max(6000),
    quickReplies: quickRepliesSchema.optional(),
    brief: z.string().trim().min(1).max(6000).optional(),
  }).optional(),
  questions: z.array(questionSchema).max(150).optional(),
  claimDiscussion: z.array(claimTurnSchema).max(2000).optional(),
  activeDraft: id.optional(),
  customClaims: z
    .array(z.object({ id: z.uuid(), text: z.string().trim().min(3).max(1400) }))
    .max(150)
    .optional(),
  researchParent: z.uuid().nullable().optional(),
  researchAttempts: z
    .array(
      z.object({
        id: z.uuid(),
        question: z.string().max(2000),
        message: z.string().max(1000),
        claimId: z.string().max(120).optional(),
        evidenceGap: z.boolean().optional(),
        created: z.string(),
        origin: z
          .object({
            id: z.string(),
            title: z.string(),
            location: z.string(),
            quote: z.string(),
          })
          .optional(),
        parent: z.uuid().optional(),
      }),
    )
    .max(150)
    .optional(),
  drafts: z.array(draft).min(1).max(50),
  messages: z.array(messageSchema).max(2000),
  resources: z.array(resourceSchema).max(80),
});
export type Space = z.infer<typeof spaceSchema>;
export type Draft = Space["drafts"][number];
export type Passage = z.infer<typeof passageSchema>;
export type Message = z.infer<typeof messageSchema>;
export const emptySpace = (): Space => ({
  drafts: [
    {
      id: "opening",
      title: "Opening script",
      defaultTitle: "opening",
      text: "",
      markers: [],
    },
  ],
  messages: [],
  resources: [],
});

// Move intact references with their sentence. An edit through a citation removes it.
export function editDraft(draft: Draft, text: string): Draft {
  let start = 0,
    oldEnd = draft.text.length,
    end = text.length;
  while (start < oldEnd && start < end && draft.text[start] === text[start])
    start++;
  while (
    oldEnd > start &&
    end > start &&
    draft.text[oldEnd - 1] === text[end - 1]
  ) {
    oldEnd--;
    end--;
  }
  const markers = draft.markers.flatMap((m) =>
    m.start + m.text.length <= start
      ? [m]
      : m.start >= oldEnd
        ? [{ ...m, start: m.start + end - oldEnd }]
        : [],
  );
  return { ...draft, text, markers, version: crypto.randomUUID() };
}
