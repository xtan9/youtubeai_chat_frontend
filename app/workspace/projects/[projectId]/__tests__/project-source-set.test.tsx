// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import type {
  ProjectHistoryCandidate,
  ProjectHistoryCandidatePage,
  ProjectSourceSet as SourceSet,
  ProjectVideo,
} from "@/lib/projects/project-source-set-contract";
import { ProjectSourceSet } from "../project-source-set";

const PROJECT_ID = "a0000000-0000-4000-8000-000000000001";

function video(
  ordinal: number,
  status: ProjectVideo["status"] = "ready",
): ProjectVideo {
  const suffix = String(ordinal).padStart(12, "0");
  return {
    videoId: `10000000-0000-4000-8000-${suffix}`,
    youtubeUrl: `https://www.youtube.com/watch?v=aaaaaaa000${ordinal}`,
    youtubeVideoId: `aaaaaaa000${ordinal}`,
    title: `Source ${ordinal}`,
    channelName: "Evidence Lab",
    position: ordinal,
    status,
    failureCode: status === "failed" ? "transcript_unavailable" : null,
    addedAt: "2026-08-08T00:00:00.000Z",
    statusUpdatedAt: "2026-08-08T00:00:00.000Z",
  };
}

function sourceSet(videos: readonly ProjectVideo[], revision = 1): SourceSet {
  return { projectId: PROJECT_ID, revision, videos };
}

const HISTORY: ProjectHistoryCandidate = {
  videoId: "20000000-0000-4000-8000-000000000001",
  youtubeUrl: "https://www.youtube.com/watch?v=bbbbbbb0001",
  youtubeVideoId: "bbbbbbb0001",
  title: "History candidate",
  channelName: "Archive",
  viewedAt: "2026-08-08T00:00:00.000Z",
};

function candidatePage(
  candidates: readonly ProjectHistoryCandidate[] = [HISTORY],
  overrides: Partial<ProjectHistoryCandidatePage> = {},
): ProjectHistoryCandidatePage {
  return {
    page: 1,
    pageSize: 10,
    total: candidates.length,
    totalPages: candidates.length === 0 ? 0 : 1,
    search: "",
    candidates,
    ...overrides,
  };
}

describe("ProjectSourceSet", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows processing, ready, failed, and honest unavailable coverage", () => {
    renderWithProviders(
      <ProjectSourceSet
        projectId={PROJECT_ID}
        initialSourceSet={sourceSet([
          video(1, "ready"),
          video(2, "processing"),
          video(3, "failed"),
        ])}
        initialCandidatePage={candidatePage([])}
      />,
    );

    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("Processing")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(
      screen.getByText("2 of 3 Project Videos unavailable"),
    ).toBeTruthy();
    expect(
      screen.getByText(/Grounded actions will use only the 1 ready Video/i),
    ).toBeTruthy();
    expect(screen.getByRole("status", { name: "3 of 5 Project Videos" })).toBeTruthy();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(screen.getByRole("note")).toBeTruthy();
  });

  it("has no automated accessibility violations in the mixed-status state", async () => {
    const { container } = renderWithProviders(
      <ProjectSourceSet
        projectId={PROJECT_ID}
        initialSourceSet={sourceSet([
          video(1, "ready"),
          video(2, "processing"),
          video(3, "failed"),
        ])}
        initialCandidatePage={candidatePage()}
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it("explains and enforces the universal five-Video grounding limit", () => {
    renderWithProviders(
      <ProjectSourceSet
        projectId={PROJECT_ID}
        initialSourceSet={sourceSet([1, 2, 3, 4, 5].map((value) => video(value)))}
        initialCandidatePage={candidatePage()}
      />,
    );

    expect(screen.getByText("5 of 5")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Add from History" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText("Source Set limit reached")).toBeTruthy();
    expect(screen.getByText(/upgrading does not increase this grounding limit/i)).toBeTruthy();
    expect(screen.getByRole("status", { name: "5 of 5 Project Videos" })).toBeTruthy();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("adds a canonical History candidate and renders the refreshed source", async () => {
    const refreshed = sourceSet([video(1), { ...video(2), title: "History candidate" }], 2);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ outcome: "added", sourceSet: refreshed })),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ candidatePage: candidatePage() })),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectSourceSet
        projectId={PROJECT_ID}
        initialSourceSet={sourceSet([video(1)])}
        initialCandidatePage={candidatePage()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add from History" }));
    await screen.findByRole("button", {
      name: "Add History candidate to Source Set",
    });
    await user.click(
      screen.getByRole("button", { name: "Add History candidate to Source Set" }),
    );

    expect(await screen.findByText("Added History candidate.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/source-set`,
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST",
    )?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      videoId: HISTORY.videoId,
      expectedRevision: 1,
    });
  });

  it("submits the complete order with a revision precondition", async () => {
    const first = video(1);
    const second = video(2);
    const refreshed = sourceSet(
      [
        { ...second, position: 1 },
        { ...first, position: 2 },
      ],
      4,
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ outcome: "reordered", sourceSet: refreshed })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectSourceSet
        projectId={PROJECT_ID}
        initialSourceSet={sourceSet([first, second], 3)}
        initialCandidatePage={candidatePage([])}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Move Source 2 up" }));
    expect(await screen.findByText("Source order updated.")).toBeTruthy();
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      videoIds: [second.videoId, first.videoId],
      expectedRevision: 3,
    });
    expect(
      screen.getAllByLabelText(/Position/).map((node) => node.parentElement?.textContent),
    ).toEqual(expect.arrayContaining([expect.stringContaining("Source 2")]));
  });

  it("searches processed History on the server with honest loading and paging", async () => {
    const older = { ...HISTORY, title: "Older archive evidence" };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const searched = url.includes("search=archive");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidatePage: candidatePage(searched ? [older] : [HISTORY], {
              total: searched ? 1 : 27,
              totalPages: searched ? 1 : 3,
              search: searched ? "archive" : "",
            }),
          }),
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectSourceSet
        projectId={PROJECT_ID}
        initialSourceSet={sourceSet([])}
        initialCandidatePage={candidatePage([HISTORY], { total: 27, totalPages: 3 })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add from History" }));
    expect(await screen.findByText("27 processed Videos available.")).toBeTruthy();
    expect(
      screen.getByRole("status", {
        name: "History search results: 27 processed Videos available",
      }),
    ).toBeTruthy();
    await user.clear(screen.getByLabelText("Search History"));
    await user.type(screen.getByLabelText("Search History"), "archive");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Older archive evidence")).toBeTruthy();
    expect(
      screen.getByRole("status", {
        name: "History search results: 1 processed Video available for archive",
      }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/projects/${PROJECT_ID}/source-set/candidates?page=1&search=archive`,
    );
  });

  it("keeps one visible actionable alert when readiness changes during add", async () => {
    const current = sourceSet([video(1, "processing")], 4);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              outcome: "not_ready",
              message:
                "That History Video is not ready yet. A canonical Transcript and Summary are required.",
              sourceSet: current,
            }),
            { status: 400 },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ candidatePage: candidatePage() })),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithProviders(
      <ProjectSourceSet
        projectId={PROJECT_ID}
        initialSourceSet={current}
        initialCandidatePage={candidatePage()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add from History" }));
    await user.click(
      await screen.findByRole("button", {
        name: "Add History candidate to Source Set",
      }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "That History Video is not ready yet.",
    );
    expect(screen.queryAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("note")).toBeTruthy();
  });
});
