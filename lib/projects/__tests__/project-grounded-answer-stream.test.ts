import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const beginPersistence = vi.fn();
  return {
    streamChatCompletion: vi.fn(),
    beginPersistence,
  };
});

vi.mock("@/lib/services/llm-chat-client", () => ({
  streamChatCompletion: mocks.streamChatCompletion,
}));

import type {
  ProjectAnswerClassification,
  ProjectGroundedSseEvent,
  ProjectQuestionReservation,
} from "../project-grounded-answer-contract";
import { ProjectConversationAssistantMessageSchema } from "../project-grounded-answer-contract";
import { executeProjectGroundedAnswerStream } from "../project-grounded-answer-stream";
import { buildProjectAnswerArtifacts } from "../project-grounded-evidence";
import {
  PROJECT_ID,
  conflictingViewpointPassages,
  passage,
} from "./project-grounded-test-fixtures";

const ASSISTANT_ID = "60000000-0000-4000-8000-000000000001";

const reservation: ProjectQuestionReservation = {
  conversationId: "30000000-0000-4000-8000-000000000001",
  userMessageId: "40000000-0000-4000-8000-000000000001",
  attemptToken: "50000000-0000-4000-8000-000000000001",
  messagesUsed: 1,
  messagesLimit: 5,
  tier: "free",
  history: [],
};

const groundedAnswers = {
  beginPersistence: mocks.beginPersistence,
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
        passagesExamined: 1,
      },
      passages: [passage()],
    },
  });
}

function multiSourceArtifacts() {
  return buildProjectAnswerArtifacts({
    projectId: PROJECT_ID,
    goal: null,
    search: {
      status: "ready",
      sourceSetRevision: 3,
      coverage: {
        totalVideos: 2,
        readyVideos: 2,
        unavailableVideos: [],
        passagesExamined: 2,
      },
      passages: conflictingViewpointPassages(),
    },
  });
}

function model(...chunks: string[]) {
  mocks.streamChatCompletion.mockImplementation(async function* () {
    for (const text of chunks) yield { type: "delta", text };
    yield { type: "done" };
  });
}

function completed(classification: ProjectAnswerClassification) {
  return {
    outcome: "completed" as const,
    assistantMessageId: ASSISTANT_ID,
    answerClassification: classification,
    citationDiagnostics: [],
  };
}

