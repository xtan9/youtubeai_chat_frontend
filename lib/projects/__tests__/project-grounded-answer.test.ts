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
const RESERVATION = {
  conversationId: CONVERSATION_ID,
  userMessageId: USER_MESSAGE_ID,
  attemptToken: ATTEMPT_TOKEN,
  messagesUsed: 1,
  messagesLimit: 5 as const,
  tier: "free" as const,
  history: [],
};

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

  it("uses the authenticated client only for owner-scoped load and start", async () => {
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
          nextCursor: null,
        },
      })
      .mockResolvedValueOnce({
        error: null,
        data: { outcome: "ready", events: [], nextCursor: null },
      })
      .mockResolvedValueOnce({
        error: null,
        data: {
          outcome: "started",
          conversationId: CONVERSATION_ID,
          userMessageId: USER_MESSAGE_ID,
          attemptToken: ATTEMPT_TOKEN,
          completionState: "reserved",
          created: true,
          messagesUsed: 1,
          messagesLimit: 5,
          tier: "free",
          history: [],
          goal: null,
        },
      });
    const target = capability(rpc).capability;

    await expect(target.load()).resolves.toMatchObject({ status: "ready" });
    await expect(
      target.start(USER_MESSAGE_ID, "What is supported?"),
    ).resolves.toMatchObject({
      status: "started",
      attemptToken: ATTEMPT_TOKEN,
    });
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "load_project_conversation_page_v2",
      "load_project_source_set_event_page_v2",
      "start_project_grounded_question_v2",
    ]);
    expect(mocks.serviceRole).not.toHaveBeenCalled();
  });

  it("uses service role plus the opaque reservation for cancellation", async () => {
    mocks.serviceRpc.mockResolvedValue({
      error: null,
      data: { outcome: "cancelled" },
    });
    const target = capability().capability;

    await expect(target.cancel(RESERVATION)).resolves.toEqual({
      status: "cancelled",
    });
    expect(mocks.serviceRpc).toHaveBeenCalledWith(
      "cancel_project_grounded_question_v2",
      {
        p_owner_id: OWNER_ID,
        p_project_id: PROJECT_ID,
        p_conversation_id: CONVERSATION_ID,
        p_user_message_id: USER_MESSAGE_ID,
        p_attempt_token: ATTEMPT_TOKEN,
      },
    );
  });

  it("atomically begins and completes token-fenced persistence through service role", async () => {
    mocks.serviceRpc.mockResolvedValue({
      error: null,
      data: {
        outcome: "completed",
        assistantMessageId: ASSISTANT_ID,
        answerClassification: "supported",
        citationDiagnostics: [],
      },
    });
    const target = capability().capability;

    await expect(
      target.beginPersistence({
        reservation: RESERVATION,
        assistantContent: "Supported [S1 @ 00:42].",
        classification: "supported",
        artifacts: artifacts(),
      }),
    ).resolves.toEqual({
      outcome: "completed",
      assistantMessageId: ASSISTANT_ID,
      answerClassification: "supported",
      citationDiagnostics: [],
    });
    expect(mocks.serviceRpc).toHaveBeenCalledTimes(1);
    expect(mocks.serviceRpc).toHaveBeenCalledWith(
      "begin_project_grounded_answer_persistence_v2",
      expect.objectContaining({
        p_owner_id: OWNER_ID,
        p_project_id: PROJECT_ID,
        p_conversation_id: CONVERSATION_ID,
        p_user_message_id: USER_MESSAGE_ID,
        p_attempt_token: ATTEMPT_TOKEN,
        p_assistant_content: "Supported [S1 @ 00:42].",
        p_answer_classification: "supported",
        p_source_coverage: artifacts().sourceCoverage,
      }),
    );
  });

  it("loads an earlier message page without querying discarded Source Set activity", async () => {
    const rpc = vi.fn().mockResolvedValue({
      error: null,
      data: {
        outcome: "ready",
        conversationId: CONVERSATION_ID,
        messages: [],
        messagesUsed: 4,
        messagesLimit: 5,
        tier: "free",
        nextCursor: null,
      },
    });
    const target = capability(rpc).capability;

    await expect(
      target.load(CONVERSATION_ID, {
        createdAt: "2026-08-09T12:00:00.000Z",
        userMessageId: USER_MESSAGE_ID,
      }),
    ).resolves.toMatchObject({
      status: "ready",
      conversation: { messages: [], nextCursor: null },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("load_project_conversation_page_v2", {
      p_project_id: PROJECT_ID,
      p_conversation_id: CONVERSATION_ID,
      p_before_created_at: "2026-08-09T12:00:00.000Z",
      p_before_user_message_id: USER_MESSAGE_ID,
      p_turn_limit: 25,
    });
  });

  it("loads one exact attempt without falling back to the conversation page", async () => {
    const rpc = vi.fn().mockResolvedValue({
      error: null,
      data: {
        outcome: "ready",
        userMessageId: USER_MESSAGE_ID,
        state: "cancelled",
        assistant: null,
      },
    });
    const target = capability(rpc).capability;

    await expect(
      target.loadAttempt(USER_MESSAGE_ID, CONVERSATION_ID),
    ).resolves.toEqual({
      status: "ready",
      userMessageId: USER_MESSAGE_ID,
      state: "cancelled",
      assistant: null,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("load_project_grounded_attempt_v2", {
      p_project_id: PROJECT_ID,
      p_question_id: USER_MESSAGE_ID,
      p_conversation_id: CONVERSATION_ID,
    });
  });

  it("retains Source Set events and immutable assistant evidence on load", async () => {
    const snapshot = artifacts().evidenceSnapshot;
    const event = {
      eventId: "70000000-0000-4000-8000-000000000001",
      projectId: PROJECT_ID,
      revision: 2,
      kind: "added",
      videoId: "80000000-0000-4000-8000-000000000001",
      videoTitle: "New source",
      fromPosition: null,
      toPosition: 1,
      fromStatus: null,
      toStatus: "ready",
      createdAt: "2026-08-09T12:59:00.000Z",
    };
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        error: null,
        data: {
          outcome: "ready",
          conversationId: CONVERSATION_ID,
          messages: [
            {
              id: USER_MESSAGE_ID,
              inReplyToMessageId: null,
              role: "user",
              content: "What changed?",
              answerClassification: null,
              completionState: "completed",
              sourceSetRevision: 2,
              sourceManifest: null,
              sourceCoverage: null,
              evidenceSnapshot: null,
              citationDiagnostics: null,
              createdAt: "2026-08-09T13:00:00.000Z",
            },
            {
              id: ASSISTANT_ID,
              inReplyToMessageId: USER_MESSAGE_ID,
              role: "assistant",
              content: "The answer remains verifiable.",
              answerClassification: "supported",
              completionState: null,
              sourceSetRevision: 2,
              sourceManifest: artifacts().sourceManifest,
              sourceCoverage: artifacts().sourceCoverage,
              evidenceSnapshot: snapshot,
              citationDiagnostics: [],
              createdAt: "2026-08-09T13:00:01.000Z",
            },
          ],
          messagesUsed: 1,
          messagesLimit: 5,
          tier: "free",
          nextCursor: null,
        },
      })
      .mockResolvedValueOnce({
        error: null,
        data: { outcome: "ready", events: [event], nextCursor: null },
      });

    const result = await createProjectGroundedAnswerCapability(
      { rpc } as never,
      { projectId: PROJECT_ID, ownerId: OWNER_ID },
    ).load(CONVERSATION_ID);

    expect(result).toMatchObject({
      status: "ready",
      conversation: {
        sourceSetEvents: [{ revision: 2, kind: "added" }],
        messages: [{ sourceSetRevision: 2 }, { evidenceSnapshot: snapshot }],
      },
    });
  });

  it("uses only service role plus owner/project/user/attempt coherence for completion", async () => {
    mocks.serviceRpc.mockResolvedValue({
      error: null,
      data: {
        outcome: "completed",
        assistantMessageId: ASSISTANT_ID,
        answerClassification: "supported",
        citationDiagnostics: [],
      },
    });
    const target = capability().capability;
    const answerArtifacts = artifacts();
    await expect(
      target.complete({
        reservation: RESERVATION,
        assistantContent: "Supported [S1 @ 00:42].",
        classification: "supported",
        artifacts: answerArtifacts,
      }),
    ).resolves.toEqual({
      outcome: "completed",
      assistantMessageId: ASSISTANT_ID,
      answerClassification: "supported",
      citationDiagnostics: [],
    });

    expect(mocks.serviceRpc).toHaveBeenCalledWith(
      "complete_project_grounded_answer_v2",
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

  it("passes Project Assessment mode through authenticated reservation and service completion RPCs", async () => {
    const authenticatedRpc = vi.fn().mockResolvedValue({
      error: null,
      data: {
        outcome: "started",
        conversationId: CONVERSATION_ID,
        userMessageId: USER_MESSAGE_ID,
        attemptToken: ATTEMPT_TOKEN,
        completionState: "reserved",
        created: true,
        messagesUsed: 1,
        messagesLimit: 5,
        tier: "free",
        mode: "project_assessment",
        history: [],
        goal: null,
      },
    });
    const target = capability(authenticatedRpc).capability;
    await expect(
      target.start(
        USER_MESSAGE_ID,
        "Which position is better supported?",
        undefined,
        "project_assessment",
      ),
    ).resolves.toMatchObject({ status: "started", mode: "project_assessment" });
    expect(authenticatedRpc).toHaveBeenCalledWith(
      "start_project_grounded_question_v2",
      {
        p_project_id: PROJECT_ID,
        p_question_id: USER_MESSAGE_ID,
        p_question: "Which position is better supported?",
        p_conversation_id: null,
        p_mode: "project_assessment",
      },
    );

    mocks.serviceRpc.mockResolvedValue({
      error: null,
      data: {
        outcome: "completed",
        assistantMessageId: ASSISTANT_ID,
        answerClassification: "supported",
        citationDiagnostics: [],
      },
    });
    await expect(
      target.complete({
        reservation: {
          conversationId: CONVERSATION_ID,
          userMessageId: USER_MESSAGE_ID,
          attemptToken: ATTEMPT_TOKEN,
          messagesUsed: 1,
          messagesLimit: 5,
          tier: "free",
          mode: "project_assessment",
          history: [],
        },
        assistantContent:
          "Project Assessment\nApril is better supported [S1 @ 00:42].",
        classification: "supported",
        mode: "project_assessment",
        artifacts: artifacts(),
      }),
    ).resolves.toEqual({
      outcome: "completed",
      assistantMessageId: ASSISTANT_ID,
      answerClassification: "supported",
      citationDiagnostics: [],
    });
    expect(mocks.serviceRpc).toHaveBeenCalledWith(
      "complete_project_grounded_answer_v2",
      expect.objectContaining({
        p_mode: "project_assessment",
        p_owner_id: OWNER_ID,
      }),
    );
  });

  it("fails cancellation closed when the service RPC contract is unavailable", async () => {
    const target = capability().capability;
    mocks.serviceRpc.mockResolvedValueOnce({
      error: { code: "57014" },
      data: null,
    });
    await expect(target.cancel(RESERVATION)).resolves.toEqual({
      status: "unavailable",
    });

    mocks.serviceRpc.mockResolvedValueOnce({
      error: null,
      data: { outcome: "completed" },
    });
    await expect(target.cancel(RESERVATION)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("rejects invalid artifacts before acquiring service role and fails closed without service credentials", async () => {
    const target = capability().capability;
    const invalid = artifacts();
    invalid.sourceCoverage.usedVideos = 0;
    await expect(
      target.complete({
        reservation: RESERVATION,
        assistantContent: "Answer",
        classification: "supported",
        artifacts: invalid,
      }),
    ).resolves.toEqual({ outcome: "invalid" });
    expect(mocks.serviceRole).not.toHaveBeenCalled();

    mocks.serviceRole.mockReturnValue(null);
    await expect(
      target.complete({
        reservation: RESERVATION,
        assistantContent: "Answer",
        classification: "supported",
        artifacts: artifacts(),
      }),
    ).resolves.toEqual({ outcome: "unavailable" });
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });
});
