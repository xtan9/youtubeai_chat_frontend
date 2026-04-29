// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ChatClearButton } from "../chat-clear-button";
import { chatThreadQueryKey } from "@/lib/hooks/useChatThread";
import type { ChatMessagesResponse } from "@/lib/api-contracts/chat";

// Capture sonner's toast.success / toast.error calls so the test can
// drive the toast's `action.onClick` and `onAutoClose` callbacks
// without mounting a `<Toaster />`.
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const SNAPSHOT: ChatMessagesResponse = {
  messages: [
    {
      id: "m1",
      role: "user",
      content: "what's this about",
      createdAt: "2026-04-28T00:00:00Z",
    },
    {
      id: "m2",
      role: "assistant",
      content: "this video covers x",
      createdAt: "2026-04-28T00:00:01Z",
    },
  ],
};

function freshClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface ToastOptions {
  readonly duration?: number;
  readonly action?: { readonly label: string; readonly onClick: () => void };
  readonly onAutoClose?: () => void;
}

function getLastToastOptions(): ToastOptions {
  const lastCall = toastSuccessMock.mock.calls.at(-1);
  return (lastCall?.[1] ?? {}) as ToastOptions;
}

describe("ChatClearButton", () => {
  it("optimistically empties the cache, calls onBeforeClear, and shows a 5s undo toast on click", () => {
    const client = freshClient();
    const queryKey = chatThreadQueryKey(VALID_URL);
    client.setQueryData(queryKey, SNAPSHOT);
    const onBeforeClear = vi.fn();

    render(
      <ChatClearButton youtubeUrl={VALID_URL} onBeforeClear={onBeforeClear} />,
      { wrapper: wrapper(client) },
    );

    fireEvent.click(
      screen.getByRole("button", { name: /clear chat history/i }),
    );

    expect(onBeforeClear).toHaveBeenCalledTimes(1);
    expect(client.getQueryData<ChatMessagesResponse>(queryKey)).toEqual({
      messages: [],
    });
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Chat cleared",
      expect.objectContaining({
        duration: 5000,
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );
  });

  it("restores the snapshot when the user clicks Undo, and skips the DELETE on subsequent autoClose", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = freshClient();
    const queryKey = chatThreadQueryKey(VALID_URL);
    client.setQueryData(queryKey, SNAPSHOT);

    render(<ChatClearButton youtubeUrl={VALID_URL} />, {
      wrapper: wrapper(client),
    });
    fireEvent.click(
      screen.getByRole("button", { name: /clear chat history/i }),
    );
    const opts = getLastToastOptions();

    // Simulate the user clicking the toast's Undo action.
    opts.action!.onClick();
    expect(client.getQueryData<ChatMessagesResponse>(queryKey)).toEqual(
      SNAPSHOT,
    );

    // The auto-close timer would still fire in production once the
    // toast finishes its 5s duration; sonner runs `onAutoClose` even
    // when the action was clicked, so we need to verify the undone
    // flag short-circuits the DELETE here.
    opts.onAutoClose!();
    expect(fetchMock).not.toHaveBeenCalled();
    // Snapshot should still be the original after the no-op autoClose.
    expect(client.getQueryData<ChatMessagesResponse>(queryKey)).toEqual(
      SNAPSHOT,
    );
  });

  it("fires DELETE /api/chat/messages when autoClose runs without an Undo click", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = freshClient();
    const queryKey = chatThreadQueryKey(VALID_URL);
    client.setQueryData(queryKey, SNAPSHOT);

    render(<ChatClearButton youtubeUrl={VALID_URL} />, {
      wrapper: wrapper(client),
    });
    fireEvent.click(
      screen.getByRole("button", { name: /clear chat history/i }),
    );
    const opts = getLastToastOptions();

    opts.onAutoClose!();
    // Allow the mutation's micro-task to run.
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect((url as string)).toContain("/api/chat/messages");
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("rolls back the optimistic clear and surfaces an error toast when the server DELETE rejects", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "boom" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = freshClient();
    const queryKey = chatThreadQueryKey(VALID_URL);
    client.setQueryData(queryKey, SNAPSHOT);

    render(<ChatClearButton youtubeUrl={VALID_URL} />, {
      wrapper: wrapper(client),
    });
    fireEvent.click(
      screen.getByRole("button", { name: /clear chat history/i }),
    );
    const opts = getLastToastOptions();
    opts.onAutoClose!();
    // Wait for fetch + mutation onError to settle.
    await new Promise((r) => setTimeout(r, 10));

    expect(client.getQueryData<ChatMessagesResponse>(queryKey)).toEqual(
      SNAPSHOT,
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      expect.stringMatching(/boom/),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[chat] clear failed",
      expect.objectContaining({ errorId: "CHAT_CLEAR_UI_FAILED" }),
    );
    errorSpy.mockRestore();
  });

  it("does nothing when youtubeUrl is null (defensive against early-render races)", () => {
    render(<ChatClearButton youtubeUrl={null} />, {
      wrapper: wrapper(freshClient()),
    });
    fireEvent.click(
      screen.getByRole("button", { name: /clear chat history/i }),
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("blocks a second click while the undo window is open (no second toast, no stacked DELETEs)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = freshClient();
    const queryKey = chatThreadQueryKey(VALID_URL);
    client.setQueryData(queryKey, SNAPSHOT);

    render(<ChatClearButton youtubeUrl={VALID_URL} />, {
      wrapper: wrapper(client),
    });
    const btn = screen.getByRole("button", { name: /clear chat history/i });
    fireEvent.click(btn);
    // Re-entry guard should fire on the second click — same toast,
    // no second snapshot capture, no second deferred DELETE.
    fireEvent.click(btn);
    fireEvent.click(btn);

    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    // Drive the (single) auto-close — only one DELETE should fire.
    const opts = getLastToastOptions();
    opts.onAutoClose!();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("notifies the parent via onPendingChange so the input can be locked during the undo window", async () => {
    const onPendingChange = vi.fn();
    const client = freshClient();
    client.setQueryData(chatThreadQueryKey(VALID_URL), SNAPSHOT);
    render(
      <ChatClearButton
        youtubeUrl={VALID_URL}
        onPendingChange={onPendingChange}
      />,
      { wrapper: wrapper(client) },
    );
    await waitFor(() =>
      expect(onPendingChange).toHaveBeenLastCalledWith(false),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /clear chat history/i }),
    );
    await waitFor(() =>
      expect(onPendingChange).toHaveBeenLastCalledWith(true),
    );
    const opts = getLastToastOptions();
    act(() => {
      opts.action!.onClick();
    });
    await waitFor(() =>
      expect(onPendingChange).toHaveBeenLastCalledWith(false),
    );
  });

  it("flushes the deferred DELETE when the component unmounts mid-undo-window", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = freshClient();
    client.setQueryData(chatThreadQueryKey(VALID_URL), SNAPSHOT);

    const view = render(<ChatClearButton youtubeUrl={VALID_URL} />, {
      wrapper: wrapper(client),
    });
    fireEvent.click(
      screen.getByRole("button", { name: /clear chat history/i }),
    );
    // Simulate an SPA navigation away from /summary mid-window.
    view.unmount();
    await new Promise((r) => setTimeout(r, 0));
    // Without the unmount flush, this DELETE would never fire and the
    // success toast would contradict the server state (still has every
    // message) on the user's next visit.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe("DELETE");
  });
});
