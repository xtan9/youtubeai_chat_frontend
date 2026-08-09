import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { ProjectAnswerArtifactsSchema } from "./project-grounded-answer-contract";
import {
  ProjectArtifactDatabaseCompletionResultSchema,
  ProjectArtifactDatabaseFailureResultSchema,
  ProjectArtifactDatabaseLoadResultSchema,
  ProjectArtifactDatabaseReservationResultSchema,
  ProjectArtifactGenerationMetadataSchema,
  ProjectArtifactKindSchema,
  ProjectArtifactReservationSchema,
  type ProjectArtifact,
  type ProjectArtifactCapability,
  type ProjectArtifactRecord,
} from "./project-artifact-contract";

type ProjectArtifactTarget = Readonly<{
  projectId: string;
  ownerId: string;
}>;

function logFailure(
  target: ProjectArtifactTarget,
  operation: string,
  errorClass: string,
  code?: string,
) {
  // Generated content and private evidence never belong in operational logs.
  console.error("[project-artifacts] operation unavailable", {
    errorId: "PROJECT_ARTIFACTS_UNAVAILABLE",
    operation,
    projectId: target.projectId,
    ownerId: target.ownerId,
    errorClass,
    code,
  });
}

function withStaleness(
  artifact: ProjectArtifactRecord,
  currentSourceSetRevision: number,
): ProjectArtifact {
  return {
    ...artifact,
    updateAvailable: artifact.sourceSetRevision < currentSourceSetRevision,
  };
}

export function createProjectArtifactCapability(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  target: ProjectArtifactTarget,
): ProjectArtifactCapability {
  return {
    async load(kind) {
      try {
        const result = await supabase.rpc("load_project_artifact", {
          p_project_id: target.projectId,
          p_kind: kind,
        });
        if (result.error) {
          logFailure(target, "load", "DatabaseError", result.error.code);
          return { status: "unavailable" };
        }
        const parsed = ProjectArtifactDatabaseLoadResultSchema.safeParse(
          result.data,
        );
        if (!parsed.success) {
          logFailure(target, "load", "SchemaMismatch");
          return { status: "unavailable" };
        }
        if (parsed.data.outcome === "missing") return { status: "missing" };
        const currentSourceSetRevision = parsed.data.currentSourceSetRevision;
        return {
          status: "ready",
          currentSourceSetRevision,
          current: parsed.data.current
            ? withStaleness(parsed.data.current, currentSourceSetRevision)
            : null,
          history: parsed.data.history.map((artifact) =>
            withStaleness(artifact, currentSourceSetRevision),
          ),
          tier: parsed.data.tier,
          generationsUsed: parsed.data.generationsUsed,
          generationsLimit: parsed.data.generationsLimit,
        };
      } catch (error) {
        logFailure(
          target,
          "load",
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return { status: "unavailable" };
      }
    },

    async reserve(kind, attemptToken) {
      if (
        !ProjectArtifactKindSchema.safeParse(kind).success ||
        !ProjectArtifactReservationSchema.shape.attemptToken.safeParse(attemptToken)
          .success
      ) {
        return { status: "invalid" };
      }
      try {
        const result = await supabase.rpc("reserve_project_artifact_generation", {
          p_project_id: target.projectId,
          p_kind: kind,
          p_attempt_token: attemptToken,
        });
        if (result.error) {
          logFailure(target, "reserve", "DatabaseError", result.error.code);
          return { status: "unavailable" };
        }
        const parsed = ProjectArtifactDatabaseReservationResultSchema.safeParse(
          result.data,
        );
        if (!parsed.success) {
          logFailure(target, "reserve", "SchemaMismatch");
          return { status: "unavailable" };
        }
        if (parsed.data.outcome === "started") {
          return {
            status: "started",
            attemptId: parsed.data.attemptId,
            attemptToken: parsed.data.attemptToken,
            kind: parsed.data.kind,
            tier: parsed.data.tier,
            generationsUsed: parsed.data.generationsUsed,
            generationsLimit: parsed.data.generationsLimit,
          };
        }
        if (parsed.data.outcome === "limit_reached") {
          return {
            status: "limit_reached",
            tier: parsed.data.tier,
            generationsUsed: parsed.data.generationsUsed,
            generationsLimit: parsed.data.generationsLimit,
          };
        }
        if (parsed.data.outcome === "invalid") return { status: "invalid" };
        return { status: "missing" };
      } catch (error) {
        logFailure(
          target,
          "reserve",
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return { status: "unavailable" };
      }
    },

    async complete(input) {
      const reservation = ProjectArtifactReservationSchema.safeParse(
        input.reservation,
      );
      const artifacts = ProjectAnswerArtifactsSchema.safeParse(input.artifacts);
      const metadata = ProjectArtifactGenerationMetadataSchema.safeParse(
        input.generationMetadata,
      );
      if (
        !reservation.success ||
        !artifacts.success ||
        !metadata.success ||
        input.content.length < 1 ||
        input.content.length > 100_000
      ) {
        return { status: "invalid" };
      }
      const serviceRole = getServiceRoleClient();
      if (!serviceRole) return { status: "unavailable" };
      try {
        const result = await serviceRole.rpc("complete_project_artifact_generation", {
          p_owner_id: target.ownerId,
          p_project_id: target.projectId,
          p_attempt_id: reservation.data.attemptId,
          p_attempt_token: reservation.data.attemptToken,
          p_kind: reservation.data.kind,
          p_content: input.content,
          p_source_set_revision: artifacts.data.sourceManifest.sourceSetRevision,
          p_source_manifest: artifacts.data.sourceManifest,
          p_source_coverage: artifacts.data.sourceCoverage,
          p_evidence_snapshot: artifacts.data.evidenceSnapshot,
          p_citation_diagnostics: input.citationDiagnostics,
          p_generation_metadata: metadata.data,
        });
        if (result.error) {
          logFailure(target, "complete", "DatabaseError", result.error.code);
          return { status: "unavailable" };
        }
        const parsed = ProjectArtifactDatabaseCompletionResultSchema.safeParse(
          result.data,
        );
        if (!parsed.success) {
          logFailure(target, "complete", "SchemaMismatch");
          return { status: "unavailable" };
        }
        if (parsed.data.outcome === "completed") {
          return { status: "completed", artifact: parsed.data.artifact };
        }
        return { status: parsed.data.outcome };
      } catch (error) {
        logFailure(
          target,
          "complete",
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return { status: "unavailable" };
      }
    },

    async fail(rawReservation) {
      const reservation = ProjectArtifactReservationSchema.safeParse(
        rawReservation,
      );
      if (!reservation.success) return { status: "invalid" };
      const serviceRole = getServiceRoleClient();
      if (!serviceRole) return { status: "unavailable" };
      try {
        const result = await serviceRole.rpc("fail_project_artifact_generation", {
          p_owner_id: target.ownerId,
          p_project_id: target.projectId,
          p_attempt_id: reservation.data.attemptId,
          p_attempt_token: reservation.data.attemptToken,
        });
        if (result.error) {
          logFailure(target, "fail", "DatabaseError", result.error.code);
          return { status: "unavailable" };
        }
        const parsed = ProjectArtifactDatabaseFailureResultSchema.safeParse(
          result.data,
        );
        if (!parsed.success) {
          logFailure(target, "fail", "SchemaMismatch");
          return { status: "unavailable" };
        }
        return { status: parsed.data.outcome };
      } catch (error) {
        logFailure(
          target,
          "fail",
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return { status: "unavailable" };
      }
    },
  };
}
