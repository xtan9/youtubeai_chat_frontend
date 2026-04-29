// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import { screen } from "@testing-library/react";
import { HistoryList } from "../history-list";
import type { HistoryRow as HistoryRowType } from "@/lib/services/user-history";

const ROWS: HistoryRowType[] = [
  {
    videoId: "v-1",
    youtubeUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    youtubeVideoId: "aaaaaaaaaaa",
    title: "First",
    channelName: "C1",
    viewedAt: "2026-04-28T12:00:00Z",
  },
  {
    videoId: "v-2",
    youtubeUrl: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
    youtubeVideoId: "bbbbbbbbbbb",
    title: "Second",
    channelName: "C2",
    viewedAt: "2026-04-27T12:00:00Z",
  },
];

describe("HistoryList", () => {
  it("renders one row per item", () => {
    renderWithProviders(<HistoryList rows={ROWS} />);
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
  });

  it("renders empty state when rows is empty", () => {
    renderWithProviders(<HistoryList rows={[]} />);
    expect(
      screen.getByText(/haven't summarized any videos yet/i),
    ).toBeTruthy();
  });

  it("uses an ordered-list landmark", () => {
    renderWithProviders(<HistoryList rows={ROWS} />);
    expect(screen.getByRole("list")).toBeTruthy();
  });
});
