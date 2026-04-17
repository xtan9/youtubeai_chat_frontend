import { afterEach, describe, it, expect, vi } from "vitest";
import { formatSseEvent, streamLlmSummary } from "../llm-client";

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
