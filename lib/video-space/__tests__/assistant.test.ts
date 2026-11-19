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
function answer(index: number, quote: string) {
  stream.mockReturnValue([
    {
      type: "delta",
      text: JSON.stringify({
        summary: "Generated summary",
        claims: [{ text: "The trial had no clear result.", index, quote }],
      }),
    },
  ]);
  return summarize(resource, new AbortController().signal);
}

it("keeps a saved summary and anchors new claims to the quoted transcript passage", async () => {
  const result = await answer(1, "was inconclusive");
  expect(result.summary).toBe(resource.digest!.summary);
  expect(result.claims[0]).toMatchObject({
    quote: "was inconclusive",
    location: "02:06",
    seconds: 126,
  });
});

it.each([
  [0, "was inconclusive"],
  [1, "improved survival"],
  [2, "There were two groups."],
])(
  "rejects a claim without a verbatim quote on the specified page",
  async (index, quote) => {
    await expect(answer(index, quote)).rejects.toThrow(
      "Untraceable source quotation",
    );
  },
);
