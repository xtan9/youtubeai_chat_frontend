// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { UpgradeRequiredError } from "@/lib/errors/upgrade-required";

// Mock heavy dependencies before importing the component
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual };
});

vi.mock("@/lib/hooks/useYouTubeSummarizer");
vi.mock("@/lib/hooks/useClipboard", () => ({
  useClipboard: () => ({ copied: false, copy: vi.fn() }),
}));
vi.mock("@/lib/hooks/useStageTimers", () => ({
  useStageTimers: () => ({ stage: "idle", elapsed: 0, resetTimers: vi.fn() }),
}));
vi.mock("@/lib/contexts/user-context", () => ({
  useUser: () => ({ user: { id: "u1", is_anonymous: false }, session: { access_token: "tok" } }),
}));

import { useYouTubeSummarizer } from "@/lib/hooks/useYouTubeSummarizer";
import { YouTubeSummarizerApp } from "../youtube-summarizer-app";

function freshQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function Wrapper({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const mockUseYouTubeSummarizer = useYouTubeSummarizer as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("YouTubeSummarizerApp — 402 upgrade gate", () => {
  it("renders UpgradeCard when summarizationQuery errors with UpgradeRequiredError", () => {
    const upgradeError = new UpgradeRequiredError({
      errorCode: "free_quota_exceeded",
      tier: "free",
      upgradeUrl: "/pricing",
      message: "Monthly summary limit reached",
    });

    mockUseYouTubeSummarizer.mockReturnValue({
      summarizationQuery: {
        data: undefined,
        error: upgradeError,
        isLoading: false,
        isFetching: false,
        refetch: vi.fn(),
      },
      isAnonymous: false,
      isAuthLoading: false,
    });

    const qc = freshQueryClient();
    render(
      <Wrapper qc={qc}>
        <YouTubeSummarizerApp initialUrl="https://youtu.be/x" />
      </Wrapper>
    );

    // UpgradeCard with variant="summary-cap" renders this title
    expect(
      screen.getByText(/you've used your 10 free summaries/i)
    ).not.toBeNull();
  });
});
