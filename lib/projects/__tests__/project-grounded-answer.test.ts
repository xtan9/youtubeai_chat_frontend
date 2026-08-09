import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  serviceRole: vi.fn(),
  serviceRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.serviceRole,
}));

import { createProjectGroundedAnswerCapability } from "../project-grounded-answer";
import { buildProjectAnswerArtifacts } from "../project-grounded-evidence";
import { PROJECT_ID, passage } from "./project-grounded-test-fixtures";

const OWNER_ID = "90000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const USER_MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const ATTEMPT_TOKEN = "50000000-0000-4000-8000-000000000001";
const ASSISTANT_ID = "60000000-0000-4000-8000-000000000001";

function artifacts() {
  return buildProjectAnswerArtifacts({
    projectId: PROJECT_ID,
    goal: null,
    search: {
      status: "ready",
      sourceSetRevision: 3,
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

function capability(authenticatedRpc = vi.fn()) {
  return {
    authenticatedRpc,
    capability: createProjectGroundedAnswerCapability(
      { rpc: authenticatedRpc } as never,
      { projectId: PROJECT_ID, ownerId: OWNER_ID },
    ),
  };
}

describe("Project Grounded Answer persistence adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.serviceRole.mockReturnValue({ rpc: mocks.serviceRpc });
  });

  it("uses the authenticated client for owner-scoped load, start, and cancellation", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        error: null,
        data: {
          outcome: "ready",
          conversationId: null,
          messages: [],
          messagesUsed: 0,
          messagesLimit: 5,
          tier: "free",
        },
      })
      .mockResolvedValueOnce({
        error: null,
        data: {
          outcome: "started",
          conversationId: CONVERSATION_ID,
          userMessageId: USER_MESSAGE_ID,
          attemptToken: ATTEMPT_TOKEN,
          messagesUsed: 1,
          messagesLimit: 5,
          tier: "free",
          history: [],
        },
      })
      .mockResolvedValueOnce({
        error: null,
        data: { outcome: "cancelled" },
      });
    const target = capability(rpc).capability;

    await expect(target.load()).resolves.toMatchObject({ status: "ready" });
    await expect(target.start("What is supported?")).resolves.toMatchObject({
      status: "started",
      attemptToken: ATTEMPT_TOKEN,
    });
    await expect(target.cancel(USER_MESSAGE_ID)).resolves.toEqual({
      status: "cancelled",
    });
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "load_default_project_conversation",
      "start_project_grounded_question",
      "cancel_project_grounded_question",
    ]);
    expect(rpc).toHaveBeenLastCalledWith(
      "cancel_project_grounded_question",
      { p_project_id: PROJECT_ID, p_user_message_id: USER_MESSAGE_ID },
    );
    expect(mocks.serviceRole).not.toHaveBeenCalled();
  });

  it("uses only service role plus owner/project/user/attempt coherence for completion", async () => {
    mocks.serviceRpc.mockResolvedValue({
      error: null,
      data: { outcome: "completed", assistantMessageId: ASSISTANT_ID },
    });
    const target = capability().capability;
    const answerArtifacts = artifacts();
    await expect(
      target.complete({
        reservation: {
          conversationId: CONVERSATION_ID,
          userMessageId: USER_MESSAGE_ID,
          attemptToken: ATTEMPT_TOKEN,
          messagesUsed: 1,
          messagesLimit: 5,
          tier: "free",
          history: [],
        },
        assistantContent: "Supported [S1 @ 00:42].",
        classification: "supported",
        artifacts: answerArtifacts,
        citationDiagnostics: [],
      }),
    ).resolves.toEqual({
      outcome: "completed",
      assistantMessageId: ASSISTANT_ID,
    });

    expect(mocks.serviceRpc).toHaveBeenCalledWith(
      "complete_project_grounded_answer",
      expect.objectContaining({
        p_owner_id: OWNER_ID,
        p_project_id: PROJECT_ID,
        p_conversation_id: CONVERSATION_ID,
        p_user_message_id: USER_MESSAGE_ID,
        p_attempt_token: ATTEMPT_TOKEN,
        p_source_set_revision: 3,
        p_evidence_snapshot: answerArtifacts.evidenceSnapshot,
      }),
    );
  });

  it("fails cancellation closed when the authenticated RPC contract is unavailable", async () => {
    const databaseFailure = capability(
      vi.fn().mockResolvedValue({
        error: { code: "57014" },
        data: null,
      }),
    ).capability;
    await expect(databaseFailure.cancel(USER_MESSAGE_ID)).resolves.toEqual({
      status: "unavailable",
    });

    const schemaFailure = capability(
      vi.fn().mockResolvedValue({ error: null, data: { outcome: "completed" } }),
    ).capability;
    await expect(schemaFailure.cancel(USER_MESSAGE_ID)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("rejects invalid artifacts before acquiring service role and fails closed without service credentials", async () => {
    const target = capability().capability;
    const invalid = artifacts();
    invalid.sourceCoverage.evidenceVideos = 0;
    await expect(
      target.complete({
        reservation: {
          conversationId: CONVERSATION_ID,
          userMessageId: USER_MESSAGE_ID,
          attemptToken: ATTEMPT_TOKEN,
          messagesUsed: 1,
          messagesLimit: 5,
          tier: "free",
          history: [],
        },
        assistantContent: "Answer",
        classification: "supported",
        artifacts: invalid,
        citationDiagnostics: [],
      }),
    ).resolves.toEqual({ outcome: "invalid" });
    expect(mocks.serviceRole).not.toHaveBeenCalled();

    mocks.serviceRole.mockReturnValue(null);
    await expect(
      target.complete({
        reservation: {
          conversationId: CONVERSATION_ID,
          userMessageId: USER_MESSAGE_ID,
          attemptToken: ATTEMPT_TOKEN,
          messagesUsed: 1,
          messagesLimit: 5,
          tier: "free",
          history: [],
        },
        assistantContent: "Answer",
        classification: "supported",
        artifacts: artifacts(),
        citationDiagnostics: [],
      }),
    ).resolves.toEqual({ outcome: "unavailable" });
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });
});
