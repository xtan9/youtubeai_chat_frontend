import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  serviceRole: vi.fn(),
  serviceRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.serviceRole,
}));

import { createProjectArtifactCapability } from "../project-artifacts";
import { buildProjectAnswerArtifacts } from "../project-grounded-evidence";
import { PROJECT_ID, passage } from "./project-grounded-test-fixtures";

const OWNER_ID = "90000000-0000-4000-8000-000000000001";
const ARTIFACT_ID = "30000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "40000000-0000-4000-8000-000000000001";
const ATTEMPT_TOKEN = "50000000-0000-4000-8000-000000000001";

function answerArtifacts(revision = 3) {
  return buildProjectAnswerArtifacts({
    projectId: PROJECT_ID,
    goal: null,
    search: {
      status: "ready",
      sourceSetRevision: revision,
      coverage: {
        totalVideos: 1,
        readyVideos: 1,
        unavailableVideos: [],
        passagesExamined: 4,
      },
      passages: [passage()],
    },
  });
}

function artifact(revision = 3) {
  const evidence = answerArtifacts(revision);
  return {
    artifactId: ARTIFACT_ID,
    projectId: PROJECT_ID,
    kind: "study_guide",
    content: "# Study Guide\n\nSupported [S1 @ 00:42].",
    sourceSetRevision: revision,
    sourceManifest: evidence.sourceManifest,
    sourceCoverage: evidence.sourceCoverage,
    evidenceSnapshot: evidence.evidenceSnapshot,
    citationDiagnostics: [],
    generationMetadata: {
      model: "gpt-5.3-codex-spark",
      promptVersion: "study-guide-v1",
      generatedAt: "2026-08-09T18:00:00.000Z",
    },
    createdAt: "2026-08-09T18:00:00.000Z",
    supersededAt: null,
  };
}

function capability(rpc = vi.fn()) {
  return {
    rpc,
    target: createProjectArtifactCapability(
      { rpc } as never,
      { projectId: PROJECT_ID, ownerId: OWNER_ID },
    ),
  };
}

describe("Project Artifact persistence adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.serviceRole.mockReturnValue({ rpc: mocks.serviceRpc });
  });

  it("loads current and audit records through the owner client and derives Update available", async () => {
    const current = artifact();
    const prior = {
      ...artifact(2),
      artifactId: "30000000-0000-4000-8000-000000000002",
      supersededAt: "2026-08-09T18:00:00.000Z",
    };
    const { target, rpc } = capability(
      vi.fn().mockResolvedValue({
        error: null,
        data: {
          outcome: "ready",
          currentSourceSetRevision: 4,
          current,
          history: [prior],
          tier: "free",
          generationsUsed: 1,
          generationsLimit: 1,
        },
      }),
    );

    await expect(target.load("study_guide")).resolves.toEqual({
      status: "ready",
      currentSourceSetRevision: 4,
      current: { ...current, updateAvailable: true },
      history: [{ ...prior, updateAvailable: true }],
      tier: "free",
      generationsUsed: 1,
      generationsLimit: 1,
    });
    expect(rpc).toHaveBeenCalledWith("load_project_artifact", {
      p_project_id: PROJECT_ID,
      p_kind: "study_guide",
    });
    expect(mocks.serviceRole).not.toHaveBeenCalled();
  });

  it("returns the exact Artifact-specific quota shape without leaking database discriminants", async () => {
    const { target } = capability(
      vi.fn().mockResolvedValue({
        error: null,
        data: {
          outcome: "limit_reached",
          tier: "free",
          generationsUsed: 1,
          generationsLimit: 1,
        },
      }),
    );

    await expect(
      target.reserve("study_guide", ATTEMPT_TOKEN),
    ).resolves.toEqual({
      status: "limit_reached",
      tier: "free",
      generationsUsed: 1,
      generationsLimit: 1,
    });
  });

  it("maps a database invalid reservation to the public invalid outcome", async () => {
    const { target } = capability(
      vi.fn().mockResolvedValue({
        error: null,
        data: { outcome: "invalid" },
      }),
    );

    await expect(
      target.reserve("study_guide", ATTEMPT_TOKEN),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("crosses service role only for coherent completion and failure", async () => {
    mocks.serviceRpc
      .mockResolvedValueOnce({
        error: null,
        data: { outcome: "completed", artifact: artifact() },
      })
      .mockResolvedValueOnce({ error: null, data: { outcome: "failed" } });
    const { target } = capability();
    const reservation = {
      outcome: "started" as const,
      attemptId: ATTEMPT_ID,
      attemptToken: ATTEMPT_TOKEN,
      kind: "study_guide" as const,
      tier: "free" as const,
      generationsUsed: 0,
      generationsLimit: 1 as const,
    };

    await expect(
      target.complete({
        reservation,
        content: artifact().content,
        artifacts: answerArtifacts(),
        citationDiagnostics: [],
        generationMetadata: artifact().generationMetadata,
      }),
    ).resolves.toMatchObject({ status: "completed" });
    expect(mocks.serviceRpc).toHaveBeenNthCalledWith(
      1,
      "complete_project_artifact_generation",
      expect.objectContaining({
        p_owner_id: OWNER_ID,
        p_project_id: PROJECT_ID,
        p_attempt_id: ATTEMPT_ID,
        p_attempt_token: ATTEMPT_TOKEN,
        p_evidence_snapshot: answerArtifacts().evidenceSnapshot,
      }),
    );

    await expect(target.fail(reservation)).resolves.toEqual({ status: "failed" });
    expect(mocks.serviceRpc).toHaveBeenNthCalledWith(
      2,
      "fail_project_artifact_generation",
      {
        p_owner_id: OWNER_ID,
        p_project_id: PROJECT_ID,
        p_attempt_id: ATTEMPT_ID,
        p_attempt_token: ATTEMPT_TOKEN,
      },
    );
  });
});
