import { z } from "zod";

export const PROJECT_PASSAGE_SEARCH_DEFAULT_LIMIT = 8;
export const PROJECT_PASSAGE_SEARCH_MAX_LIMIT = 10;
export const PROJECT_PASSAGE_SEARCH_MAX_TEXT_LENGTH = 600;
export const PROJECT_PASSAGE_SEARCH_QUERY_MIN_LENGTH = 2;
export const PROJECT_PASSAGE_SEARCH_QUERY_MAX_LENGTH = 200;

export function projectPassageSearchCodePointLength(value: string) {
  return Array.from(value).length;
}

const ProjectPassageSearchQuerySchema = z
  .string()
  .transform((query) => query.trim())
  .superRefine((query, context) => {
    const length = projectPassageSearchCodePointLength(query);
    if (length < PROJECT_PASSAGE_SEARCH_QUERY_MIN_LENGTH) {
      context.addIssue({
        code: "custom",
        message: "Enter at least 2 characters to search Project Transcripts.",
      });
    }
    if (length > PROJECT_PASSAGE_SEARCH_QUERY_MAX_LENGTH) {
      context.addIssue({
        code: "custom",
        message: "Search terms must be 200 characters or fewer.",
      });
    }
  });

export const projectPassageSearchRequestSchema = z
  .object({ query: ProjectPassageSearchQuerySchema })
  .strict();

export const projectPassageSearchInputSchema = z
  .object({
    query: ProjectPassageSearchQuerySchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(PROJECT_PASSAGE_SEARCH_MAX_LIMIT)
      .default(PROJECT_PASSAGE_SEARCH_DEFAULT_LIMIT),
    balanceSources: z.boolean().optional(),
  })
  .strict();

type ProjectPassageSearchInputFromSchema = z.infer<
  typeof projectPassageSearchInputSchema
>;

/**
 * Callers may omit the optional balancing hint; the parsed request schema
 * supplies its false default before an RPC boundary is reached.
 */
export type ProjectPassageSearchInput = Omit<
  ProjectPassageSearchInputFromSchema,
  "balanceSources"
> & {
  balanceSources?: boolean;
};

export const ProjectUnavailableVideoSchema = z
  .object({
    videoId: z.uuid(),
    youtubeVideoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/).nullable(),
    title: z.string().nullable(),
    channelName: z.string().nullable(),
    status: z.enum(["processing", "failed", "unavailable"]),
    failureCode: z.string().max(64).nullable(),
  })
  .strict();

export type ProjectUnavailableVideo = z.infer<
  typeof ProjectUnavailableVideoSchema
>;

export const ProjectSearchCoverageSchema = z
  .object({
    totalVideos: z.number().int().min(0).max(5),
    readyVideos: z.number().int().min(0).max(5),
    unavailableVideos: z.array(ProjectUnavailableVideoSchema).max(5),
    passagesExamined: z.number().int().min(0),
  })
  .strict()
  .superRefine((coverage, context) => {
    if (
      coverage.readyVideos + coverage.unavailableVideos.length !==
      coverage.totalVideos
    ) {
      context.addIssue({
        code: "custom",
        message: "Project Search coverage totals are incoherent.",
      });
    }
  });

export type ProjectSearchCoverage = z.infer<
  typeof ProjectSearchCoverageSchema
>;

export const ProjectTranscriptPassageSchema = z
  .object({
    passageId: z.string().min(1).max(80),
    videoId: z.uuid(),
    youtubeVideoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
    title: z.string().nullable(),
    channelName: z.string().nullable(),
    text: z.string().min(1),
    segmentOrdinal: z.number().int().positive(),
    excerptStartCharacter: z.number().int().nonnegative(),
    excerptEndCharacter: z.number().int().positive(),
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().nonnegative().nullable(),
    language: z.string().min(1).max(35),
    truncatedStart: z.boolean(),
    truncatedEnd: z.boolean(),
  })
  .strict()
  .superRefine((passage, context) => {
    const textLength = projectPassageSearchCodePointLength(passage.text);
    if (textLength > PROJECT_PASSAGE_SEARCH_MAX_TEXT_LENGTH) {
      context.addIssue({
        code: "custom",
        message: "Project Search passage text exceeds its code-point bound.",
      });
    }
    const expectedPassageId = [
      passage.videoId,
      passage.segmentOrdinal,
      passage.excerptStartCharacter,
      passage.excerptEndCharacter,
    ].join(":");
    if (passage.passageId !== expectedPassageId) {
      context.addIssue({
        code: "custom",
        message: "Project Search passage identity is incoherent.",
      });
    }
    if (
      passage.excerptEndCharacter - passage.excerptStartCharacter !==
      textLength
    ) {
      context.addIssue({
        code: "custom",
        message: "Project Search excerpt identity is incoherent.",
      });
    }
    if (
      passage.endSeconds !== null &&
      passage.endSeconds <= passage.startSeconds
    ) {
      context.addIssue({
        code: "custom",
        message: "Project Search passage timing is incoherent.",
      });
    }
    if (passage.truncatedStart !== (passage.excerptStartCharacter > 0)) {
      context.addIssue({
        code: "custom",
        message: "Project Search excerpt truncation is incoherent.",
      });
    }
  });

