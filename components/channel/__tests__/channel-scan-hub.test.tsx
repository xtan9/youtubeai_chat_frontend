// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicScanRun } from "@/lib/channel-scans";
import { ChannelHub } from "../channel-scan-hub";

const RUN: PublicScanRun = {
  id: "10000000-0000-4000-8000-000000000001",
  connectedChannelId: "synthetic-demo-channel",
  videoId: null,
  failureCode: null,
  status: "partial",
  outcome: "partial",
  retryOf: null,
  createdAt: "2026-08-31T12:00:00.000Z",
  startedAt: "2026-08-31T12:00:00.100Z",
  completedAt: "2026-08-31T12:02:00.000Z",
  cancelRequestedAt: null,
  coverage: {
    pages: 4,
    threadsDiscovered: 200,
    threadsAssessed: 160,
    threadsReused: 20,
    threadsFailed: 20,
    windowStart: "2026-08-24T12:00:00.000Z",
    windowEnd: "2026-08-31T12:00:00.000Z",
    oldestThreadAt: "2026-08-25T00:00:00.000Z",
    newestThreadAt: "2026-08-31T11:59:00.000Z",
    bound: "thread_limit",
    boundPreventedCompleteCoverage: true,
    completeWithinBounds: false,
  },
  progress: { processedThreads: 200, totalThreads: 200, percent: 100 },
};

const STARTED_RUN: PublicScanRun = {
  ...RUN,
  id: "10000000-0000-4000-8000-000000000002",
  status: "queued",
  outcome: null,
  retryOf: RUN.id,
  completedAt: null,
  coverage: {
    ...RUN.coverage,
    pages: 0,
    threadsDiscovered: 0,
    threadsAssessed: 0,
    threadsReused: 0,
    threadsFailed: 0,
    bound: null,
    boundPreventedCompleteCoverage: false,
    completeWithinBounds: false,
  },
  progress: { processedThreads: 0, totalThreads: 0, percent: 0 },
};

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith("/api/channel/scans?")) return response({ runs: [RUN] });
    return response({ run: RUN });
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ChannelHub", () => {
  it("makes the synthetic bounds and truthful coverage visible", async () => {
    render(<ChannelHub />);

    expect(screen.getByRole("heading", { name: /see the signal/i })).not.toBeNull();
    expect(screen.getByText(/Reply Drafts are private assistance/i)).not.toBeNull();
    expect(screen.getByText(/per-item final review/i)).not.toBeNull();
    expect(screen.getByText("7 days / 200 threads")).not.toBeNull();
    expect((await screen.findAllByText("Partial")).length).toBeGreaterThan(0);
    expect(screen.getByText("4 pages")).not.toBeNull();
    expect(screen.getByText("200 discovered")).not.toBeNull();
    expect(screen.getByText("160 assessed · 20 reused · 20 failed")).not.toBeNull();
    expect(screen.getByText(/200-thread cap prevented complete coverage/i)).not.toBeNull();
    expect(screen.getByText(/Aug 25, 2026/)).not.toBeNull();
    expect(screen.getAllByText(/Aug 31, 2026/).length).toBeGreaterThan(0);
    expect(
      screen
        .getByRole("progressbar", { name: "Assessment progress: 100%" })
        .getAttribute("aria-valuetext"),
    ).toBe("100% of bounded scan processed");
    expect(
      screen.getByRole("status", {
        name: /assessment progress: 100% — 200 of 200 threads processed/i,
      }),
    ).not.toBeNull();
  });

  it("starts, cancels, and retries through durable endpoints without notifications", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/channel/scans?") && !init) {
        return response({ runs: [] });
      }
      if (url === "/api/channel/scans" && init?.method === "POST") {
        return response({ outcome: "started", run: STARTED_RUN }, 202);
      }
      if (url.endsWith("/cancel")) {
        return response({
          outcome: "cancelled",
          run: {
            ...STARTED_RUN,
            status: "cancelled",
            outcome: "cancelled",
            completedAt: "2026-08-31T12:01:00.000Z",
            cancelRequestedAt: "2026-08-31T12:01:00.000Z",
          },
        });
      }
      if (url.endsWith("/retry")) {
        return response({ outcome: "started", run: STARTED_RUN }, 202);
      }
      return response({ run: STARTED_RUN });
    });

    const { container } = render(<ChannelHub />);
    await screen.findByText(/no scan runs yet/i);

    fireEvent.click(screen.getByRole("button", { name: /run synthetic scan/i }));
    expect((await screen.findAllByText("Queued")).length).toBeGreaterThan(0);
    expect(container.innerHTML).toContain(
      "motion-safe:animate-spin motion-reduce:animate-none",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/channel/scans",
      expect.objectContaining({ method: "POST" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /cancel scan/i }));
    expect((await screen.findAllByText("Cancelled")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /retry scan/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/channel/scans/${STARTED_RUN.id}/retry`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
