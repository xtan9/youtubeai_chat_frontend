// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import { screen } from "@testing-library/react";
import { HistoryRow } from "../history-row";
import type { HistoryRow as HistoryRowType } from "@/lib/services/user-history";

const NOW = new Date("2026-04-28T12:00:00Z").getTime();

const ROW: HistoryRowType = {
  videoId: "v-1",
  youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  youtubeVideoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
  channelName: "Rick Astley",
  viewedAt: "2026-04-25T12:00:00Z",
};

describe("HistoryRow", () => {
  it("renders title, channel and relative date", () => {
    renderWithProviders(<HistoryRow row={ROW} now={NOW} />);
    expect(screen.getByText("Never Gonna Give You Up")).toBeTruthy();
    expect(screen.getByText("Rick Astley")).toBeTruthy();
    expect(screen.getByText("3 days ago")).toBeTruthy();
  });

  it("links to /summary?url=<encoded original>", () => {
    renderWithProviders(<HistoryRow row={ROW} now={NOW} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(
      "/summary?url=" +
        encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    );
  });

  it("link has accessible name including the title", () => {
    renderWithProviders(<HistoryRow row={ROW} now={NOW} />);
    expect(
      screen.getByRole("link", { name: /Never Gonna Give You Up/i }),
    ).toBeTruthy();
  });

  it("uses youtube thumbnail when youtubeVideoId is present", () => {
    const { container } = renderWithProviders(
      <HistoryRow row={ROW} now={NOW} />,
    );
    const img = container.querySelector("img") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.src).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
  });

  it("does NOT render an img tag when youtubeVideoId is null", () => {
    const { container } = renderWithProviders(
      <HistoryRow row={{ ...ROW, youtubeVideoId: null }} now={NOW} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("falls back to 'Untitled' when title is null", () => {
    renderWithProviders(
      <HistoryRow row={{ ...ROW, title: null }} now={NOW} />,
    );
    expect(screen.getByText("Untitled")).toBeTruthy();
  });

  it("does not render channel line when channelName is null", () => {
    renderWithProviders(
      <HistoryRow row={{ ...ROW, channelName: null }} now={NOW} />,
    );
    expect(screen.queryByText("Rick Astley")).toBeNull();
  });
});
