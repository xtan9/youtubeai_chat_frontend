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

const SELECTED_ID = "40000000-0000-4000-8000-000000000002";
const DEFAULT_ID = "40000000-0000-4000-8000-000000000001";

function conversation(conversationId: string) {
  return {
    status: "ready" as const,
    conversation: {
      conversationId,
      messages: [],
      sourceSetEvents: [],
      nextCursor: null,
      nextEventCursor: null,
      messagesUsed: 0,
      messagesLimit: 5 as const,
      tier: "free" as const,
    },
  };
}

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

  it("loads both Artifact kinds on the server and supplies them with the Project view", async () => {
    const output = (await ProjectPage({
      params: Promise.resolve({ projectId: PROJECT_ID }),
      searchParams: Promise.resolve({}),
    })) as ReactElement<{
      initialStudyGuide: ProjectArtifactLoadResolution;
      initialCreatorBrief: ProjectArtifactLoadResolution;
    }>;

    expect(mocks.loadArtifact).toHaveBeenNthCalledWith(1, "study_guide");
    expect(mocks.loadArtifact).toHaveBeenNthCalledWith(2, "creator_brief");
    expect(output.props.initialStudyGuide).toEqual(studyGuide);
    expect(output.props.initialCreatorBrief).toEqual(studyGuide);
  });

  it("loads the owned conversation named by the URL query", async () => {
    mocks.loadConversation.mockResolvedValue(conversation(SELECTED_ID));

    const output = (await ProjectPage({
      params: Promise.resolve({ projectId: PROJECT_ID }),
      searchParams: Promise.resolve({ conversationId: SELECTED_ID }),
    })) as ReactElement<{
      initialConversation: { conversationId: string | null };
    }>;

    expect(mocks.loadConversation).toHaveBeenCalledWith(SELECTED_ID);
    expect(output.props.initialConversation.conversationId).toBe(SELECTED_ID);
  });

  it("falls back without disclosing a missing or foreign conversation", async () => {
    mocks.loadConversation
      .mockResolvedValueOnce({ status: "missing" })
      .mockResolvedValueOnce(conversation(DEFAULT_ID));

    const output = (await ProjectPage({
      params: Promise.resolve({ projectId: PROJECT_ID }),
      searchParams: Promise.resolve({ conversationId: SELECTED_ID }),
    })) as ReactElement<{
      initialConversation: { conversationId: string | null };
    }>;

    expect(mocks.loadConversation.mock.calls).toEqual([[SELECTED_ID], []]);
    expect(output.props.initialConversation.conversationId).toBe(DEFAULT_ID);
  });
});
