import {
  PROJECT_READINESS_FIXTURE_IDS,
  type ProjectReadinessFixtureResult,
} from "./project-readiness";

export type ProjectReadinessFixtureCommand = Readonly<{
  id: string;
  executable: "node" | "psql";
  args: readonly string[];
  gateIds: readonly ProjectReadinessFixtureResult["id"][];
}>;

type RunFixtureCommand = (
  command: ProjectReadinessFixtureCommand,
) => Promise<Readonly<{ exitCode: number }>>;

const VITEST = ["node_modules/vitest/vitest.mjs", "run"] as const;
const PSQL = ["-v", "ON_ERROR_STOP=1", "-f"] as const;

export const PROJECT_READINESS_FIXTURE_COMMANDS = [
  {
    id: "grounded_answer_domain",
    executable: "node",
    args: [
      ...VITEST,
      "lib/projects/__tests__/project-grounded-citations.test.ts",
      "lib/projects/__tests__/project-grounded-evidence.test.ts",
      "lib/projects/__tests__/project-grounded-synthesis.test.ts",
      "lib/projects/__tests__/project-grounded-answer-stream.test.ts",
      "app/api/projects/[projectId]/conversation/stream/__tests__/route.test.ts",
    ],
    gateIds: [
      "citation_identity",
      "fabricated_citations",
      "source_coverage",
      "transcript_truncation",
      "retrieval",
      "multilingual_project",
      "long_project",
      "disagreement_abstention",
      "evidence_snapshot_privacy",
    ],
  },
  {
    id: "analytics_contract",
    executable: "node",
    args: [
      ...VITEST,
      "lib/analytics/__tests__/project-grounded-answer.test.ts",
      "lib/analytics/__tests__/project-adoption-query.test.ts",
      "lib/admin/__tests__/audit-call-sites.test.ts",
    ],
    gateIds: ["analytics_privacy"],
  },
  {
    id: "grounded_answer_db",
    executable: "psql",
    args: [...PSQL, "supabase/test-fixtures/regression_project_grounded_answers.sql"],
    gateIds: [
      "citation_identity",
      "fabricated_citations",
      "source_coverage",
      "disagreement_abstention",
      "project_rls",
      "evidence_snapshot_privacy",
      "service_role_boundaries",
      "project_message_atomic_cap",
    ],
  },
  {
    id: "passage_search_db",
    executable: "psql",
    args: [...PSQL, "supabase/test-fixtures/regression_project_passage_search.sql"],
    gateIds: ["transcript_truncation", "retrieval", "multilingual_project", "long_project"],
  },
  {
    id: "project_limit_db",
    executable: "psql",
    args: [...PSQL, "supabase/test-fixtures/regression_project_limit_concurrency.sql"],
    gateIds: ["project_creation_atomic_cap", "project_rls"],
  },
  {
    id: "message_db",
    executable: "psql",
    args: [...PSQL, "supabase/test-fixtures/regression_project_grounded_answer_concurrency.sql"],
    gateIds: ["project_message_atomic_cap", "service_role_boundaries"],
  },
  {
    id: "artifact_db",
    executable: "psql",
    args: [...PSQL, "supabase/test-fixtures/regression_project_artifact_concurrency.sql"],
    gateIds: ["artifact_generation_atomic_cap", "project_rls", "service_role_boundaries"],
  },
  {
    id: "video_processing_db",
    executable: "psql",
    args: [...PSQL, "supabase/test-fixtures/regression_project_video_processing.sql"],
    gateIds: ["video_processing_reliability", "project_rls"],
  },
] as const satisfies readonly ProjectReadinessFixtureCommand[];

export async function runProjectReadinessFixtures(
  runCommand: RunFixtureCommand,
): Promise<ProjectReadinessFixtureResult[]> {
  const failureByGate = new Map<ProjectReadinessFixtureResult["id"], string>();
  for (const command of PROJECT_READINESS_FIXTURE_COMMANDS) {
    try {
      const result = await runCommand(command);
      if (result.exitCode !== 0) {
        for (const gateId of command.gateIds) {
          if (!failureByGate.has(gateId)) {
            failureByGate.set(gateId, `${command.id}_failed`);
          }
        }
      }
    } catch {
      for (const gateId of command.gateIds) {
        if (!failureByGate.has(gateId)) {
          failureByGate.set(gateId, `${command.id}_unavailable`);
        }
      }
    }
  }

  return PROJECT_READINESS_FIXTURE_IDS.map((id) => {
    const failureClass = failureByGate.get(id);
    return failureClass
      ? { id, passed: false, failureClass }
      : { id, passed: true };
  });
}
