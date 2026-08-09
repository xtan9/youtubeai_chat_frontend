import { z } from "zod";
import {
  ProjectAnswerArtifactsSchema,
  ProjectCitationDiagnosticSchema,
  type ProjectCitationDiagnostic,
} from "./project-grounded-answer-contract";

export const ProjectArtifactKindSchema = z.enum([
  "study_guide",
  "creator_brief",
  "project_brief",
]);

export type ProjectArtifactKind = z.infer<typeof ProjectArtifactKindSchema>;

export const ProjectArtifactGenerationMetadataSchema = z
  .object({
    model: z.string().min(1).max(120),
    promptVersion: z.string().min(1).max(80),
    generatedAt: z.iso.datetime(),
  })
  .strict();

export const ProjectArtifactRecordSchema = z
  .object({
    artifactId: z.uuid(),
    projectId: z.uuid(),
    kind: ProjectArtifactKindSchema,
    content: z.string().min(1).max(100_000),
    sourceSetRevision: z.number().int().nonnegative(),
    sourceManifest: ProjectAnswerArtifactsSchema.shape.sourceManifest,
    sourceCoverage: ProjectAnswerArtifactsSchema.shape.sourceCoverage,
    evidenceSnapshot: ProjectAnswerArtifactsSchema.shape.evidenceSnapshot,
    citationDiagnostics: z.array(ProjectCitationDiagnosticSchema).max(20),
    generationMetadata: ProjectArtifactGenerationMetadataSchema,
    createdAt: z.iso.datetime(),
    supersededAt: z.iso.datetime().nullable(),
  })
  .strict()
  .superRefine((artifact, context) => {
    const parsedArtifacts = ProjectAnswerArtifactsSchema.safeParse({
      sourceManifest: artifact.sourceManifest,
      sourceCoverage: artifact.sourceCoverage,
      evidenceSnapshot: artifact.evidenceSnapshot,
    });
    if (!parsedArtifacts.success) {
      context.addIssue({
        code: "custom",
        message: "Artifact evidence must form one coherent Evidence Snapshot.",
      });
    }
    if (
      artifact.projectId !== artifact.sourceManifest.projectId ||
      artifact.sourceSetRevision !== artifact.sourceManifest.sourceSetRevision
    ) {
      context.addIssue({
        code: "custom",
        message: "Artifact provenance must share one Project revision.",
      });
    }
  });

export type ProjectArtifactRecord = z.infer<
  typeof ProjectArtifactRecordSchema
>;

export type ProjectArtifact = ProjectArtifactRecord & {
  readonly updateAvailable: boolean;
};

export const ProjectArtifactSchema = z
  .object({
    ...ProjectArtifactRecordSchema.shape,
    updateAvailable: z.boolean(),
  })
  .strict()
  .superRefine((artifact, context) => {
    const record: Record<string, unknown> = { ...artifact };
    delete record.updateAvailable;
    const parsed = ProjectArtifactRecordSchema.safeParse(record);
    if (!parsed.success) {
      context.addIssue({
        code: "custom",
        message: "Artifact provenance is not coherent.",
      });
    }
  });

export const ProjectArtifactReadyLoadSchema = z
  .object({
    status: z.literal("ready"),
    currentSourceSetRevision: z.number().int().nonnegative(),
    current: ProjectArtifactSchema.nullable(),
    history: z.array(ProjectArtifactSchema).max(100),
    tier: z.enum(["free", "pro"]),
    generationsUsed: z.number().int().nonnegative(),
    generationsLimit: z.literal(1).nullable(),
  })
  .strict();

export const ProjectArtifactApiLoadResponseSchema = z
  .object({ studyGuide: ProjectArtifactReadyLoadSchema })
  .strict();

export const ProjectArtifactDatabaseLoadResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("ready"),
        currentSourceSetRevision: z.number().int().nonnegative(),
        current: ProjectArtifactRecordSchema.nullable(),
        history: z.array(ProjectArtifactRecordSchema).max(100),
        tier: z.enum(["free", "pro"]),
        generationsUsed: z.number().int().nonnegative(),
        generationsLimit: z.literal(1).nullable(),
      })
      .strict(),
    z.object({ outcome: z.literal("missing") }).strict(),
  ],
);

export const ProjectArtifactReservationSchema = z
  .object({
    outcome: z.literal("started"),
    attemptId: z.uuid(),
    attemptToken: z.uuid(),
    kind: ProjectArtifactKindSchema,
    tier: z.enum(["free", "pro"]),
    generationsUsed: z.number().int().nonnegative(),
    generationsLimit: z.literal(1).nullable(),
  })
  .strict();

export type ProjectArtifactReservation = z.infer<
  typeof ProjectArtifactReservationSchema
>;

export const ProjectArtifactDatabaseReservationResultSchema =
  z.discriminatedUnion("outcome", [
    ProjectArtifactReservationSchema,
    z
      .object({
        outcome: z.literal("limit_reached"),
        tier: z.literal("free"),
        generationsUsed: z.number().int().min(1),
        generationsLimit: z.literal(1),
      })
      .strict(),
    z.object({ outcome: z.literal("missing") }).strict(),
    z.object({ outcome: z.literal("invalid") }).strict(),
  ]);

export const ProjectArtifactDatabaseCompletionResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("completed"),
        artifact: ProjectArtifactRecordSchema,
      })
      .strict(),
    z.object({ outcome: z.literal("conflict") }).strict(),
    z.object({ outcome: z.literal("missing") }).strict(),
    z.object({ outcome: z.literal("invalid") }).strict(),
  ]);

export const ProjectArtifactDatabaseFailureResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z.object({ outcome: z.literal("failed") }).strict(),
    z.object({ outcome: z.literal("missing") }).strict(),
  ],
);

export type ProjectArtifactLoadResolution =
  | {
      readonly status: "ready";
      readonly currentSourceSetRevision: number;
      readonly current: ProjectArtifact | null;
      readonly history: readonly ProjectArtifact[];
      readonly tier: "free" | "pro";
      readonly generationsUsed: number;
      readonly generationsLimit: 1 | null;
    }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export type ProjectArtifactReservationResolution =
  | ({ readonly status: "started" } & Omit<ProjectArtifactReservation, "outcome">)
  | {
      readonly status: "limit_reached";
      readonly tier: "free";
      readonly generationsUsed: number;
      readonly generationsLimit: 1;
    }
  | { readonly status: "invalid" }
  | { readonly status: "missing" }
  | { readonly status: "unavailable" };

export type ProjectArtifactCompletionResolution =
  | { readonly status: "completed"; readonly artifact: ProjectArtifactRecord }
  | { readonly status: "conflict" }
  | { readonly status: "missing" }
  | { readonly status: "invalid" }
  | { readonly status: "unavailable" };

export type ProjectArtifactFailureResolution =
  | { readonly status: "failed" }
  | { readonly status: "missing" }
  | { readonly status: "invalid" }
  | { readonly status: "unavailable" };

export interface ProjectArtifactCapability {
  load(kind: ProjectArtifactKind): Promise<ProjectArtifactLoadResolution>;
  reserve(
    kind: ProjectArtifactKind,
    attemptToken: string,
  ): Promise<ProjectArtifactReservationResolution>;
  complete(input: {
    readonly reservation: ProjectArtifactReservation;
    readonly content: string;
    readonly artifacts: z.infer<typeof ProjectAnswerArtifactsSchema>;
    readonly citationDiagnostics: readonly ProjectCitationDiagnostic[];
    readonly generationMetadata: z.infer<
      typeof ProjectArtifactGenerationMetadataSchema
    >;
  }): Promise<ProjectArtifactCompletionResolution>;
  fail(
    reservation: ProjectArtifactReservation,
  ): Promise<ProjectArtifactFailureResolution>;
}
