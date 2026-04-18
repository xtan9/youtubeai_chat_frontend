import { afterEach, describe, it, expect, vi } from "vitest";
import {
  DEFAULT_LLM_MODEL,
  formatSseEvent,
  streamLlmSummary,
} from "../llm-client";

describe("formatSseEvent", () => {
  it("formats an SSE event", () => {
    expect(formatSseEvent({ type: "content", text: "hi" })).toBe(
      'data: {"type":"content","text":"hi"}\n\n'
    );
  });
});

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, { status: 200 });
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("streamLlmSummary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function stubEnv() {
    vi.stubEnv("LLM_GATEWAY_URL", "https://gw.example.com/v1");
    vi.stubEnv("LLM_GATEWAY_API_KEY", "key");
    vi.stubEnv("LLM_MODEL", "test-model");
  }

  it("throws when required env vars are missing", async () => {
    vi.stubEnv("LLM_GATEWAY_URL", "");
    vi.stubEnv("LLM_GATEWAY_API_KEY", "");
    await expect(
      collect(streamLlmSummary({ prompt: "x", enableThinking: false }))
    ).rejects.toThrow(/LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY/);
  });

  it("uses DEFAULT_LLM_MODEL and logs LLM_MODEL_MISSING when env unset outside dev/test", async () => {
    vi.stubEnv("LLM_GATEWAY_URL", "https://gw.example.com/v1");
    vi.stubEnv("LLM_GATEWAY_API_KEY", "key");
    vi.stubEnv("LLM_MODEL", "");
    vi.stubEnv("NODE_ENV", "production");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
        "data: [DONE]\n",
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    await collect(streamLlmSummary({ prompt: "x", enableThinking: false }));

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.model).toBe(DEFAULT_LLM_MODEL);
    expect(errSpy).toHaveBeenCalledWith(
      "[llm-client] LLM_MODEL unset; using default",
      expect.objectContaining({
        errorId: "LLM_MODEL_MISSING",
        defaultModel: DEFAULT_LLM_MODEL,
      })
    );
  });

  it("does NOT log LLM_MODEL_MISSING in development", async () => {
    vi.stubEnv("LLM_GATEWAY_URL", "https://gw.example.com/v1");
    vi.stubEnv("LLM_GATEWAY_API_KEY", "key");
    vi.stubEnv("LLM_MODEL", "");
    vi.stubEnv("NODE_ENV", "development");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
          "data: [DONE]\n",
        ])
      )
    );

    await collect(streamLlmSummary({ prompt: "x", enableThinking: false }));
    expect(
      errSpy.mock.calls.some((c) => String(c[0]).includes("LLM_MODEL unset"))
    ).toBe(false);
  });

  it("logs LLM_MODEL_MISSING when NODE_ENV is unset (guards against misconfigured prod)", async () => {
    vi.stubEnv("LLM_GATEWAY_URL", "https://gw.example.com/v1");
    vi.stubEnv("LLM_GATEWAY_API_KEY", "key");
    vi.stubEnv("LLM_MODEL", "");
    vi.stubEnv("NODE_ENV", "");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
          "data: [DONE]\n",
        ])
      )
    );

    await collect(streamLlmSummary({ prompt: "x", enableThinking: false }));
    expect(
      errSpy.mock.calls.some((c) => String(c[0]).includes("LLM_MODEL unset"))
    ).toBe(true);
  });

  it.each<[string, string]>([
    ["leading/trailing spaces", "  value  "],
    ["trailing newline", "value\n"],
    ["leading tab", "\tvalue"],
    ["CRLF", "value\r\n"],
    ["trailing CR", "value\r"],
    ["mixed", " \tvalue\r\n "],
  ])("trims %s from env-var values", async (_label, wrap) => {
    vi.stubEnv("LLM_GATEWAY_URL", wrap.replace("value", "https://gw.example.com/v1"));
    vi.stubEnv("LLM_GATEWAY_API_KEY", wrap.replace("value", "key"));
    vi.stubEnv("LLM_MODEL", wrap.replace("value", "test-model"));
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
        "data: [DONE]\n",
      ])
    );
    vi.stubGlobal("fetch", fetchMock);
    await collect(streamLlmSummary({ prompt: "x", enableThinking: false }));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://gw.example.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer key"
    );
    const body = JSON.parse(init.body as string) as { model: string };
    expect(body.model).toBe("test-model");
  });

  it("preserves internal whitespace in env-var values (only edges are trimmed)", async () => {
    // `.trim()` only touches edges — guards against a future refactor that
    // "helpfully" swaps to `.replace(/\s/g, "")` and mangles keys that
    // legitimately contain internal whitespace (rare but possible for
    // some bearer formats or URLs with %20).
    vi.stubEnv("LLM_GATEWAY_URL", "https://gw.example.com/v1");
    vi.stubEnv("LLM_GATEWAY_API_KEY", "key with spaces");
    vi.stubEnv("LLM_MODEL", "my-model");
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
        "data: [DONE]\n",
      ])
    );
    vi.stubGlobal("fetch", fetchMock);
    await collect(streamLlmSummary({ prompt: "x", enableThinking: false }));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer key with spaces"
    );
  });

  it("treats whitespace-only LLM_MODEL as unset (falls back to DEFAULT + fires LLM_MODEL_MISSING)", async () => {
    vi.stubEnv("LLM_GATEWAY_URL", "https://gw.example.com/v1");
    vi.stubEnv("LLM_GATEWAY_API_KEY", "key");
    vi.stubEnv("LLM_MODEL", "  \n\t  ");
    vi.stubEnv("NODE_ENV", "production");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
        "data: [DONE]\n",
      ])
    );
    vi.stubGlobal("fetch", fetchMock);
    await collect(streamLlmSummary({ prompt: "x", enableThinking: false }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      model: string;
    };
    expect(body.model).toBe(DEFAULT_LLM_MODEL);
    expect(errSpy).toHaveBeenCalledWith(
      "[llm-client] LLM_MODEL unset; using default",
      expect.objectContaining({ errorId: "LLM_MODEL_MISSING" })
    );
  });

  it("treats whitespace-only LLM_GATEWAY_URL as unset (throws 'must be configured')", async () => {
    vi.stubEnv("LLM_GATEWAY_URL", "  \n  ");
    vi.stubEnv("LLM_GATEWAY_API_KEY", "key");
    await expect(
      collect(streamLlmSummary({ prompt: "x", enableThinking: false }))
    ).rejects.toThrow(/LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY/);
  });

  it("throws with status + body on non-ok response", async () => {
    stubEnv();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("upstream boom", { status: 502 }))
    );
    await expect(
      collect(streamLlmSummary({ prompt: "x", enableThinking: false }))
    ).rejects.toThrow(/LLM gateway error \(502\): upstream boom/);
  });

  it("yields status, content, and timing for a simple stream", async () => {
    stubEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"hello "}}]}\n',
          'data: {"choices":[{"delta":{"content":"world"}}]}\n',
          "data: [DONE]\n",
        ])
      )
    );
    const events = await collect(
      streamLlmSummary({ prompt: "x", enableThinking: false })
    );
    expect(events[0]).toEqual({
      type: "status",
      message: "Generating summary...",
      stage: "summarize",
    });
    expect(events.filter((e) => e.type === "content")).toEqual([
      { type: "content", text: "hello " },
      { type: "content", text: "world" },
    ]);
    const timing = events.at(-1)!;
    expect(timing.type).toBe("timing");
  });

  it("handles chunks split mid-line", async () => {
    stubEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"content":"hel',
          'lo"}}]}\n',
        ])
      )
    );
    const events = await collect(
      streamLlmSummary({ prompt: "x", enableThinking: false })
    );
    expect(events.filter((e) => e.type === "content")).toEqual([
      { type: "content", text: "hello" },
    ]);
  });

  it("only yields reasoning when enableThinking is true", async () => {
    stubEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"reasoning_content":"deep"}}]}\n',
          'data: {"choices":[{"delta":{"content":"result"}}]}\n',
          "data: [DONE]\n",
        ])
      )
    );
    const noThink = await collect(
      streamLlmSummary({ prompt: "x", enableThinking: false })
    );
    expect(noThink.some((e) => e.type === "thinking")).toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"choices":[{"delta":{"reasoning_content":"deep"}}]}\n',
          'data: {"choices":[{"delta":{"content":"result"}}]}\n',
          "data: [DONE]\n",
        ])
      )
    );
    const withThink = await collect(
      streamLlmSummary({ prompt: "x", enableThinking: true })
    );
    expect(withThink.some((e) => e.type === "thinking")).toBe(true);
  });

  it("throws when stream closes without producing content", async () => {
    stubEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sseResponse(["data: [DONE]\n"]))
    );
    await expect(
      collect(streamLlmSummary({ prompt: "x", enableThinking: false }))
    ).rejects.toThrow(/without producing content/);
  });

  it("throws a distinct error when gateway only emits malformed chunks", async () => {
    stubEnv();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse(["data: not-json\n", "data: also-not-json\n"])
      )
    );
    await expect(
      collect(streamLlmSummary({ prompt: "x", enableThinking: false }))
    ).rejects.toThrow(/malformed SSE chunks/);
  });

  it("succeeds with mixed malformed+valid chunks and logs final malformed count", async () => {
    // Realistic gateway glitch: a few chunks are dropped but content still
    // flows. Must NOT throw, must deliver the good content, AND must log a
    // final summary line so on-call can alert on malformed ratios even when
    // the user-facing path succeeds.
    stubEnv();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          "data: not-json\n",
          'data: {"choices":[{"delta":{"content":"hello "}}]}\n',
          "data: also-not-json\n",
          'data: {"choices":[{"delta":{"content":"world"}}]}\n',
          "data: [DONE]\n",
        ])
      )
    );

    const events = await collect(
      streamLlmSummary({ prompt: "x", enableThinking: false })
    );

    const contents = events
      .filter((e) => e.type === "content")
      .map((e) => (e as { text: string }).text)
      .join("");
    expect(contents).toBe("hello world");

    const finalLog = errSpy.mock.calls.find((c) =>
      String(c[0]).includes("stream completed with malformed chunks")
    );
    expect(finalLog).toBeDefined();
    expect(finalLog?.[1]).toMatchObject({
      errorId: "LLM_MALFORMED_CHUNKS",
      malformedChunks: 2,
      contentReceived: true,
    });
  });

  it("forwards caller's AbortSignal to fetch", async () => {
    stubEnv();
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
        "data: [DONE]\n",
      ])
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await collect(
      streamLlmSummary({
        prompt: "x",
        enableThinking: false,
        signal: controller.signal,
      })
    );
    const passedSignal = fetchMock.mock.calls[0][1]?.signal;
    expect(passedSignal).toBe(controller.signal);
  });

  it("attaches original error as cause on mid-stream wrap", async () => {
    stubEnv();
    const encoder = new TextEncoder();
    const originalErr = new Error("TCP reset");
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls === 0) {
          pulls++;
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":"hi"}}]}\n'
            )
          );
        } else {
          controller.error(originalErr);
        }
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 }))
    );
    let caught: unknown;
    try {
      await collect(streamLlmSummary({ prompt: "x", enableThinking: false }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).cause).toBe(originalErr);
  });

  it("wraps mid-stream reader failure with partial-content context", async () => {
    stubEnv();
    const encoder = new TextEncoder();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls === 0) {
          pulls++;
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":"hi"}}]}\n'
            )
          );
        } else {
          controller.error(new Error("TCP reset"));
        }
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 }))
    );
    await expect(
      collect(streamLlmSummary({ prompt: "x", enableThinking: false }))
    ).rejects.toThrow(/dropped after partial content/);
  });
});
