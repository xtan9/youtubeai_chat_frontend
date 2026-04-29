// @vitest-environment happy-dom
//
// Integration test for the chat-tab orchestrator. Wires up the real
// `useChatThread` + `useChatStream` hooks against a stubbed `fetch` so the
// query invalidation → re-fetch handoff is exercised end-to-end. The hook
// implementations are unit-tested in `lib/hooks/__tests__/`; this suite
// only verifies their composition inside `ChatTab`.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useUser } from "@/lib/contexts/user-context";
import { createClient } from "@/lib/supabase/client";
import { ChatTab } from "../chat-tab";
import {
  controlledSseResponse,
  fakeSession,
  freshQueryClient,
  renderWithChatProviders,
  sseResponse,
} from "@/tests-utils/chat-test-helpers";
import { axe } from "@/tests-utils/axe";

vi.mock("@/lib/contexts/user-context", () => ({
  useUser: vi.fn(() => ({
    user: null,
    session: null,
    isLoading: false,
    error: null,
  })),
}));

// Mock sonner so the clear-button test can assert on the toast options
// without mounting a `<Toaster />` in the test wrapper.
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

const supabaseAuthMock = {
  getSession: vi.fn().mockResolvedValue({
    data: { session: null },
    error: null,
  }),
};
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({ auth: supabaseAuthMock })),
}));

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

interface RouteHandlers {
  readonly onMessages?: (input: RequestInit | undefined) => Response;
  readonly onStream?: (input: RequestInit | undefined) => Response;
}

