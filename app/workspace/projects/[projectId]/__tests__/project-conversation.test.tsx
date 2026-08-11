// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import type {
  ProjectAnswerSourceManifest,
  ProjectConversation as Conversation,
} from "@/lib/projects/project-grounded-answer-contract";
import { ProjectConversation } from "../project-conversation";

const mocks = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: mocks.capture,
}));

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_MESSAGE_ID = "20000000-0000-4000-8000-000000000001";
const VIDEO_ID = "30000000-0000-4000-8000-000000000001";
const UNAVAILABLE_VIDEO_ID = "30000000-0000-4000-8000-000000000002";

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    conversationId: null,
    messages: [],
    messagesUsed: 0,
    messagesLimit: 5,
    tier: "free",
    nextCursor: null,
    ...overrides,
  };
}

describe("ProjectConversation", () => {
  afterEach(() => {
    mocks.capture.mockReset();
    vi.unstubAllGlobals();
  });

  it("shows the durable Free cap immediately after reload", async () => {
    const { container } = renderWithProviders(
      <ProjectConversation
        projectId={PROJECT_ID}
        initialConversation={conversation({ messagesUsed: 5 })}
      />,
    );

    expect(
      screen.getByText("You’ve used 5/5 free messages in this Project."),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "View Pro plans" }).getAttribute("href"),
    ).toBe("/pricing?source_surface=project_chat_limit");
    await waitFor(() =>
      expect(mocks.capture).toHaveBeenCalledWith(
        "subscription_discovery_viewed",
        {
          source_surface: "project_chat_limit",
          presentation_state: "upgrade_to_pro",
          authentication_state: "registered",
          device_class: "desktop",
        },
      ),
    );
    expect(mocks.capture).toHaveBeenCalledWith("project_paywall_viewed", {
      project_id: PROJECT_ID,
      paywall_kind: "conversation",
      tier: "free",
      used: 5,
      limit: 5,
    });
    fireEvent.click(screen.getByRole("link", { name: "View Pro plans" }));
    expect(mocks.capture).toHaveBeenCalledWith(
      "subscription_discovery_clicked",
      {
        source_surface: "project_chat_limit",
        presentation_state: "upgrade_to_pro",
        authentication_state: "registered",
        device_class: "desktop",
      },
    );
    expect(screen.queryByLabelText("Ask the Project")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("offers accessible guided actions that remain editable and use the grounded stream mode", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          [
            `data: ${JSON.stringify({
              type: "source_manifest",
              manifest: {
                projectId: PROJECT_ID,
                sourceSetRevision: 1,
                sources: [],
              },
            })}`,
            `data: ${JSON.stringify({
              type: "source_coverage",
              coverage: {
                totalVideos: 0,
                readyVideos: 0,
                evidenceVideos: 0,
                unavailableVideos: [],
                passagesExamined: 0,
                evidencePassages: 0,
              },
            })}`,
            `data: ${JSON.stringify({
              type: "answer_start",
              classification: "unsupported",
              mode: "compare_viewpoints",
            })}`,
            `data: ${JSON.stringify({
              type: "delta",
              text: "There is not enough evidence to compare these sources.",
            })}`,
            `data: ${JSON.stringify({ type: "citation_diagnostics", diagnostics: [] })}`,
            `data: ${JSON.stringify({
              type: "done",
              assistantMessageId: "60000000-0000-4000-8000-000000000001",
            })}`,
          ].join("\n\n") + "\n\n",
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ conversation: conversation() }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderWithProviders(
      <ProjectConversation
        projectId={PROJECT_ID}
        initialConversation={conversation()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Compare viewpoints" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Find common themes" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Find gaps and unexplored angles" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Project Assessment" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Compare viewpoints" }));
    const input = screen.getByLabelText("Ask the Project");
    expect((input as HTMLTextAreaElement).value).toContain(
      "Compare the viewpoints",
    );
    fireEvent.change(input, {
      target: { value: "Compare only the edited question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask Project" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      question: "Compare only the edited question",
      mode: "compare_viewpoints",
    });
    expect(container.querySelector('[class*="overflow-y"]')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("labels a Project Assessment and states its within-Project trust boundary", async () => {
    const sourceManifest: ProjectAnswerSourceManifest = {
      projectId: PROJECT_ID,
      sourceSetRevision: 1,
      sources: [
        {
          sourceId: "S1",
          videoId: VIDEO_ID,
          youtubeVideoId: "aaaaaaa0001",
          title: "Launch notes",
          channelName: null,
          passages: [{ passageId: "p1", startSeconds: 42, endSeconds: 58 }],
        },
      ],
    };
    const { container } = renderWithProviders(
      <ProjectConversation
        projectId={PROJECT_ID}
        initialConversation={conversation({
          conversationId: "40000000-0000-4000-8000-000000000001",
          messages: [
            {
              id: USER_MESSAGE_ID,
              inReplyToMessageId: null,
              role: "user",
              content: "Which timing is better supported?",
              createdAt: "2026-08-09T12:00:00.000Z",
              mode: "project_assessment",
              answerClassification: null,
              completionState: "completed",
              sourceSetRevision: 1,
              sourceManifest: null,
              sourceCoverage: null,
              citationDiagnostics: null,
            },
            {
              id: "50000000-0000-4000-8000-000000000001",
              inReplyToMessageId: USER_MESSAGE_ID,
              role: "assistant",
              mode: "project_assessment",
              content:
                "Project Assessment\nThe April timing is better supported [S1 @ 00:42].",
              createdAt: "2026-08-09T12:00:01.000Z",
              answerClassification: "supported",
              completionState: null,
              sourceSetRevision: 1,
              sourceManifest,
              sourceCoverage: {
                totalVideos: 1,
                readyVideos: 1,
                usedVideos: 1,
                unavailableVideos: [],
                passagesExamined: 1,
                passagesUsed: 1,
              },
              citationDiagnostics: [],
            },
          ],
        })}
      />,
    );

    expect(screen.getAllByText("Project Assessment").length).toBeGreaterThan(0);
    expect(screen.getByRole("note").textContent).toContain(
      "not externally verified truth",
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders a private evidence ledger before linked and diagnostic citations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        outcome: "recorded",
        rating: "helpful",
        messageOrdinal: 7,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const astralMalformed = `[${"😀".repeat(90)} S9 at 00:10]`;
    const sourceManifest: ProjectAnswerSourceManifest = {
      projectId: PROJECT_ID,
      sourceSetRevision: 3,
      sources: [
        {
          sourceId: "S1",
          videoId: VIDEO_ID,
          youtubeVideoId: "aaaaaaa0001",
          title: "Launch notes",
          channelName: "Evidence Lab",
          passages: [
            {
              passageId: `${VIDEO_ID}:1:0:45`,
              startSeconds: 42,
              endSeconds: 58,
            },
          ],
        },
      ],
    };
    const sourceCoverage = {
      totalVideos: 2,
      readyVideos: 1,
      usedVideos: 1,
      unavailableVideos: [
        {
          videoId: UNAVAILABLE_VIDEO_ID,
          youtubeVideoId: "bbbbbbb0002",
          title: "Pending source",
          channelName: null,
          status: "processing" as const,
          failureCode: null,
        },
      ],
      passagesExamined: 9,
      passagesUsed: 1,
    };
    const { container } = renderWithProviders(
      <ProjectConversation
        projectId={PROJECT_ID}
        initialConversation={conversation({
          conversationId: "40000000-0000-4000-8000-000000000001",
          // Project-wide usage includes other threads and incomplete turns;
          // trust analytics must use the durable turn identity instead.
          messagesUsed: 26,
          messages: [
            {
              id: USER_MESSAGE_ID,
              inReplyToMessageId: null,
              role: "user",
              content: "When was the launch?",
              createdAt: "2026-08-09T12:00:00.000Z",
              answerClassification: null,
              completionState: "completed",
              sourceSetRevision: null,
              sourceManifest: null,
              sourceCoverage: null,
              citationDiagnostics: null,
            },
            {
              id: "50000000-0000-4000-8000-000000000001",
              inReplyToMessageId: USER_MESSAGE_ID,
              role: "assistant",
              messageOrdinal: 7,
              content: `The launch spans [S1 @ 00:42-00:58]. Unknown [S9 @ 00:10]. ${astralMalformed}`,
              createdAt: "2026-08-09T12:00:01.000Z",
              answerClassification: "supported",
              completionState: null,
              sourceSetRevision: 3,
              sourceManifest,
              sourceCoverage,
              citationDiagnostics: [
                {
                  kind: "unknown_source",
                  raw: "[S9 @ 00:10]",
                  sourceId: "S9",
                },
                {
                  kind: "malformed",
                  raw: Array.from(astralMalformed).slice(0, 80).join(""),
                },
              ],
            },
          ],
        })}
      />,
    );

    const region = screen.getByRole("region", {
      name: "Project Conversation",
    });
    expect(region.classList.contains("ph-no-capture")).toBe(true);
    expect(region.hasAttribute("data-ph-no-autocapture")).toBe(true);
    expect(screen.getByText("Passages selected")).toBeTruthy();
    expect(screen.getByText("Pending source")).toBeTruthy();
    expect(screen.getByText("Processing")).toBeTruthy();
    const citation = screen.getByRole("link", {
      name: /\[S1 @ 00:42-00:58\].*open Launch notes/i,
    });
    expect(citation.getAttribute("href")).toBe(
      "https://www.youtube.com/watch?v=aaaaaaa0001&t=42s",
    );
    fireEvent.click(citation);
    expect(mocks.capture).toHaveBeenCalledWith("project_citation_clicked", {
      project_id: PROJECT_ID,
      citation_context: "grounded_answer",
      answer_id: "50000000-0000-4000-8000-000000000001",
      message_ordinal: 7,
      citation_ordinal: 1,
      source_ordinal: 1,
      timestamp_seconds: 42,
    });
    fireEvent.click(screen.getByRole("button", { name: "Useful" }));
    await waitFor(() => expect(screen.getByText("Feedback recorded.")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/conversation/feedback`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          answerId: "50000000-0000-4000-8000-000000000001",
          rating: "helpful",
        }),
      }),
    );
    expect(mocks.capture).not.toHaveBeenCalledWith(
      "project_answer_feedback_submitted",
      expect.anything(),
    );
    expect(
      (screen.getByRole("button", { name: "Useful" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Not useful" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Useful" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: /\[S9 @ 00:10\]/ })).toBeNull();
    expect(container.textContent).toContain(astralMalformed);
    expect(screen.queryByRole("link", { name: /S9 at 00:10/ })).toBeNull();
    expect(screen.getByRole("note").textContent).toContain(
      "2 citations could not be linked",
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("restores an immutable Project-global feedback decision after reload", async () => {
    const sourceManifest: ProjectAnswerSourceManifest = {
      projectId: PROJECT_ID,
      sourceSetRevision: 1,
      sources: [
        {
          sourceId: "S1",
          videoId: VIDEO_ID,
          youtubeVideoId: "aaaaaaa0001",
          title: "Launch notes",
          channelName: null,
          passages: [{ passageId: "p1", startSeconds: 42, endSeconds: 58 }],
        },
      ],
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(
      <ProjectConversation
        projectId={PROJECT_ID}
        initialConversation={conversation({
          conversationId: "40000000-0000-4000-8000-000000000001",
          messages: [
            {
              id: USER_MESSAGE_ID,
              inReplyToMessageId: null,
              role: "user",
              content: "When was the launch?",
              createdAt: "2026-08-09T12:00:00.000Z",
              answerClassification: null,
              completionState: "completed",
              sourceSetRevision: 1,
              sourceManifest: null,
              sourceCoverage: null,
              citationDiagnostics: null,
            },
            {
              id: "50000000-0000-4000-8000-000000000001",
              inReplyToMessageId: USER_MESSAGE_ID,
              role: "assistant",
              content: "The launch is supported [S1 @ 00:42].",
              createdAt: "2026-08-09T12:00:01.000Z",
              answerClassification: "supported",
              completionState: null,
              sourceSetRevision: 1,
              sourceManifest,
              sourceCoverage: {
                totalVideos: 1,
                readyVideos: 1,
                usedVideos: 1,
                unavailableVideos: [],
                passagesExamined: 1,
                passagesUsed: 1,
              },
              citationDiagnostics: [],
              messageOrdinal: 3,
              feedbackRating: "helpful",
            },
          ],
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Useful" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      (screen.getByRole("button", { name: "Useful" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Not useful" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("Feedback recorded.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, "invalid", "request"],
    [404, "missing", "request"],
    [429, "unavailable", "rate_limit"],
    [503, "unavailable", "processing"],
    [200, "unexpected", "protocol"],
  ] as const)(
    "records a bounded feedback failure for HTTP %s without private answer content",
    async (status, outcome, errorClass) => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ outcome }, { status }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(
      <ProjectConversation
        projectId={PROJECT_ID}
        initialConversation={conversation({
          conversationId: "40000000-0000-4000-8000-000000000001",
          messages: [
            {
              id: USER_MESSAGE_ID,
              inReplyToMessageId: null,
              role: "user",
              content: "When was the launch?",
              createdAt: "2026-08-09T12:00:00.000Z",
              answerClassification: null,
              completionState: "completed",
              sourceSetRevision: 1,
              sourceManifest: null,
              sourceCoverage: null,
              citationDiagnostics: null,
            },
            {
              id: "50000000-0000-4000-8000-000000000001",
              inReplyToMessageId: USER_MESSAGE_ID,
              role: "assistant",
              content: "The launch is supported.",
              createdAt: "2026-08-09T12:00:01.000Z",
              answerClassification: "supported",
              completionState: null,
              sourceSetRevision: 1,
              sourceManifest: {
                projectId: PROJECT_ID,
                sourceSetRevision: 1,
                sources: [],
              },
              sourceCoverage: {
                totalVideos: 0,
                readyVideos: 0,
                usedVideos: 0,
                unavailableVideos: [],
                passagesExamined: 0,
                passagesUsed: 0,
              },
              citationDiagnostics: [],
              messageOrdinal: 3,
            },
          ],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Useful" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn’t record feedback. Try again.",
    );
    expect(mocks.capture).toHaveBeenCalledWith("project_action_failed", {
      project_id: PROJECT_ID,
      action_kind: "feedback",
      error_class: errorClass,
      ...(status === 200 ? {} : { http_status: status }),
    });
    expect(JSON.stringify(mocks.capture.mock.calls)).not.toContain(
      "The launch is supported",
    );
    },
  );

  it("renders Source Set boundaries around durable answers", async () => {
    const { container } = renderWithProviders(
      <ProjectConversation
        projectId={PROJECT_ID}
        initialConversation={conversation({
          conversationId: "40000000-0000-4000-8000-000000000001",
          messages: [
            {
              id: USER_MESSAGE_ID,
              inReplyToMessageId: null,
              role: "user",
              content: "What changed?",
              createdAt: "2026-08-09T13:00:00.000Z",
              answerClassification: null,
              completionState: "completed",
              sourceSetRevision: 2,
              sourceManifest: null,
              sourceCoverage: null,
              evidenceSnapshot: null,
              citationDiagnostics: null,
            },
          ],
          sourceSetEvents: [
            {
              eventId: "70000000-0000-4000-8000-000000000001",
              projectId: PROJECT_ID,
              revision: 2,
              kind: "added",
              videoId: VIDEO_ID,
              videoTitle: "New source",
              fromPosition: null,
              toPosition: 1,
              fromStatus: null,
              toStatus: "ready",
              createdAt: "2026-08-09T12:59:00.000Z",
            },
          ],
        })}
      />,
    );

    expect(
      screen.getByRole("status", { name: "Source Set change revision 2" }),
    ).toBeTruthy();
    expect(screen.getByText(/Added New source to the Source Set/)).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders keyboard-labelled thread controls without a nested scrolling region", async () => {
    const firstId = "40000000-0000-4000-8000-000000000001";
    const secondId = "40000000-0000-4000-8000-000000000002";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          conversation: conversation({ conversationId: secondId }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderWithProviders(
      <ProjectConversation
        projectId={PROJECT_ID}
        initialConversation={conversation({ conversationId: firstId })}
        initialConversations={[
          {
            conversationId: firstId,
            name: "Launch questions",
            createdAt: "2026-08-09T00:00:00.000Z",
            updatedAt: "2026-08-09T00:00:00.000Z",
            messageCount: 1,
          },
          {
            conversationId: secondId,
            name: "Comparison",
            createdAt: "2026-08-09T00:01:00.000Z",
            updatedAt: "2026-08-09T00:01:00.000Z",
            messageCount: 0,
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Conversation threads" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Rename Launch questions" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Clear Launch questions" }),
    ).toBeTruthy();
    const comparisonButton = screen.getByRole("button", {
      name: /^Comparison\s+0\s+messages$/,
    });
    expect(comparisonButton).toBeTruthy();
    expect(container.querySelector('[class*="overflow-y"]')).toBeNull();

    fireEvent.click(comparisonButton);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/projects/${PROJECT_ID}/conversation?conversationId=${secondId}`,
        expect.objectContaining({ cache: "no-store" }),
      ),
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("uses shared code-point validation without a UTF-16 maxLength mismatch", () => {
    renderWithProviders(
      <ProjectConversation
        projectId={PROJECT_ID}
        initialConversation={conversation()}
      />,
    );
    const textarea = screen.getByLabelText("Ask the Project");
    expect(textarea.hasAttribute("maxlength")).toBe(false);

    fireEvent.change(textarea, { target: { value: "🧪".repeat(2) } });
    expect(screen.getByText(/2\/200 characters/)).toBeTruthy();
    fireEvent.change(textarea, { target: { value: "🧪".repeat(200) } });
    expect(screen.getByText(/200\/200 characters/)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Ask Project" })
        .hasAttribute("disabled"),
    ).toBe(false);

    fireEvent.change(textarea, { target: { value: "🧪".repeat(201) } });
    expect(screen.getByText(/201\/200 characters/)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Ask Project" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(textarea.getAttribute("aria-invalid")).toBe("true");
  });

  it("loads earlier complete turns from the governed cursor", async () => {
    const earlier = conversation({
      conversationId: "40000000-0000-4000-8000-000000000001",
      messagesUsed: 26,
      messages: [
        {
          id: USER_MESSAGE_ID,
          inReplyToMessageId: null,
          role: "user",
          content: "Earlier question",
          createdAt: "2026-08-08T12:00:00.000Z",
          answerClassification: null,
          completionState: "cancelled",
          sourceSetRevision: null,
          sourceManifest: null,
          sourceCoverage: null,
          citationDiagnostics: null,
        },
      ],
    });
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ conversation: earlier }));
    vi.stubGlobal("fetch", fetch);
    renderWithProviders(
      <ProjectConversation
        projectId={PROJECT_ID}
        initialConversation={conversation({
          conversationId: "40000000-0000-4000-8000-000000000001",
          messagesUsed: 26,
          nextCursor: "opaque-cursor",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Load earlier" }));
    await screen.findByText("Earlier question");
    expect(fetch).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/conversation?cursor=opaque-cursor&conversationId=40000000-0000-4000-8000-000000000001`,
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("loads earlier Source Set activity through its independent cursor", async () => {
    const event = {
      eventId: "70000000-0000-4000-8000-000000000001",
      projectId: PROJECT_ID,
      revision: 1,
      kind: "added" as const,
      videoId: VIDEO_ID,
      videoTitle: "Earlier source",
      fromPosition: null,
      toPosition: 1,
      fromStatus: null,
      toStatus: "ready" as const,
      createdAt: "2026-08-08T12:00:00.000Z",
    };
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        eventPage: { events: [event], nextCursor: null },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    renderWithProviders(
      <ProjectConversation
        projectId={PROJECT_ID}
        initialConversation={conversation({
          nextEventCursor: "opaque-event-cursor",
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Load earlier activity" }),
    );

    expect(
      await screen.findByText(/Added Earlier source to the Source Set/),
    ).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/conversation?eventCursor=opaque-event-cursor`,
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Load earlier activity" }),
    ).toBeNull();
  });

  it("disables Stop and announces only the durable terminal completion", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(USER_MESSAGE_ID);
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(responseBody, {
          headers: {
            "Content-Type": "text/event-stream",
            "X-Project-Question-Message-ID": USER_MESSAGE_ID,
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ conversation: conversation({ messagesUsed: 1 }) }),
      );
    vi.stubGlobal("fetch", fetch);
    renderWithProviders(
      <ProjectConversation
        projectId={PROJECT_ID}
        initialConversation={conversation()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Ask the Project"), {
      target: { value: "When was the launch?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask Project" }));
    act(() => {
      const events = [
        { type: "question_reserved", userMessageId: USER_MESSAGE_ID },
        {
          type: "source_manifest",
          manifest: {
            projectId: PROJECT_ID,
            sourceSetRevision: 0,
            sources: [],
          },
        },
        {
          type: "source_coverage",
          coverage: {
            totalVideos: 0,
            readyVideos: 0,
            usedVideos: 0,
            unavailableVideos: [],
            passagesExamined: 0,
            passagesUsed: 0,
          },
        },
        { type: "answer_start", classification: "unsupported" },
        { type: "delta", text: "No evidence was available." },
        { type: "persistence_started", userMessageId: USER_MESSAGE_ID },
      ];
      streamController.enqueue(
        new TextEncoder().encode(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        ),
      );
    });

    const saving = await screen.findByRole("button", { name: "Saving..." });
    expect(saving.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Saving the Grounded Answer.")).toBeTruthy();
    expect(screen.queryByText(/Grounded Answer complete/)).toBeNull();

    act(() => {
      streamController.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ type: "citation_diagnostics", diagnostics: [] })}\n\n` +
            `data: ${JSON.stringify({ type: "done", assistantMessageId: "50000000-0000-4000-8000-000000000001" })}\n\n`,
        ),
      );
      streamController.close();
    });
    await waitFor(() =>
      expect(
        screen.getByText("Grounded Answer complete. Unsupported by sources."),
      ).toBeTruthy(),
    );
  });
});
