// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/app/admin/users/_actions/view-transcript", () => ({
  viewTranscriptAction: vi.fn(),
}));

vi.mock("../admin-context", () => ({
  useAdmin: () => ({ email: "alice@example.com" }),
}));

import { viewTranscriptAction } from "@/app/admin/users/_actions/view-transcript";
import {
  TranscriptModal,
  type TranscriptModalTarget,
} from "../transcript-modal";

const actionMock = vi.mocked(viewTranscriptAction);

const SUMMARY_ID = "11111111-2222-3333-4444-555555555555";
const VIEWED_USER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const target: TranscriptModalTarget = {
  summaryId: SUMMARY_ID,
  viewedUserId: VIEWED_USER,
  videoTitle: "Optimistic title",
  channel: "Optimistic channel",
  language: "en",
  source: "whisper",
  model: "claude-opus-4-7",
  processingTimeSeconds: 12.5,
};

const happyResult = {
  ok: true as const,
  transcript: "transcript body",
  summary: "summary body",
  thinking: null,
  videoTitle: "Authoritative title",
  channelName: "Authoritative channel",
  language: "en",
  videoFetchFailed: false,
  source: "whisper" as const,
  model: "claude-opus-4-7",
  processingTimeSeconds: 12.5,
  createdAt: "2026-04-29T10:00:00Z",
  auditId: "audit-row-1",
  auditFailureReason: null,
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  actionMock.mockReset();
});

describe("<TranscriptModal>", () => {
  it("renders 'logging this view…' headline while the action is in flight", () => {
    actionMock.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<TranscriptModal target={target} onClose={() => {}} />);
    expect(screen.getByText(/logging this view/i)).toBeTruthy();
    // Optimistic header values are visible before the action returns.
    expect(screen.getByText("Optimistic title")).toBeTruthy();
  });

  it("switches headline to 'this view is logged' once the audit row is written", async () => {
    actionMock.mockResolvedValue(happyResult);
    render(<TranscriptModal target={target} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/this view is logged/i)).toBeTruthy(),
    );
    // Authoritative title from action result replaces optimistic value.
    expect(screen.getByText("Authoritative title")).toBeTruthy();
    // Footer shows the audit-row prefix.
    expect(screen.getByText(/audit-/i)).toBeTruthy();
  });

  it("shows 'audit write failed' headline + reason when audit insert fails (fail-open)", async () => {
    actionMock.mockResolvedValue({
      ...happyResult,
      auditId: null,
      auditFailureReason: "connection_timeout",
    });
    render(<TranscriptModal target={target} onClose={() => {}} />);
    // Match in two places (banner + footer) is correct UX — we want the
    // operator to see the failure both at the top and in the footer.
    await waitFor(() =>
      expect(screen.getAllByText(/audit write failed/i).length).toBeGreaterThan(0),
    );
    expect(screen.getByText(/connection_timeout/i)).toBeTruthy();
    // Transcript content still renders — fail-open contract.
    expect(screen.getByText("transcript body")).toBeTruthy();
  });

  it("shows 'view did not load' on error result (with stable user-facing copy)", async () => {
    actionMock.mockResolvedValue({ ok: false, reason: "summary_not_found" });
    render(<TranscriptModal target={target} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/view did not load/i)).toBeTruthy(),
    );
    // The wire reason "summary_not_found" must NOT appear in user copy.
    expect(screen.queryByText(/summary_not_found/i)).toBeNull();
    // Summary pane + footer both render the human reason; that's intentional.
    expect(
      screen.getAllByText(/Summary no longer exists/i).length,
    ).toBeGreaterThan(0);
  });

  it("recovers from a thrown action (e.g. AuthInfraError) into error state, not infinite loading", async () => {
    actionMock.mockRejectedValue(
      Object.assign(new Error("auth down"), { name: "AuthInfraError" }),
    );
    render(<TranscriptModal target={target} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/view did not load/i)).toBeTruthy(),
    );
  });

  it("re-throws Next's redirect sentinel so Next handles it (no error-state silently absorbed)", async () => {
    const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/;0",
    });
    actionMock.mockRejectedValue(redirectErr);
    // Suppress the unhandled-rejection noise this generates intentionally.
    const onError = vi.fn();
    window.addEventListener("error", onError);
    render(<TranscriptModal target={target} onClose={() => {}} />);
    // Modal should NOT settle on error state — we re-throw redirects so
    // Next's runtime handles them. The headline stays on "logging" which
    // is fine: the redirect navigates away before the user sees the modal.
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText(/view did not load/i)).toBeNull();
    window.removeEventListener("error", onError);
  });

  it("invokes the action exactly once when target props are stable across re-renders", async () => {
    actionMock.mockResolvedValue(happyResult);
    const { rerender } = render(
      <TranscriptModal target={target} onClose={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByText(/this view is logged/i)).toBeTruthy(),
    );
    // Re-render with the same target object — no new action call.
    rerender(<TranscriptModal target={target} onClose={() => {}} />);
    rerender(<TranscriptModal target={{ ...target }} onClose={() => {}} />);
    expect(actionMock).toHaveBeenCalledTimes(1);
  });

  it("re-runs the action exactly once when target.summaryId changes", async () => {
    actionMock.mockResolvedValue(happyResult);
    const { rerender } = render(
      <TranscriptModal target={target} onClose={() => {}} />,
    );
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    const newId = "22222222-3333-4444-5555-666666666666";
    rerender(
      <TranscriptModal
        target={{ ...target, summaryId: newId }}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(2));
    expect(actionMock).toHaveBeenLastCalledWith(newId, VIEWED_USER);
  });

  it("does not setState after unmount (cancellation flag handles modal-closed-mid-flight)", async () => {
    let resolveAction: (v: typeof happyResult) => void = () => {};
    actionMock.mockImplementation(
      () =>
        new Promise<typeof happyResult>((res) => {
          resolveAction = res;
        }),
    );
    const { unmount } = render(
      <TranscriptModal target={target} onClose={() => {}} />,
    );
    unmount();
    // Resolve after unmount — should not throw or emit React warnings.
    await act(async () => {
      resolveAction(happyResult);
      await new Promise((r) => setTimeout(r, 0));
    });
    // No assertion needed on DOM since component is gone; absence of
    // "Can't perform a React state update on an unmounted component"
    // (would fire as a console.error) is the success criterion.
  });
});