function makeRouter(
  handlers: RouteHandlers,
): Mock<(...args: Parameters<typeof fetch>) => Promise<Response>> {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/chat/stream")) {
      if (!handlers.onStream) {
        throw new Error(`Unexpected /api/chat/stream call (method=${method})`);
      }
      return handlers.onStream(init);
    }
    if (url.includes("/api/chat/messages")) {
      if (!handlers.onMessages) {
        throw new Error(`Unexpected /api/chat/messages call (method=${method})`);
      }
      return handlers.onMessages(init);
    }
    throw new Error(`Unexpected fetch in chat-tab test: ${url}`);
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  (useUser as unknown as Mock).mockReturnValue({
    user: null,
    session: fakeSession("live-token"),
    isLoading: false,
    error: null,
  });
  supabaseAuthMock.getSession.mockReset();
  supabaseAuthMock.getSession.mockResolvedValue({
    data: { session: null },
    error: null,
  });
  vi.mocked(createClient).mockReturnValue(
    { auth: supabaseAuthMock } as unknown as ReturnType<typeof createClient>,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatTab", () => {
  it("renders the empty state with suggestion buttons when the thread is empty", async () => {
    const fetchMock = makeRouter({
      onMessages: () => jsonResponse({ messages: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithChatProviders(<ChatTab youtubeUrl={VALID_URL} active={true} />);

    await waitFor(() =>
      expect(
        screen.getByText(/ask anything about this video/i),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole("button", { name: /summarize the key takeaways/i }),
    ).toBeTruthy();
    expect(screen.queryByTestId("chat-message-list")).toBeNull();
  });

  it("renders persisted messages when the thread fetch returns rows", async () => {
    const fetchMock = makeRouter({
      onMessages: () =>
        jsonResponse({
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
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithChatProviders(<ChatTab youtubeUrl={VALID_URL} active={true} />);

    // The thread fetch is async — wait for the bubbles themselves rather
    // than only the list container (which mounts during isLoading=true
    // before the first row arrives).
    await waitFor(() =>
      expect(screen.getByText("what's this about")).toBeTruthy(),
    );
    expect(screen.getByText("this video covers x")).toBeTruthy();

    // ClearButton enabled because persisted history is non-empty.
    const clearBtn = screen.getByRole("button", { name: /clear chat history/i });
    expect((clearBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("end-to-end: send a message → draft streams in → done → cache invalidates → persisted row replaces draft", async () => {
    // Streamed delta text and persisted assistant text deliberately
    // differ so the assertion proves the cache invalidation actually
    // replaced the draft with the canonical row — not just that some
    // bubble with the right text happened to remain on screen.
    const STREAMED_TEXT = "Hello"; // what the SSE delta emits
    const PERSISTED_TEXT = "Hello there, friend!"; // what the route returns
    let streamCompleted = false;
    const persisted = [
      {
        id: "m-user",
        role: "user" as const,
        content: "what is this about?",
        createdAt: "2026-04-28T00:00:00Z",
      },
      {
        id: "m-asst",
        role: "assistant" as const,
        content: PERSISTED_TEXT,
        createdAt: "2026-04-28T00:00:01Z",
      },
    ];
    const controlled = controlledSseResponse();
    const fetchMock = makeRouter({
      onMessages: (init) => {
        // Route on the explicit "stream completed" signal — not raw call
        // count — so a future react-query refetch policy change (e.g.
        // background refetch on window focus) cannot silently flip the
        // test into the persisted branch early.
        if ((init?.method ?? "GET").toUpperCase() === "GET" && streamCompleted) {
          return jsonResponse({ messages: persisted });
        }
        return jsonResponse({ messages: [] });
      },
      onStream: () => controlled.response,
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithChatProviders(<ChatTab youtubeUrl={VALID_URL} active={true} />);

    await waitFor(() =>
      expect(
        screen.getByText(/ask anything about this video/i),
      ).toBeTruthy(),
    );

    const input = screen.getByLabelText(/chat message/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "what is this about?" } });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    // The list switches in once the draft exists, replacing the empty
    // state. Wait for the draft user bubble specifically.
    await waitFor(() =>
      expect(screen.getByText("what is this about?")).toBeTruthy(),
    );

    act(() => controlled.emit({ type: "delta", text: STREAMED_TEXT }));
    await waitFor(() => expect(screen.getByText(STREAMED_TEXT)).toBeTruthy());

    streamCompleted = true;
    act(() => {
      controlled.emit({ type: "done" });
      controlled.close();
    });

    // After done, useChatStream invalidates the thread query → second
    // /api/chat/messages GET returns the canonical pair → draft is
    // cleared and the persisted assistant text (different from the
    // streamed delta) appears.
    await waitFor(() => expect(screen.getByText(PERSISTED_TEXT)).toBeTruthy());
    expect(screen.queryByText(STREAMED_TEXT)).toBeNull();
  });

  it("renders an alert banner when the thread fetch errors", async () => {
    const fetchMock = makeRouter({
      onMessages: () =>
        jsonResponse({ message: "you are not allowed" }, 403),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithChatProviders(<ChatTab youtubeUrl={VALID_URL} active={true} />);

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(alerts.some((el) => /you are not allowed/i.test(el.textContent ?? ""))).toBe(true);
    });
  });

  it("renders an alert banner when the stream surfaces an SSE error event", async () => {
    const fetchMock = makeRouter({
      onMessages: () => jsonResponse({ messages: [] }),
      onStream: () =>
        sseResponse([
          { type: "delta", text: "starting" },
          { type: "error", message: "model is unhappy" },
        ]),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithChatProviders(<ChatTab youtubeUrl={VALID_URL} active={true} />);

    // Send a message to trigger the stream.
    await waitFor(() =>
      expect(
        screen.getByText(/ask anything about this video/i),
      ).toBeTruthy(),
    );
    const input = screen.getByLabelText(/chat message/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(alerts.some((el) => /model is unhappy/i.test(el.textContent ?? ""))).toBe(true);
    });
  });

  it("clearing during a stream aborts the stream, optimistically empties the list, and shows the undo toast", async () => {
    const controlled = controlledSseResponse();
    const fetchMock = makeRouter({
      onMessages: () => jsonResponse({ messages: [] }),
      onStream: () => controlled.response,
    });
    vi.stubGlobal("fetch", fetchMock);
    // Sonner is mocked at module level in this file so we can capture
    // the toast call without mounting a Toaster — the optimistic clear
    // + abort happen synchronously, the DELETE is deferred to the
    // toast's onAutoClose (verified in chat-clear-button.test.tsx).
    toastSuccessMock.mockClear();

    renderWithChatProviders(<ChatTab youtubeUrl={VALID_URL} active={true} />);

    await waitFor(() =>
      expect(
        screen.getByText(/ask anything about this video/i),
      ).toBeTruthy(),
    );

    fireEvent.change(screen.getByLabelText(/chat message/i), {
      target: { value: "anything" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /stop generating/i })).toBeTruthy(),
    );

    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /clear chat history/i }),
      );
      // Mirror what production fetch does on abort.
      controlled.error(new DOMException("aborted", "AbortError"));
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /stop generating/i }),
      ).toBeNull(),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Chat cleared",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );
  });

  it("locks the message input while the clear-button is in its 5s undo window", async () => {
    const fetchMock = makeRouter({
      onMessages: () =>
        jsonResponse({
          messages: [
            {
              id: "m1",
              role: "user",
              content: "what's this about",
              createdAt: "2026-04-28T00:00:00Z",
            },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    toastSuccessMock.mockClear();

    renderWithChatProviders(<ChatTab youtubeUrl={VALID_URL} active={true} />);
    await waitFor(() =>
      expect(screen.getByText("what's this about")).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /clear chat history/i }),
    );
    // After click: optimistic clear + toast pending. The input must be
    // disabled now so a message sent during the window doesn't get
    // wiped by the deferred DELETE.
    const input = screen.getByLabelText(/chat message/i) as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    // Send button is also disabled.
    expect(
      (screen.getByRole("button", { name: /send message/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("has no axe a11y violations on the empty-state orchestrator", async () => {
    const fetchMock = makeRouter({
      onMessages: () => jsonResponse({ messages: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = renderWithChatProviders(
      <ChatTab youtubeUrl={VALID_URL} active={true} />,
      { queryClient: freshQueryClient() },
    );

    await waitFor(() =>
      expect(
        screen.getByText(/ask anything about this video/i),
      ).toBeTruthy(),
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
