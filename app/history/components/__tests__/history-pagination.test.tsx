// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import { screen } from "@testing-library/react";
import { HistoryPagination } from "../history-pagination";

describe("HistoryPagination", () => {
  it("renders no nav landmark when totalPages <= 1", () => {
    renderWithProviders(<HistoryPagination current={1} totalPages={0} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("renders no nav landmark when totalPages is exactly 1", () => {
    renderWithProviders(<HistoryPagination current={1} totalPages={1} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("renders only the Next link on page 1 of multi-page", () => {
    renderWithProviders(<HistoryPagination current={1} totalPages={3} />);
    expect(screen.getByText(/Page 1 of 3/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /previous/i })).toBeNull();
    const next = screen.getByRole("link", { name: /next/i });
    expect(next.getAttribute("href")).toBe("/history?page=2");
    expect(next.getAttribute("rel")).toBe("next");
  });

  it("renders only the Previous link on the last page", () => {
    renderWithProviders(<HistoryPagination current={3} totalPages={3} />);
    expect(screen.getByText(/Page 3 of 3/i)).toBeTruthy();
    const prev = screen.getByRole("link", { name: /previous/i });
    expect(prev.getAttribute("href")).toBe("/history?page=2");
    expect(prev.getAttribute("rel")).toBe("prev");
    expect(screen.queryByRole("link", { name: /next/i })).toBeNull();
  });

  it("renders both Previous and Next on a middle page", () => {
    renderWithProviders(<HistoryPagination current={2} totalPages={5} />);
    expect(screen.getByText(/Page 2 of 5/i)).toBeTruthy();
    const prev = screen.getByRole("link", { name: /previous/i });
    const next = screen.getByRole("link", { name: /next/i });
    expect(prev.getAttribute("href")).toBe("/history?page=1");
    expect(next.getAttribute("href")).toBe("/history?page=3");
  });

  it("exposes a navigation landmark labelled for AT", () => {
    renderWithProviders(<HistoryPagination current={1} totalPages={3} />);
    const nav = screen.getByRole("navigation", { name: /history pagination/i });
    expect(nav).toBeTruthy();
  });
});
