// @vitest-environment happy-dom
import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { UpgradeRequiredError } from "@/lib/errors/upgrade-required";

const analyticsMocks = vi.hoisted(() => ({
  capture: vi.fn(),
}));
vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: analyticsMocks.capture,
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

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
  useStageTimers: () => ({ transcriptionTime: 0, summaryTime: 0 }),
}));
vi.mock("../results-display", () => ({
  ResultsDisplay: () => <div>summary results</div>,
}));
vi.mock("../chat-tab", () => ({
  ChatTab: () => <div>chat</div>,
}));
vi.mock("@/lib/contexts/user-context", () => ({
  useUser: () => ({ user: { id: "u1", is_anonymous: false }, session: { access_token: "tok" } }),
}));
vi.mock("@/lib/hooks/useEntitlements", () => ({
  useEntitlements: () => ({
    data: {
      tier: "free",
      caps: { summariesUsed: 10, summariesLimit: 10 },
    },
    isError: false,
  }),
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
  analyticsMocks.capture.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("YouTubeSummarizerApp — 402 upgrade gate", () => {
  it("renders UpgradeCard and records a quota-blocked summary", async () => {
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
        fetchStatus: "idle",
        dataUpdatedAt: 0,
        errorUpdatedAt: 123,
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

    // UpgradeCard renders with the summary-cap variant data attribute. Don't
    // assert specific copy here — it's owned by UpgradeCard's own test suite.
    expect(
      document.querySelector('[data-paywall-variant="summary-cap"]')
    ).not.toBeNull();
    await waitFor(() =>
      expect(analyticsMocks.capture).toHaveBeenCalledWith("summary_failed", {
        account_type: "registered",
        source_surface: "summary",
        output_language: "video_native",
        failure_category: "quota",
        error_code: "free_quota_exceeded",
        http_status: 402,
      }),
    );
  });

  it("records a terminal cached summary without content properties", async () => {
    const stream = [
      'data: {"type":"metadata","category":"general","cached":true}',
      'data: {"type":"content","text":"A useful summary"}',
      'data: {"type":"summary","total_time":3,"summarize_time":2,"transcribe_time":1}',
      "",
    ].join("\n");
    mockUseYouTubeSummarizer.mockReturnValue({
      summarizationQuery: {
        data: [
          {
            title: "Streaming Summary",
            duration: "Streaming in progress",
            summary: stream,
            transcriptionTime: 0,
            summaryTime: 0,
          },
        ],
        error: null,
        isLoading: false,
        isFetching: false,
        fetchStatus: "idle",
        dataUpdatedAt: 456,
        errorUpdatedAt: 0,
        refetch: vi.fn(),
      },
      isAnonymous: true,
      isAuthLoading: false,
    });

    const qc = freshQueryClient();
    render(
      <Wrapper qc={qc}>
        <YouTubeSummarizerApp initialUrl="https://youtu.be/x" />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(analyticsMocks.capture).toHaveBeenCalledWith(
        "summary_succeeded",
        {
          account_type: "anonymous",
          source_surface: "summary",
          result_origin: "cache",
          output_language: "video_native",
          transcription_seconds: 1,
          summary_seconds: 2,
          total_seconds: 3,
        },
      ),
    );
  });
});
