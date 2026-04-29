// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import { screen } from "@testing-library/react";
import type { HistoryRow } from "@/lib/services/user-history";

const mockGetUser = vi.fn();
const mockGetHistoryPage = vi.fn();
const mockRedirect = vi.fn(() => {
  throw new Error("REDIRECT");
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));
vi.mock("@/lib/services/user-history", () => ({
  getHistoryPage: (...args: unknown[]) => mockGetHistoryPage(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));

import HistoryPage from "../page";

const ROW: HistoryRow = {
  videoId: "v-1",
  youtubeUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
  youtubeVideoId: "aaaaaaaaaaa",
  title: "Older Video",
  channelName: "C1",
  viewedAt: "2026-04-28T12:00:00Z",
};

describe("HistoryPage", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockGetHistoryPage.mockReset();
    mockRedirect.mockClear();
  });

  it("redirects unauthenticated users to /auth/login", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(
      HistoryPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("renders rows for the authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetHistoryPage.mockResolvedValue({
      ok: true,
      rows: [ROW],
      total: 1,
      totalPages: 1,
    });
    const ui = await HistoryPage({ searchParams: Promise.resolve({}) });
    renderWithProviders(ui);
    expect(screen.getByText("Older Video")).toBeTruthy();
  });

  it("uses page=N from search params", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetHistoryPage.mockResolvedValue({
      ok: true,
      rows: [ROW],
      total: 50,
      totalPages: 2,
    });
    await HistoryPage({ searchParams: Promise.resolve({ page: "2" }) });
    expect(mockGetHistoryPage).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      2,
      25,
    );
  });

  it("clamps invalid page values to 1", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetHistoryPage.mockResolvedValue({
      ok: true,
      rows: [],
      total: 0,
      totalPages: 0,
    });
    await HistoryPage({
      searchParams: Promise.resolve({ page: "garbage" }),
    });
    expect(mockGetHistoryPage).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      1,
      25,
    );
  });

  it("redirects to last page when page is past totalPages", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetHistoryPage.mockResolvedValue({
      ok: true,
      rows: [],
      total: 30,
      totalPages: 2,
    });
    await expect(
      HistoryPage({ searchParams: Promise.resolve({ page: "99" }) }),
    ).rejects.toThrow("REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/history?page=2");
  });

  it("does NOT redirect when totalPages is 0 (truly empty)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetHistoryPage.mockResolvedValue({
      ok: true,
      rows: [],
      total: 0,
      totalPages: 0,
    });
    const ui = await HistoryPage({
      searchParams: Promise.resolve({ page: "5" }),
    });
    renderWithProviders(ui);
    expect(
      screen.getByText(/haven't summarized any videos yet/i),
    ).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("shows pagination links when totalPages > 1", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetHistoryPage.mockResolvedValue({
      ok: true,
      rows: [ROW],
      total: 50,
      totalPages: 2,
    });
    const ui = await HistoryPage({
      searchParams: Promise.resolve({ page: "1" }),
    });
    renderWithProviders(ui);
    expect(screen.getByText(/Page 1 of 2/i)).toBeTruthy();
    const nextLink = screen.getByRole("link", { name: /next/i });
    expect(nextLink.getAttribute("href")).toBe("/history?page=2");
  });

  it("does not render pagination when totalPages is 1", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetHistoryPage.mockResolvedValue({
      ok: true,
      rows: [ROW],
      total: 5,
      totalPages: 1,
    });
    const ui = await HistoryPage({
      searchParams: Promise.resolve({ page: "1" }),
    });
    renderWithProviders(ui);
    expect(screen.queryByText(/Page 1 of/i)).toBeNull();
  });

  it("renders fetch-error UI when service fails (NOT the empty state)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetHistoryPage.mockResolvedValue({ ok: false });
    const ui = await HistoryPage({
      searchParams: Promise.resolve({ page: "1" }),
    });
    renderWithProviders(ui);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      screen.queryByText(/haven't summarized any videos yet/i),
    ).toBeNull();
  });
});
