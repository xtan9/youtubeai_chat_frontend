// Test helpers shared by chat-related vitest suites:
//   - SSE stream / Response builders that exercise the real parser path
//   - QueryClientProvider wrapper for component renders
//
// UserContext and the Supabase browser client are mocked inline in each
// test file (via `vi.mock(...)` at module load) — the slice of those
// modules under test is small enough that a shared mock helper would add
// ceremony without saving lines.

import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
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

// ---------------- Session fixture ----------------

/**
 * Minimal session object for the `useUser` mock. `satisfies Session` (not
 * `as Session`) so a future SDK upgrade that adds a required field fails
 * the build here instead of silently shipping a partially-valid fixture.
 */
export function fakeSession(accessToken = "test-access-token") {
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
  } satisfies Session;
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
 * Hand-controlled SSE stream — tests push events one at a time and assert
 * intermediate hook state between pushes. The split between `emit` (typed
 * to `ChatSseEvent`) and `emitRaw` (arbitrary string) and `enqueueRaw`
 * (arbitrary bytes, no `\n\n` framing) is deliberate: typed happy path,
 * explicit escape hatches for malformed-input and chunk-boundary tests.
 */
export interface ControlledSseStream {
  readonly response: Response;
  readonly emit: (event: ChatSseEvent) => void;
  readonly emitRaw: (line: string) => void;
  readonly enqueueRaw: (bytes: string) => void;
  readonly close: () => void;
  readonly error: (reason: Error | DOMException) => void;
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
    // No `\n\n` framing appended — used to verify the hook's buffer
    // carry-over splits a single SSE frame across two enqueues.
    enqueueRaw(bytes) {
      controller.enqueue(encoder.encode(bytes));
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
