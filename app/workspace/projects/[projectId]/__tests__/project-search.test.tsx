// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import type { ProjectTranscriptPassage } from "@/lib/projects/project-passage-search-contract";
import { ProjectSearch } from "../project-search";

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: analytics.capture,
}));

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";
const VIDEO_A = "b0000000-0000-4000-8000-000000000001";
const VIDEO_B = "c0000000-0000-4000-8000-000000000002";

function passage(
  videoId: string,
  youtubeVideoId: string,
  title: string,
  text: string,
): ProjectTranscriptPassage {
  const length = Array.from(text).length;
  return {
    passageId: `${videoId}:1:0:${length}`,
    videoId,
    youtubeVideoId,
    title,
    channelName: "Evidence Lab",
    text,
    segmentOrdinal: 1,
    excerptStartCharacter: 0,
    excerptEndCharacter: length,
    startSeconds: 42,
    endSeconds: 47,
    language: "en",
    truncatedStart: false,
    truncatedEnd: false,
  };
}

function jsonResponse(search: unknown, status = 200) {
  return new Response(JSON.stringify({ search }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function runSearch(query = "renewable energy") {
  const user = userEvent.setup();
  const input = screen.getByRole("searchbox", {
    name: "Search exact Transcript passages",
  });
  await user.type(input, query);
  await user.click(screen.getByRole("button", { name: "Search Transcripts" }));
}

describe("ProjectSearch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    analytics.capture.mockReset();
  });

  it("renders exact passages with unambiguous same-timestamp Video links", async () => {
    const first = passage(
      VIDEO_A,
      "aaaaaaa0001",
      "Solar evidence",
      "Renewable energy lowers operating emissions.",
    );
    const second = passage(
      VIDEO_B,
      "bbbbbbb0002",
      "Grid evidence",
      "Renewable energy needs transmission investment.",
    );
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "ready",
        sourceSetRevision: 9,
        coverage: {
          totalVideos: 2,
          readyVideos: 2,
          unavailableVideos: [],
          passagesExamined: 30,
        },
        passages: [first, second],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const { container } = renderWithProviders(
      <ProjectSearch projectId={PROJECT_ID} />,
    );

    await runSearch();

    expect(await screen.findByText(first.text)).toBeTruthy();
    expect(screen.getByText(second.text)).toBeTruthy();
    const firstLink = screen.getByRole("link", {
      name: "Open Solar evidence at [0:42]",
    });
    const secondLink = screen.getByRole("link", {
      name: "Open Grid evidence at [0:42]",
    });
    expect(firstLink.getAttribute("href")).toBe(
      "https://www.youtube.com/watch?v=aaaaaaa0001&t=42s",
    );
    expect(secondLink.getAttribute("href")).toBe(
      "https://www.youtube.com/watch?v=bbbbbbb0002&t=42s",
    );
    expect(firstLink.getAttribute("target")).toBe("_blank");
    const privacyBoundary = firstLink.closest("section");
    expect(privacyBoundary?.classList.contains("ph-no-capture")).toBe(true);
    expect(privacyBoundary?.hasAttribute("data-ph-no-autocapture")).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/search`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "renewable energy" }),
      },
    );
    expect(fetch.mock.calls[0]?.[0]).not.toContain("renewable energy");
    expect(fetch.mock.calls[0]?.[0]).not.toContain("?");
    expect(analytics.capture).toHaveBeenCalledWith(
      "project_search_completed",
      {
        project_id: PROJECT_ID,
        source_set_revision: 9,
        outcome: "ready",
        result_count: 2,
        total_videos: 2,
        ready_videos: 2,
        unavailable_videos: 0,
        passages_examined: 30,
      },
    );
    expect(JSON.stringify(analytics.capture.mock.calls)).not.toContain(
      "renewable energy",
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("accepts 200 astral code points and rejects 201 before requesting", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "no_results",
        sourceSetRevision: 1,
        coverage: {
          totalVideos: 1,
          readyVideos: 1,
          unavailableVideos: [],
          passagesExamined: 1,
        },
        passages: [],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    renderWithProviders(<ProjectSearch projectId={PROJECT_ID} />);
    const user = userEvent.setup();
    const input = screen.getByRole("searchbox", {
      name: "Search exact Transcript passages",
    }) as HTMLInputElement;
    expect(input.maxLength).toBe(-1);

    const validQuery = "\u{1F30D}".repeat(200);
    fireEvent.change(input, { target: { value: validQuery } });
    await user.click(screen.getByRole("button", { name: "Search Transcripts" }));
    expect(await screen.findByText("No matching Transcript passages")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/search`,
      expect.objectContaining({ body: JSON.stringify({ query: validQuery }) }),
    );

    fireEvent.change(input, { target: { value: "\u{1F30D}".repeat(201) } });
    await user.click(screen.getByRole("button", { name: "Search Transcripts" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Enter 2 to 200 characters",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a no-match result with partial unavailable coverage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: "no_results",
          sourceSetRevision: 4,
          coverage: {
            totalVideos: 3,
            readyVideos: 1,
            unavailableVideos: [
              {
                videoId: VIDEO_A,
                youtubeVideoId: "aaaaaaa0001",
                title: "Still processing",
                channelName: null,
                status: "processing",
                failureCode: null,
              },
              {
                videoId: VIDEO_B,
                youtubeVideoId: "bbbbbbb0002",
                title: "Acquisition failed",
                channelName: null,
                status: "failed",
                failureCode: "transcript_failed",
              },
            ],
            passagesExamined: 12,
          },
          passages: [],
        }),
      ),
    );
    renderWithProviders(<ProjectSearch projectId={PROJECT_ID} />);

    await runSearch("unmatched idea");

    expect(await screen.findByText("No matching Transcript passages")).toBeTruthy();
    expect(screen.getByText("1 of 3 Project Videos searched")).toBeTruthy();
    expect(screen.getByText("Still processing")).toBeTruthy();
    expect(screen.getByText("Acquisition failed")).toBeTruthy();
    expect(screen.queryByText("No ready Project Transcripts")).toBeNull();
  });

  it("distinguishes fully ready no-results from fully unavailable coverage", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          status: "no_results",
          sourceSetRevision: 1,
          coverage: {
            totalVideos: 2,
            readyVideos: 2,
            unavailableVideos: [],
            passagesExamined: 18,
          },
          passages: [],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "not_ready",
          sourceSetRevision: 2,
          coverage: {
            totalVideos: 1,
            readyVideos: 0,
            unavailableVideos: [
              {
                videoId: VIDEO_A,
                youtubeVideoId: "aaaaaaa0001",
                title: "Processing Video",
                channelName: null,
                status: "processing",
                failureCode: null,
              },
            ],
            passagesExamined: 0,
          },
          passages: [],
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const { unmount } = renderWithProviders(
      <ProjectSearch projectId={PROJECT_ID} />,
    );
    await runSearch("first miss");
    expect(
      await screen.findByText(/All 2 ready Project Transcripts were searched/),
    ).toBeTruthy();
    expect(screen.queryByText(/Project Videos searched/)).toBeNull();

    unmount();
    renderWithProviders(<ProjectSearch projectId={PROJECT_ID} />);
    await runSearch("second miss");
    expect(await screen.findByText("No ready Project Transcripts")).toBeTruthy();
    expect(screen.getByText("0 of 1 Project Videos searched")).toBeTruthy();
  });

  it("is keyboard operable and announces an actionable adapter failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            outcome: "unavailable",
            message: "Project Search is temporarily unavailable. Try again.",
          }),
          { status: 503 },
        ),
      ),
    );
    renderWithProviders(<ProjectSearch projectId={PROJECT_ID} />);
    const user = userEvent.setup();
    await user.tab();
    const input = screen.getByRole("searchbox", {
      name: "Search exact Transcript passages",
    });
    expect(document.activeElement).toBe(input);
    await user.type(input, "evidence");
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Search Transcripts" }),
    );
    await user.keyboard("{Enter}");

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Project Search is temporarily unavailable. Try again.",
    );
    await waitFor(() =>
      expect(analytics.capture).toHaveBeenCalledWith(
        "project_action_failed",
        {
          project_id: PROJECT_ID,
          action_kind: "search",
          error_class: "processing",
          http_status: 503,
        },
      ),
    );
  });

  it.each([
    [401, "authentication"],
    [403, "authorization"],
    [429, "rate_limit"],
    [400, "request"],
    [503, "processing"],
  ] as const)(
    "classifies HTTP %s before strict success-payload parsing",
    async (status, errorClass) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json({ outcome: "failure", message: "Try again." }, { status }),
        ),
      );
      renderWithProviders(<ProjectSearch projectId={PROJECT_ID} />);
      await runSearch();

      await waitFor(() =>
        expect(analytics.capture).toHaveBeenCalledWith(
          "project_action_failed",
          {
            project_id: PROJECT_ID,
            action_kind: "search",
            error_class: errorClass,
            http_status: status,
          },
        ),
      );
    },
  );
});
