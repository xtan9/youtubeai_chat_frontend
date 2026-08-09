import { z } from "zod";
import { YouTubeUrlSchema } from "@/lib/services/transcription-contract";
import { PROJECT_HISTORY_CANDIDATE_PAGE_SIZE } from "./project-source-set-contract";

const videoIdSchema = z.uuid({ error: "Choose a valid History Video." });
const revisionSchema = z
  .number()
  .int()
  .nonnegative()
  .safe({ error: "The Source Set revision is not valid." });

export const addProjectHistoryVideoSchema = z
  .object({
    videoId: videoIdSchema,
    expectedRevision: revisionSchema,
  })
  .strict();

export const processProjectVideoSchema = z
  .object({
    youtubeUrl: YouTubeUrlSchema,
    expectedRevision: revisionSchema,
  })
  .strict();

export const reorderProjectVideosSchema = z
  .object({
    videoIds: z
      .array(videoIdSchema)
      .max(5, "A Project Source Set supports at most five Videos."),
    expectedRevision: revisionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.videoIds).size !== value.videoIds.length) {
      context.addIssue({
        code: "custom",
        path: ["videoIds"],
        message: "Each Video must appear exactly once in the new order.",
      });
    }
  });

export const removeProjectVideoQuerySchema = z.object({
  expectedRevision: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN,
    z
      .number()
      .int()
      .nonnegative()
      .safe({ error: "The Source Set revision is not valid." }),
  ),
});

export const projectHistoryCandidateQuerySchema = z.object({
  page: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() !== "" ? Number(value) : 1,
    z.number().int().positive().max(100_000),
  ),
  search: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : ""),
    z.string().max(100),
  ),
  pageSize: z.literal(PROJECT_HISTORY_CANDIDATE_PAGE_SIZE).default(
    PROJECT_HISTORY_CANDIDATE_PAGE_SIZE,
  ),
});

export { videoIdSchema };
