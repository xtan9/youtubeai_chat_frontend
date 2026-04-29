// Test helpers shared by chat-related vitest suites:
//   - SSE stream / Response builders that exercise the real parser path
//   - Provider wrapper (QueryClientProvider + fake UserContext)
//   - Supabase-client mock for the auth-fallback branches in useChatStream
//
// Lives in `lib/test-utils/` (not test-adjacent) because the helpers cross
// directories: `lib/hooks/__tests__/` and `app/summary/components/__tests__/`
// both consume them.

import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { vi } from "vitest";
import type { ChatSseEvent } from "@/lib/api-contracts/chat";

// ---------------- React Query ----------------

/**
 * Default `retry: false` — suite tests assert error state on the first
 * failure and would otherwise wait through retry backoff.
 */
export function freshQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

// ---------------- UserContext (mocked) ----------------

// We `vi.mock("@/lib/contexts/user-context")` in the test file so that
// importing `useUser` returns this controllable fake instead of the real
// provider (which would need a Supabase env at module load).
export interface FakeUser {
  readonly session: Session | null;
}

export function fakeSession(accessToken = "test-access-token"): Session {
  return {
    access_token: accessToken,
    token_type: "bearer",
    refresh_token: "test-refresh",
    expires_in: 3600,
    expires_at: 9_999_999_999,
    user: {
      id: "user-1",
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00Z",
    },
  } as Session;
}

// ---------------- Provider wrapper ----------------

interface ChatProvidersProps {
  readonly children: ReactNode;
  readonly queryClient: QueryClient;
}

function ChatProviders({ children, queryClient }: ChatProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

interface RenderWithChatProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  readonly queryClient?: QueryClient;
}

/**
 * Render that wraps in QueryClientProvider only — UserContext is supplied
 * via `vi.mock` in the test file because mocking the module is cleaner
 * than threading a context provider through every hook test.
 */
export function renderWithChatProviders(
  ui: ReactNode,
  options: RenderWithChatProvidersOptions = {},
) {
  const { queryClient = freshQueryClient(), ...rest } = options;
  return {
    queryClient,
    ...render(ui, {
      wrapper: ({ children }) => (
        <ChatProviders queryClient={queryClient}>{children}</ChatProviders>
      ),
      ...rest,
    }),
  };
}

// ---------------- SSE stream / Response builders ----------------

/**
 * Encodes a list of validated `ChatSseEvent`s as a real SSE byte stream
 * (`data: {...}\n\n` per event). Exercises the production parser path
 * end-to-end including the `\n\n` framing.
 */
export function createSseStream(
  events: readonly ChatSseEvent[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
}

/**
 * Like `createSseStream` but lets a test inject malformed lines (e.g.
 * `"data: {not-json"`) to exercise the parser's warn-and-skip branch.
 */
export function createRawSseStream(
  rawLines: readonly string[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of rawLines) {
        controller.enqueue(encoder.encode(`${line}\n\n`));
      }
      controller.close();
    },
  });
}

export function sseResponse(events: readonly ChatSseEvent[]): Response {
  return new Response(createSseStream(events), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

export function rawSseResponse(rawLines: readonly string[]): Response {
  return new Response(createRawSseStream(rawLines), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/**
 * Hand-controlled SSE stream — the test pushes events one at a time and
 * asserts intermediate hook state between pushes. Used to verify delta
 * accumulation into `draft.assistant` and that streaming → completed
 * transitions surface in the right order.
 */
export interface ControlledSseStream {
  readonly response: Response;
  readonly emit: (event: ChatSseEvent) => void;
  readonly emitRaw: (line: string) => void;
  readonly close: () => void;
  readonly error: (reason: unknown) => void;
}

export function controlledSseResponse(): ControlledSseStream {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
    emit(event) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
    emitRaw(line) {
      controller.enqueue(encoder.encode(`${line}\n\n`));
    },
    close() {
      controller.close();
    },
    // Mirrors what real fetch does when an abort signal fires mid-stream:
    // the underlying reader rejects. Tests use this to drive the abort
    // path through the hook's catch block.
    error(reason) {
      controller.error(reason);
    },
  };
}

// ---------------- Supabase-client mock ----------------

interface MockSupabaseOptions {
  readonly session?: Session | null;
  readonly throws?: boolean;
}

/**
 * Returns a stub matching the slice of `@/lib/supabase/client` that
 * useChatStream calls: `createClient().auth.getSession()`. Tests pass
 * the result into `vi.mock("@/lib/supabase/client", ...)` factories.
 */
export function mockSupabaseClient(options: MockSupabaseOptions = {}) {
  const { session = null, throws = false } = options;
  return {
    auth: {
      getSession: vi.fn().mockImplementation(async () => {
        if (throws) throw new Error("getSession bombed");
        return { data: { session }, error: null };
      }),
    },
  };
}
