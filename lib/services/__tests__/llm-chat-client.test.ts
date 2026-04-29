import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

function mkSseStream(lines: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function loadFresh() {
  vi.resetModules();
  return await import("../llm-chat-client");
}

describe("streamChatCompletion", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("LLM_GATEWAY_URL", "https://gateway.test");
    vi.stubEnv("LLM_GATEWAY_API_KEY", "test-key");
    vi.stubEnv("LLM_MODEL", "claude-sonnet-4-6");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("yields delta events for non-empty content chunks then done", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        mkSseStream([
          sse({ choices: [{ delta: { content: "Hel" } }] }),
          sse({ choices: [{ delta: { content: "lo" } }] }),
          sse({ choices: [{ delta: {} }] }),
          "data: [DONE]\n\n",
        ]),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const { streamChatCompletion } = await loadFresh();
    const events = [];
    for await (const evt of streamChatCompletion({ messages: [{ role: "user", content: "hi" }] })) {
      events.push(evt);
    }
    expect(events).toEqual([
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
      { type: "done" },
    ]);
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 }))
    );
    const { streamChatCompletion } = await loadFresh();
    await expect(async () => {
      for await (const _ of streamChatCompletion({ messages: [{ role: "user", content: "hi" }] })) {
        void _;
      }
    }).rejects.toThrow(/gateway 500/);
  });

  it("throws when env is missing", async () => {
    vi.stubEnv("LLM_GATEWAY_URL", "");
    const { streamChatCompletion } = await loadFresh();
    await expect(async () => {
      for await (const _ of streamChatCompletion({ messages: [{ role: "user", content: "hi" }] })) {
        void _;
      }
    }).rejects.toThrow(/must be configured/);
  });

  it("re-throws non-TypeError errors from reader.releaseLock instead of swallowing them", async () => {
    // releaseLock's spec'd failures are TypeError (already released /
    // pending read) — those are recoverable. Anything else is a real
    // bug and must surface; the previous catch-all swallowed it.
    const customError = new RangeError("synthetic releaseLock bug");
    const stream = mkSseStream([
      sse({ choices: [{ delta: { content: "ok" } }] }),
      "data: [DONE]\n\n",
    ]);
    // Override the body reader's releaseLock to throw a non-TypeError.
    const realResponse = new Response(stream, { status: 200 });
    const body = realResponse.body!;
    const realGetReader = body.getReader.bind(body);
    body.getReader = (() => {
      const reader = realGetReader();
      reader.releaseLock = () => {
        throw customError;
      };
      return reader;
    }) as typeof body.getReader;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(realResponse));
    const { streamChatCompletion } = await loadFresh();
    await expect(async () => {
      for await (const _ of streamChatCompletion({
        messages: [{ role: "user", content: "hi" }],
      })) {
        void _;
      }
    }).rejects.toBe(customError);
  });

  it("swallows TypeError from reader.releaseLock (upstream cancel raced)", async () => {
    const stream = mkSseStream([
      sse({ choices: [{ delta: { content: "ok" } }] }),
      "data: [DONE]\n\n",
    ]);
    const realResponse = new Response(stream, { status: 200 });
    const body = realResponse.body!;
    const realGetReader = body.getReader.bind(body);
    body.getReader = (() => {
      const reader = realGetReader();
      reader.releaseLock = () => {
        throw new TypeError("reader released");
      };
      return reader;
    }) as typeof body.getReader;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(realResponse));
    const { streamChatCompletion } = await loadFresh();
    const events = [];
    for await (const evt of streamChatCompletion({
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(evt);
    }
    expect(events).toEqual([
      { type: "delta", text: "ok" },
      { type: "done" },
    ]);
  });

  it("ignores malformed JSON chunks (logs once) and continues", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          mkSseStream([
            "data: not-json\n\n",
            sse({ choices: [{ delta: { content: "ok" } }] }),
            "data: [DONE]\n\n",
          ]),
          { status: 200 }
        )
      )
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { streamChatCompletion } = await loadFresh();
    const events = [];
    for await (const evt of streamChatCompletion({ messages: [{ role: "user", content: "hi" }] })) {
      events.push(evt);
    }
    expect(events).toEqual([
      { type: "delta", text: "ok" },
      { type: "done" },
    ]);
    expect(warnSpy).toHaveBeenCalled();
  });
});
