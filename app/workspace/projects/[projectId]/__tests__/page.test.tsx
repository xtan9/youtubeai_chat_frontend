import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { ProjectArtifactLoadResolution } from "@/lib/projects/project-artifact-contract";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  createClient: vi.fn(),
  resolveSubject: vi.fn(),
  openProject: vi.fn(),
  loadSourceSet: vi.fn(),
  loadCandidates: vi.fn(),
  reconcile: vi.fn(),
  loadConversation: vi.fn(),
  listConversations: vi.fn(),
  loadArtifact: vi.fn(),
  projectView: vi.fn(() => null),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.principal,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/projects/project-subject", () => ({
  resolveProjectSubject: mocks.resolveSubject,
  openResolvedProject: mocks.openProject,
}));
vi.mock("@/lib/projects/project-source-set", () => ({
  loadProjectSourceSet: mocks.loadSourceSet,
  loadProjectHistoryCandidates: mocks.loadCandidates,
}));
vi.mock("@/lib/projects/project-video-processing", () => ({
  reconcileStaleProjectVideoProcessing: mocks.reconcile,
}));
vi.mock("../project-view", () => ({
  ProjectView: mocks.projectView,
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

import ProjectPage from "../page";

const studyGuide: Extract<
  ProjectArtifactLoadResolution,
  { status: "ready" }
> = {
  status: "ready",
  currentSourceSetRevision: 2,
  current: null,
  history: [],
  tier: "free",
  generationsUsed: 0,
  generationsLimit: 1,
};

describe("Project page Artifact composition", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.principal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "90000000-0000-4000-8000-000000000001",
        isAnonymous: false,
        smokeProEntitled: false,
      },
    });
    mocks.createClient.mockResolvedValue({});
    mocks.loadConversation.mockResolvedValue({
      status: "ready",
      conversation: {
        conversationId: null,
        messages: [],
        messagesUsed: 0,
        messagesLimit: 5,
        tier: "free",
      },
    });
    mocks.listConversations.mockResolvedValue({
      status: "ready",
      conversations: [],
    });
    mocks.loadArtifact.mockResolvedValue(studyGuide);
    mocks.resolveSubject.mockResolvedValue({
      kind: "resolved",
      value: {
        projectId: PROJECT_ID,
        groundedAnswers: { load: mocks.loadConversation },
        conversations: { list: mocks.listConversations },
        artifacts: { load: mocks.loadArtifact },
      },
    });
    mocks.openProject.mockResolvedValue({
      kind: "resolved",
      value: {
        id: PROJECT_ID,
        name: "Launch research",
        goal: null,
        createdAt: "2026-08-09T12:00:00.000Z",
        updatedAt: "2026-08-09T12:00:00.000Z",
        lastActiveAt: "2026-08-09T12:00:00.000Z",
      },
    });
    mocks.loadSourceSet.mockResolvedValue({
      kind: "resolved",
      value: { revision: 2, videos: [] },
    });
    mocks.loadCandidates.mockResolvedValue({
      kind: "resolved",
      value: { candidates: [], nextCursor: null },
    });
    mocks.reconcile.mockResolvedValue(undefined);
  });

  it("loads the Study Guide on the server and supplies it with the Project view", async () => {
    const output = (await ProjectPage({
      params: Promise.resolve({ projectId: PROJECT_ID }),
    })) as ReactElement<{
      initialStudyGuide: ProjectArtifactLoadResolution;
    }>;

    expect(mocks.loadArtifact).toHaveBeenCalledWith("study_guide");
    expect(output.props.initialStudyGuide).toEqual(studyGuide);
  });
});
