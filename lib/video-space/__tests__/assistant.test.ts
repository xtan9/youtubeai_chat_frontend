import { expect, it, vi } from "vitest";
import type { Resource } from "../contract";

vi.mock("server-only", () => ({}));
const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("@/lib/services/llm-chat-client", () => ({
  streamChatCompletion: stream,
}));
import { summarize } from "../assistant";

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
