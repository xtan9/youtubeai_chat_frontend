// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import { screen } from "@testing-library/react";
import type { HistoryRow } from "@/lib/services/user-history";

const mockGetUser = vi.fn();
const mockGetRecentHistory = vi.fn();
const mockRedirect = vi.fn(() => {
  throw new Error("REDIRECT");
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));
vi.mock("@/lib/services/user-history", () => ({
  getRecentHistory: (...args: unknown[]) => mockGetRecentHistory(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));
vi.mock("@/app/components/input-form", () => ({
  InputForm: () => <div data-testid="input-form" />,
}));

import DashboardPage from "../page";

const ROW: HistoryRow = {
  videoId: "v-1",
  youtubeUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
  youtubeVideoId: "aaaaaaaaaaa",
  title: "Welcome Back Video",
  channelName: "C1",
  viewedAt: "2026-04-28T12:00:00Z",
};

describe("DashboardPage", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockGetRecentHistory.mockReset();
    mockRedirect.mockClear();
  });

  it("redirects to /auth/login when no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(DashboardPage()).rejects.toThrow("REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("renders input form, recent label, and history list when authenticated", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "u@example.com" } },
    });
    mockGetRecentHistory.mockResolvedValue([ROW]);
    const ui = await DashboardPage();
    renderWithProviders(ui);
    expect(screen.getByTestId("input-form")).toBeTruthy();
    expect(screen.getByText(/recent/i)).toBeTruthy();
    expect(screen.getByText("Welcome Back Video")).toBeTruthy();
  });

  it("does not show 'View all' link when fewer than 10 rows", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1" } },
    });
    mockGetRecentHistory.mockResolvedValue([ROW]);
    const ui = await DashboardPage();
    renderWithProviders(ui);
    expect(screen.queryByText(/view all/i)).toBeNull();
  });

  it("shows 'View all' link when there are 10 rows", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1" } },
    });
    mockGetRecentHistory.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ ...ROW, videoId: `v-${i}` })),
    );
    const ui = await DashboardPage();
    renderWithProviders(ui);
    const link = screen.getByRole("link", { name: /view all/i });
    expect(link.getAttribute("href")).toBe("/history");
  });

  it("renders empty state when there is no history", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1" } },
    });
    mockGetRecentHistory.mockResolvedValue([]);
    const ui = await DashboardPage();
    renderWithProviders(ui);
    expect(
      screen.getByText(/haven't summarized any videos yet/i),
    ).toBeTruthy();
  });

  it("greets the user with email-local-part when no full_name", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "alex@example.com" } },
    });
    mockGetRecentHistory.mockResolvedValue([]);
    const ui = await DashboardPage();
    renderWithProviders(ui);
    expect(screen.getByText(/Welcome back, alex/i)).toBeTruthy();
  });
});
