// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import type {
  ProjectAnswerSourceManifest,
  ProjectConversation as Conversation,
} from "@/lib/projects/project-grounded-answer-contract";
import { ProjectConversation } from "../project-conversation";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_MESSAGE_ID = "20000000-0000-4000-8000-000000000001";
const VIDEO_ID = "30000000-0000-4000-8000-000000000001";
const UNAVAILABLE_VIDEO_ID = "30000000-0000-4000-8000-000000000002";

function conversation(
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    conversationId: null,
    messages: [],
    messagesUsed: 0,
    messagesLimit: 5,
    tier: "free",
    ...overrides,
  };
}

describe("ProjectConversation", () => {
  afterEach(() => {
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
              manifest: { projectId: PROJECT_ID, sourceSetRevision: 1, sources: [] },
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

    expect(screen.getByRole("button", { name: "Compare viewpoints" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Find common themes" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Find gaps and unexplored angles" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Project Assessment" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Compare viewpoints" }));
    const input = screen.getByLabelText("Ask the Project");
    expect((input as HTMLTextAreaElement).value).toContain("Compare the viewpoints");
    fireEvent.change(input, { target: { value: "Compare only the edited question" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask Project" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          question: "Compare only the edited question",
          mode: "compare_viewpoints",
        }),
      }),
    );
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
              content: "Project Assessment\nThe April timing is better supported [S1 @ 00:42].",
              createdAt: "2026-08-09T12:00:01.000Z",
              answerClassification: "supported",
              sourceSetRevision: 1,
              sourceManifest,
              sourceCoverage: {
                totalVideos: 1,
                readyVideos: 1,
                evidenceVideos: 1,
                unavailableVideos: [],
                passagesExamined: 1,
                evidencePassages: 1,
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
      evidenceVideos: 1,
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
      evidencePassages: 1,
    };
    const { container } = renderWithProviders(
      <ProjectConversation
        projectId={PROJECT_ID}
        initialConversation={conversation({
          conversationId: "40000000-0000-4000-8000-000000000001",
          messagesUsed: 1,
          messages: [
            {
              id: USER_MESSAGE_ID,
              inReplyToMessageId: null,
              role: "user",
              content: "When was the launch?",
              createdAt: "2026-08-09T12:00:00.000Z",
              answerClassification: null,
              sourceSetRevision: null,
              sourceManifest: null,
              sourceCoverage: null,
              citationDiagnostics: null,
            },
            {
              id: "50000000-0000-4000-8000-000000000001",
              inReplyToMessageId: USER_MESSAGE_ID,
              role: "assistant",
              content:
                "The launch spans [S1 @ 00:42-00:58]. Unknown [S9 @ 00:10].",
              createdAt: "2026-08-09T12:00:01.000Z",
              answerClassification: "supported",
              sourceSetRevision: 3,
              sourceManifest,
              sourceCoverage,
              citationDiagnostics: [
                {
                  kind: "unknown_source",
                  raw: "[S9 @ 00:10]",
                  sourceId: "S9",
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
    expect(screen.getByText("Evidence Snapshot passages")).toBeTruthy();
    expect(screen.getByText("Pending source")).toBeTruthy();
    expect(screen.getByText("Processing")).toBeTruthy();
    expect(
      screen
        .getByRole("link", {
          name: /\[S1 @ 00:42-00:58\].*open Launch notes/i,
        })
        .getAttribute("href"),
    ).toBe("https://www.youtube.com/watch?v=aaaaaaa0001&t=42s");
    expect(screen.queryByRole("link", { name: /\[S9 @ 00:10\]/ })).toBeNull();
    expect(screen.getByRole("note").textContent).toContain(
      "1 citation could not be linked",
    );
    expect(await axe(container)).toHaveNoViolations();
  });

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

    expect(screen.getByRole("status", { name: "Source Set change revision 2" })).toBeTruthy();
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

    expect(screen.getByRole("heading", { name: "Conversation threads" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rename Launch questions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear Launch questions" })).toBeTruthy();
    const comparisonButton = screen.getByRole("button", {
      name: /^Comparison\s+0\s+messages$/,
    });
    expect(comparisonButton).toBeTruthy();
    expect(container.querySelector('[class*="overflow-y"]')).toBeNull();

    fireEvent.click(comparisonButton);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/projects/${PROJECT_ID}/conversation?conversationId=${secondId}`,
        { cache: "no-store" },
      ),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