export type ProjectTranscriptPassage = z.infer<
  typeof ProjectTranscriptPassageSchema
>;

const SearchPayloadSchema = z
  .object({
    sourceSetRevision: z.number().int().nonnegative(),
    coverage: ProjectSearchCoverageSchema,
    passages: z
      .array(ProjectTranscriptPassageSchema)
      .max(PROJECT_PASSAGE_SEARCH_MAX_LIMIT),
  })
  .strict();

export const ProjectPassageSearchDatabaseResultSchema = z.discriminatedUnion(
  "outcome",
  [
    SearchPayloadSchema.extend({
      outcome: z.literal("ready"),
      passages: z.array(ProjectTranscriptPassageSchema).min(1).max(10),
    }).strict(),
    SearchPayloadSchema.extend({
      outcome: z.literal("no_results"),
      passages: z.tuple([]),
    }).strict(),
    SearchPayloadSchema.extend({
      outcome: z.literal("not_ready"),
      passages: z.tuple([]),
    }).strict(),
    z.object({ outcome: z.literal("invalid") }).strict(),
    z.object({ outcome: z.literal("missing") }).strict(),
  ],
).superRefine((search, context) => {
  if (!("coverage" in search)) return;
  const hasReadyCoverage = search.coverage.readyVideos > 0;
  if (
    (search.outcome === "not_ready" && hasReadyCoverage) ||
    (search.outcome !== "not_ready" && !hasReadyCoverage)
  ) {
    context.addIssue({
      code: "custom",
      message: "Project Search outcome and ready coverage are incoherent.",
    });
  }
  if (
    search.outcome !== "not_ready" &&
    search.coverage.passagesExamined < search.passages.length
  ) {
    context.addIssue({
      code: "custom",
      message: "Project Search examined-passage coverage is incoherent.",
    });
  }
});

type SearchPayload = z.infer<typeof SearchPayloadSchema>;

export const ProjectPassageSearchResponseSchema = z.discriminatedUnion(
  "status",
  [
    SearchPayloadSchema.extend({
      status: z.literal("ready"),
      passages: z.array(ProjectTranscriptPassageSchema).min(1).max(10),
    }).strict(),
    SearchPayloadSchema.extend({
      status: z.literal("no_results"),
      passages: z.tuple([]),
    }).strict(),
    SearchPayloadSchema.extend({
      status: z.literal("not_ready"),
      passages: z.tuple([]),
    }).strict(),
  ],
).superRefine((search, context) => {
  const hasReadyCoverage = search.coverage.readyVideos > 0;
  if (
    (search.status === "not_ready" && hasReadyCoverage) ||
    (search.status !== "not_ready" && !hasReadyCoverage)
  ) {
    context.addIssue({
      code: "custom",
      message: "Project Search outcome and ready coverage are incoherent.",
    });
  }
  if (
    search.status !== "not_ready" &&
    search.coverage.passagesExamined < search.passages.length
  ) {
    context.addIssue({
      code: "custom",
      message: "Project Search examined-passage coverage is incoherent.",
    });
  }
});

export type ProjectPassageSearchResolution =
  | ({ readonly status: "ready" } & SearchPayload)
  | ({ readonly status: "no_results" } & SearchPayload)
  | ({ readonly status: "not_ready" } & SearchPayload)
  | { readonly status: "invalid" }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export interface ProjectPassageSearchCapability {
  search(
    input: ProjectPassageSearchInput,
  ): Promise<ProjectPassageSearchResolution>;
}
