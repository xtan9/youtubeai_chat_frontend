// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import { screen } from "@testing-library/react";
import type { HistoryRow } from "@/lib/services/user-history";

const mockGetUser = vi.fn();
const mockGetRecentHistory = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockRedirect = vi.fn((_path: string) => {
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
// Chat-count badge fetch is hoisted from `lib/services/chat-counts.ts`.
// Default to "no chat counts" so existing assertions keep working;
// the badge-rendering case has its own dedicated test below.
const mockGetChatMessageCounts = vi.fn();
vi.mock("@/lib/services/chat-counts", () => ({
  getChatMessageCounts: (...args: unknown[]) => mockGetChatMessageCounts(...args),
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
    mockGetChatMessageCounts.mockReset();
    mockGetChatMessageCounts.mockResolvedValue(new Map());
  });

  it("redirects to /auth/login when no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(DashboardPage()).rejects.toThrow("REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("redirects Supabase-anonymous user (is_anonymous=true) to /auth/login", async () => {
    // Anon-auth users come from the hero's signInAnonymously() so they
    // can chat without signing up. The middleware now correctly leaves
    // them on `/`, but a direct visit to /dashboard must still bounce
    // them — they have no real account and no history to show, and
    // rendering "Welcome back," with an empty greeting is broken UX.
    mockGetUser.mockResolvedValue({
      data: { user: { id: "anon-1", email: "", is_anonymous: true } },
    });
    await expect(DashboardPage()).rejects.toThrow("REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/auth/login");
  });

  it("renders input form, recent label, and history list when authenticated", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "u@example.com" } },
    });
    mockGetRecentHistory.mockResolvedValue({ ok: true, rows: [ROW] });
    const ui = await DashboardPage();
    renderWithProviders(ui);
    expect(screen.getByTestId("input-form")).toBeTruthy();
    expect(screen.getByText(/recent/i)).toBeTruthy();
    expect(screen.getByText("Welcome Back Video")).toBeTruthy();
  });

  it("does not show 'View all' link when fewer than 10 rows", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetRecentHistory.mockResolvedValue({ ok: true, rows: [ROW] });
    const ui = await DashboardPage();
    renderWithProviders(ui);
    expect(screen.queryByText(/view all/i)).toBeNull();
  });

  it("does not show 'View all' link when there are exactly 9 rows", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetRecentHistory.mockResolvedValue({
      ok: true,
      rows: Array.from({ length: 9 }, (_, i) => ({ ...ROW, videoId: `v-${i}` })),
    });
    const ui = await DashboardPage();
    renderWithProviders(ui);
    expect(screen.queryByText(/view all/i)).toBeNull();
  });

  it("shows 'View all' link when there are 10 rows", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetRecentHistory.mockResolvedValue({
      ok: true,
      rows: Array.from({ length: 10 }, (_, i) => ({ ...ROW, videoId: `v-${i}` })),
    });
    const ui = await DashboardPage();
    renderWithProviders(ui);
    const link = screen.getByRole("link", { name: /view all/i });
    expect(link.getAttribute("href")).toBe("/history");
  });

  it("renders empty state when there is no history", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetRecentHistory.mockResolvedValue({ ok: true, rows: [] });
    const ui = await DashboardPage();
    renderWithProviders(ui);
    expect(
      screen.getByText(/haven't summarized any videos yet/i),
    ).toBeTruthy();
  });

  it("renders fetch-error UI when service fails (NOT the empty state)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetRecentHistory.mockResolvedValue({ ok: false });
    const ui = await DashboardPage();
    renderWithProviders(ui);
    // The form must still render so the user can submit a fresh URL.
    expect(screen.getByTestId("input-form")).toBeTruthy();
    // The error message must be the fetch-error, not the friendly empty state.
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      screen.queryByText(/haven't summarized any videos yet/i),
    ).toBeNull();
  });

  it("does not show 'View all' when fetch fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetRecentHistory.mockResolvedValue({ ok: false });
    const ui = await DashboardPage();
    renderWithProviders(ui);
    expect(screen.queryByText(/view all/i)).toBeNull();
  });

  it("greets the user with email-local-part when no full_name", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "alex@example.com" } },
    });
    mockGetRecentHistory.mockResolvedValue({ ok: true, rows: [] });
    const ui = await DashboardPage();
    renderWithProviders(ui);
    expect(screen.getByText(/Welcome back, alex/i)).toBeTruthy();
  });

  it("renders the chat-count badge on rows that have chat messages", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetRecentHistory.mockResolvedValue({ ok: true, rows: [ROW] });
    mockGetChatMessageCounts.mockResolvedValue(new Map([[ROW.videoId, 4]]));
    const ui = await DashboardPage();
    renderWithProviders(ui);
    const badge = screen.getByTestId("chat-count-badge");
    expect(badge.textContent).toContain("4");
    // Aria label conveys the count to assistive tech.
    expect(badge.getAttribute("aria-label")).toMatch(/4 chat messages/i);
  });

  it("does not render the chat-count badge when a row has zero messages", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockGetRecentHistory.mockResolvedValue({ ok: true, rows: [ROW] });
    mockGetChatMessageCounts.mockResolvedValue(new Map());
    const ui = await DashboardPage();
    renderWithProviders(ui);
    expect(screen.queryByTestId("chat-count-badge")).toBeNull();
  });
});
