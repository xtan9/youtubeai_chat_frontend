import { z } from "zod";
import {
  ProjectTranscriptPassageSchema,
  ProjectUnavailableVideoSchema,
} from "./project-passage-search-contract";
import { projectGroundedQuestionCodePointLength } from "./project-grounded-input";

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
