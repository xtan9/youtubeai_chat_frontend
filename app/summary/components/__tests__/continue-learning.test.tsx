// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const themeMock = vi.fn();
const useContinueLearningMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("next-themes", () => ({
  useTheme: () => themeMock(),
}));
vi.mock("@/lib/hooks/useContinueLearning", () => ({
  useContinueLearning: (...args: unknown[]) => useContinueLearningMock(...args),
}));

import { ContinueLearningSection } from "../continue-learning";

const SOURCE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const READY = {
  status: "ready" as const,
  data: {
    outcome: "ready" as const,
    setVersionToken: "cl1s.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    items: [
      {
        token: "cl1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        ordinal: 1,
        canonicalUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
        title: "A next lesson",
        channelName: "Teaching Channel",
        thumbnailUrl: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
        relationship: "deeper_explanation" as const,
        explanation: "Builds on the source concept.",
      },
    ],
  },
};

beforeEach(() => {
  themeMock.mockReturnValue({ resolvedTheme: "light" });
  useContinueLearningMock.mockReturnValue(READY);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({ outcome: "recorded", judgment: "useful", ordinal: 1 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ContinueLearningSection", () => {
  it("renders accessible cards after the Summary Stats boundary", () => {
    render(<ContinueLearningSection sourceUrl={SOURCE_URL} enabled />);

    expect(screen.getByRole("heading", { name: /continue learning/i })).toBeTruthy();
    expect(screen.getByRole("list")).toBeTruthy();
    expect(screen.getByRole("listitem").textContent).toContain("A next lesson");
    expect(screen.getByText("Deeper explanation")).toBeTruthy();
    expect(
      screen.getByTestId("continue-learning-relationship").getAttribute("aria-label"),
    ).toBe("Continuation relationship: Deeper explanation");
    expect(screen.getByText("Builds on the source concept.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /summarize next/i }).getAttribute("href")).toBe(
      `/summary?url=${encodeURIComponent(READY.data.items[0].canonicalUrl)}`,
    );
    expect(screen.getByRole("link", { name: /watch on youtube/i }).getAttribute("target")).toBe(
      "_blank",
    );
  });

  it("shows a reduced-motion-safe preparation skeleton", () => {
    useContinueLearningMock.mockReturnValue({ status: "pending" });
    render(<ContinueLearningSection sourceUrl={SOURCE_URL} enabled />);

    expect(
      screen.getByTestId("continue-learning-skeleton").getAttribute("aria-busy"),
    ).toBe("true");
    expect(screen.getByTestId("continue-learning-skeleton").className).toContain(
      "motion-reduce:animate-none",
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("silently removes unavailable or disabled output", () => {
    useContinueLearningMock.mockReturnValue({ status: "unavailable" });
    const { rerender } = render(
      <ContinueLearningSection sourceUrl={SOURCE_URL} enabled />,
    );
    expect(screen.queryByRole("heading", { name: /continue learning/i })).toBeNull();

    rerender(<ContinueLearningSection sourceUrl={SOURCE_URL} enabled={false} />);
    expect(useContinueLearningMock).toHaveBeenLastCalledWith(SOURCE_URL, {
      enabled: false,
    });
  });

  it("keeps Watch on YouTube secondary and safe for a new tab", () => {
    render(<ContinueLearningSection sourceUrl={SOURCE_URL} enabled />);
    const watch = screen.getByRole("link", { name: /watch on youtube/i });
    expect(watch.getAttribute("rel")).toBe("noopener noreferrer");
    fireEvent.click(screen.getByRole("link", { name: /summarize next/i }));
  });

  it("submits a governed judgment through the opaque Recommendation token", async () => {
    render(<ContinueLearningSection sourceUrl={SOURCE_URL} enabled />);

    const useful = screen.getByRole("button", { name: "Useful recommendation" });
    const notUseful = screen.getByRole("button", {
      name: "Not useful recommendation",
    });
    expect(useful.getAttribute("aria-pressed")).toBe("false");
    expect(notUseful.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(useful);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/continue-learning/feedback",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: READY.data.items[0].token,
            judgment: "useful",
          }),
        }),
      );
      expect(useful.getAttribute("aria-pressed")).toBe("true");
    });
  });

  it("keeps Recommendation actions usable when Feedback fails", async () => {
    fetchMock.mockRejectedValue(new Error("feedback transport unavailable"));
    render(<ContinueLearningSection sourceUrl={SOURCE_URL} enabled />);

    fireEvent.click(
      screen.getByRole("button", { name: "Not useful recommendation" }),
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(screen.getByRole("link", { name: /summarize next/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /watch on youtube/i })).toBeTruthy();
  });
});