describe("Project Grounded Answer stream transaction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.beginPersistence.mockResolvedValue(completed("supported"));
  });

  it("hides the control line and emits done only after durable completion", async () => {
    model("SUP", "PORTED\nGrounded [S1 @ 00:42].");
    const emitted: ProjectGroundedSseEvent[] = [];
    let release!: (value: ReturnType<typeof completed>) => void;
    mocks.beginPersistence.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const pending = executeProjectGroundedAnswerStream({
      mode: {
        kind: "provider",
        messages: [{ role: "user", content: "fixture" }],
      },
      artifacts: artifacts(),
      reservation,
      groundedAnswers: {
        beginPersistence: mocks.beginPersistence,
      },
      signal: new AbortController().signal,
      emit: (event) => emitted.push(event),
    });

    await vi.waitFor(() => expect(mocks.beginPersistence).toHaveBeenCalledOnce());
    expect(emitted.some((event) => event.type === "done")).toBe(false);
    expect(
      emitted.some((event) => event.type === "persistence_started"),
    ).toBe(false);
    expect(emitted.some((event) => event.type === "delta")).toBe(false);

    release(completed("supported"));
    await expect(pending).resolves.toEqual({ outcome: "completed" });
    expect(emitted.map((event) => event.type)).toEqual([
      "answer_start",
      "delta",
      "persistence_started",
      "citation_diagnostics",
      "done",
    ]);
    expect(mocks.beginPersistence).toHaveBeenCalledOnce();
  });

  it.each(["compare_viewpoints", "common_themes"] as const)(
    "abstains from %s when supported prose cites only one evidence Video",
    async (conversationMode) => {
      model("SUPPORTED\nRepeated evidence\nApril is supported [S1 @ 00:12].");
      mocks.beginPersistence.mockResolvedValue(completed("abstained"));

      await executeProjectGroundedAnswerStream({
        mode: {
          kind: "provider",
          messages: [{ role: "user", content: "fixture" }],
          abstentionContent: "Insufficient cross-source evidence.",
        },
        conversationMode,
        artifacts: multiSourceArtifacts(),
        reservation,
        groundedAnswers: {
          beginPersistence: mocks.beginPersistence,
        },
        signal: new AbortController().signal,
        emit: () => undefined,
      });

      expect(mocks.beginPersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          assistantContent: "Insufficient cross-source evidence.",
          classification: "abstained",
          mode: conversationMode,
        }),
      );
    },
  );

  it("requires a Project Assessment to cite every selected source", async () => {
    model(
      "SUPPORTED\nProject Assessment\nCompeting positions\nApril is supported [S1 @ 00:12].\nCriteria\nDirectness favors April [S1 @ 00:12].\nConfidence: medium",
    );
    mocks.beginPersistence.mockResolvedValue(completed("abstained"));

    await executeProjectGroundedAnswerStream({
      mode: {
        kind: "provider",
        messages: [{ role: "user", content: "fixture" }],
        abstentionContent: "Assessment evidence is incomplete.",
      },
      conversationMode: "project_assessment",
      artifacts: multiSourceArtifacts(),
      reservation,
      groundedAnswers,
      signal: new AbortController().signal,
      emit: () => undefined,
    });

    expect(mocks.beginPersistence).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantContent: "Assessment evidence is incomplete.",
        classification: "abstained",
      }),
    );
  });

  it("persists a structured Assessment that cites every selected source", async () => {
    const content =
      "Project Assessment\nCompeting positions\nApril is supported [S1 @ 00:12].\nJune is supported [S2 @ 00:18].\nCriteria\nThe passages conflict [S1 @ 00:12] [S2 @ 00:18].\nConfidence: medium";
    model(`SUPPORTED\n${content}`);

    await executeProjectGroundedAnswerStream({
      mode: {
        kind: "provider",
        messages: [{ role: "user", content: "fixture" }],
      },
      conversationMode: "project_assessment",
      artifacts: multiSourceArtifacts(),
      reservation,
      groundedAnswers: {
        beginPersistence: mocks.beginPersistence,
      },
      signal: new AbortController().signal,
      emit: () => undefined,
    });

    expect(mocks.beginPersistence).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantContent: content,
        classification: "supported",
      }),
    );
  });

  it.each([
    ["SUPPORTED\nA claim without an evidence citation."],
    ["SUPPORTED\nA claim with only [S9 @ 00:10]."],
  ])("durably downgrades unsupported model output: %s", async (output) => {
    model(output);
    mocks.beginPersistence.mockResolvedValue(completed("unsupported"));
    const emitted: ProjectGroundedSseEvent[] = [];

    await expect(
      executeProjectGroundedAnswerStream({
        mode: {
          kind: "provider",
          messages: [{ role: "user", content: "fixture" }],
        },
        artifacts: artifacts(),
        reservation,
        groundedAnswers: {
          beginPersistence: mocks.beginPersistence,
        },
        signal: new AbortController().signal,
        emit: (event) => emitted.push(event),
      }),
    ).resolves.toEqual({ outcome: "completed" });

    expect(mocks.beginPersistence).toHaveBeenCalledWith(
      expect.objectContaining({ classification: "unsupported" }),
    );
    expect(emitted).toContainEqual({
      type: "answer_start",
      classification: "unsupported",
    });
  });

  it("uses the SQL-returned diagnostics as the authoritative live event", async () => {
    model("SUPPORTED\nGrounded [S1 @ 00:42].");
    const diagnostic = {
      kind: "malformed" as const,
      raw: "[prefix [S1 @ 00:42]]",
    };
    mocks.beginPersistence.mockResolvedValue({
      ...completed("supported"),
      citationDiagnostics: [diagnostic],
    });
    const emitted: ProjectGroundedSseEvent[] = [];

    await executeProjectGroundedAnswerStream({
      mode: {
        kind: "provider",
        messages: [{ role: "user", content: "fixture" }],
      },
      artifacts: artifacts(),
      reservation,
      groundedAnswers: {
        beginPersistence: mocks.beginPersistence,
      },
      signal: new AbortController().signal,
      emit: (event) => emitted.push(event),
    });

    expect(emitted).toContainEqual({
      type: "citation_diagnostics",
      diagnostics: [diagnostic],
    });
  });

  it("does not persist when aborted during buffered generation", async () => {
    const controller = new AbortController();
    const emitted: ProjectGroundedSseEvent[] = [];
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta", text: "SUPPORTED\nGrounded [S1 @ 00:42]." };
      controller.abort();
      yield { type: "done" };
    });

    await expect(
      executeProjectGroundedAnswerStream({
        mode: {
          kind: "provider",
          messages: [{ role: "user", content: "fixture" }],
        },
        artifacts: artifacts(),
        reservation,
        groundedAnswers: {
          beginPersistence: mocks.beginPersistence,
        },
        signal: controller.signal,
        emit: (event) => emitted.push(event),
      }),
    ).resolves.toEqual({ outcome: "aborted" });

    expect(mocks.beginPersistence).not.toHaveBeenCalled();
    expect(emitted.some((event) => event.type === "persistence_started")).toBe(
      false,
    );
  });

  it("does not announce the commit phase when the atomic terminal fence is stale", async () => {
    model("SUPPORTED\nGrounded [S1 @ 00:42].");
    mocks.beginPersistence.mockResolvedValue({ outcome: "stale" });
    const emitted: ProjectGroundedSseEvent[] = [];

    await expect(
      executeProjectGroundedAnswerStream({
        mode: {
          kind: "provider",
          messages: [{ role: "user", content: "fixture" }],
        },
        artifacts: artifacts(),
        reservation,
        groundedAnswers: {
          beginPersistence: mocks.beginPersistence,
        },
        signal: new AbortController().signal,
        emit: (event) => emitted.push(event),
      }),
    ).resolves.toEqual({
      outcome: "failed",
      stage: "persistence",
      errorClass: "stale",
    });

    expect(mocks.beginPersistence).toHaveBeenCalledOnce();
    expect(emitted.some((event) => event.type === "persistence_started")).toBe(
      false,
    );
  });

  it("does not replay terminal persistence after the atomic begin commits", async () => {
    model("ABSTAINED\nThe evidence is insufficient.");
    const hypotheticalReplay = vi
      .fn()
      .mockRejectedValue(new Error("post-commit replay unavailable"));
    const atomicPersistenceWithLegacyReplay = {
      beginPersistence: mocks.beginPersistence,
      complete: hypotheticalReplay,
    };
    const emitted: ProjectGroundedSseEvent[] = [];

    await expect(
      executeProjectGroundedAnswerStream({
        mode: {
          kind: "provider",
          messages: [{ role: "user", content: "fixture" }],
        },
        artifacts: artifacts(),
        reservation,
        groundedAnswers: atomicPersistenceWithLegacyReplay,
        signal: new AbortController().signal,
        emit: (event) => emitted.push(event),
      }),
    ).resolves.toEqual({ outcome: "completed" });
    expect(mocks.beginPersistence).toHaveBeenCalledOnce();
    expect(hypotheticalReplay).not.toHaveBeenCalled();
    expect(emitted.at(-1)).toEqual({
      type: "done",
      assistantMessageId: ASSISTANT_ID,
    });
  });

  it("uses Unicode code points for the 20,000-character stream and reload bound", async () => {
    const astral = "\u{1f600}";
    const content = astral.repeat(20_000);
    mocks.beginPersistence.mockResolvedValue(completed("unsupported"));
    const emitted: ProjectGroundedSseEvent[] = [];

    await expect(
      executeProjectGroundedAnswerStream({
        mode: { kind: "unsupported", content },
        artifacts: artifacts(),
        reservation,
        groundedAnswers: {
          beginPersistence: mocks.beginPersistence,
        },
        signal: new AbortController().signal,
        emit: (event) => emitted.push(event),
      }),
    ).resolves.toEqual({ outcome: "completed" });
    expect(mocks.beginPersistence).toHaveBeenCalledWith(
      expect.objectContaining({ assistantContent: content }),
    );
    expect(
      ProjectConversationAssistantMessageSchema.safeParse({
        id: ASSISTANT_ID,
        inReplyToMessageId: reservation.userMessageId,
        role: "assistant",
        content,
        createdAt: "2026-08-09T12:00:00.000Z",
        answerClassification: "unsupported",
        completionState: null,
        sourceSetRevision: 3,
        sourceManifest: artifacts().sourceManifest,
        sourceCoverage: artifacts().sourceCoverage,
        citationDiagnostics: [],
      }).success,
    ).toBe(true);

    mocks.beginPersistence.mockClear();
    await expect(
      executeProjectGroundedAnswerStream({
        mode: { kind: "unsupported", content: `${content}${astral}` },
        artifacts: artifacts(),
        reservation,
        groundedAnswers: {
          beginPersistence: mocks.beginPersistence,
        },
        signal: new AbortController().signal,
        emit: () => undefined,
      }),
    ).resolves.toMatchObject({ outcome: "failed", stage: "generation" });
    expect(mocks.beginPersistence).not.toHaveBeenCalled();
    expect(
      ProjectConversationAssistantMessageSchema.safeParse({
        id: ASSISTANT_ID,
        inReplyToMessageId: reservation.userMessageId,
        role: "assistant",
        content: `${content}${astral}`,
        createdAt: "2026-08-09T12:00:00.000Z",
        answerClassification: "unsupported",
        completionState: null,
        sourceSetRevision: 3,
        sourceManifest: artifacts().sourceManifest,
        sourceCoverage: artifacts().sourceCoverage,
        citationDiagnostics: [],
      }).success,
    ).toBe(false);
  });

  it("preserves split surrogate pairs while enforcing the stream code-point bound", async () => {
    const astral = "\u{1f600}";
    const high = astral.slice(0, 1);
    const accepted = astral.repeat(20_000);
    model(`SUPPORTED\n${high}`, accepted.slice(1));
    mocks.beginPersistence.mockResolvedValue(completed("unsupported"));

    await expect(
      executeProjectGroundedAnswerStream({
        mode: {
          kind: "provider",
          messages: [{ role: "user", content: "fixture" }],
        },
        artifacts: artifacts(),
        reservation,
        groundedAnswers: {
          beginPersistence: mocks.beginPersistence,
        },
        signal: new AbortController().signal,
        emit: () => undefined,
      }),
    ).resolves.toEqual({ outcome: "completed" });
    expect(mocks.beginPersistence).toHaveBeenCalledWith(
      expect.objectContaining({ assistantContent: accepted }),
    );

    mocks.beginPersistence.mockClear();
    const rejected = `${accepted}${astral}`;
    model(`SUPPORTED\n${high}`, rejected.slice(1));
    await expect(
      executeProjectGroundedAnswerStream({
        mode: {
          kind: "provider",
          messages: [{ role: "user", content: "fixture" }],
        },
        artifacts: artifacts(),
        reservation,
        groundedAnswers: {
          beginPersistence: mocks.beginPersistence,
        },
        signal: new AbortController().signal,
        emit: () => undefined,
      }),
    ).resolves.toMatchObject({ outcome: "failed", stage: "generation" });
    expect(mocks.beginPersistence).not.toHaveBeenCalled();
  });
});
