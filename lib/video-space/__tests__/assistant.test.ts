import { expect, it, vi } from "vitest";
import type { Resource } from "../contract";

vi.mock("server-only", () => ({}));
const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("@/lib/services/llm-chat-client", () => ({
  streamChatCompletion: stream,
}));
import { summarize, writeScript } from "../assistant";

const resource: Resource = {
  id: "video",
  kind: "video",
  title: "A comparison",
  coverage: "Transcript excerpts",
  digest: { summary: "Previously saved summary", claims: [] },
  pages: [
    { label: "00:00", seconds: 0, text: "There were two groups." },
    { label: "02:06", seconds: 126, text: "The result was inconclusive." },
  ],
};
function answer(excerptId: number, source = resource) {
  stream.mockReturnValue([
    {
      type: "delta",
      text: JSON.stringify({
        summary: "Generated summary",
        claims: [{ text: "The trial had no clear result.", excerptId }],
      }),
    },
  ]);
  return summarize(source, new AbortController().signal);
}
it("uses the server-issued excerpt and preserves its timestamp and cached summary", async () => {
  const result = await answer(1);
  expect(result.summary).toBe(resource.digest!.summary);
  expect(result.claims[0]).toMatchObject({
    quote: resource.pages[1].text,
    location: "02:06",
    seconds: 126,
  });
});
it("attaches an exact passage within a long PDF page at the original page number", async () => {
  const text = "Word ".repeat(70) + "The result was inconclusive.";
  const result = await answer(1, {
    ...resource,
    kind: "pdf",
    digest: undefined,
    pages: [{ label: "Page 8", text }],
  });
  expect(result.summary).toBe("Generated summary");
  const claim = result.claims[0];
  expect(claim.location).toBe("Page 8");
  expect(text).toContain(claim.quote);
  expect(claim.quote).toContain("inconclusive.");
});
it("rejects a selector outside the supplied source", async () => {
  await expect(answer(2)).rejects.toThrow("unknown_source_excerpt");
});

it("repairs an invalid co-writing turn within one request and keeps an explicit edit scoped", async () => {
  const reply = {
    mode: "edit",
    target: "append",
    reply: "已续写。",
    options: ["先看比较对象。"],
    usedFinding: true,
  };
  stream
    .mockReturnValueOnce([{ type: "delta", text: "已续写。" }])
    .mockReturnValueOnce([{ type: "delta", text: JSON.stringify(reply) }]);
  const result = await writeScript(
    {
      action: "write",
      script: "开场",
      appendOnly: true,
      prompt: "续写一句",
      history: [],
    },
    new AbortController().signal,
  );
  expect(result).toEqual(reply);
  const invocation = stream.mock.lastCall![0];
  expect(invocation.messages).toHaveLength(1);
  expect(invocation.messages[0].content).toContain("续写一句");
  expect(invocation.messages[0].content).toContain("could not be validated");
});
