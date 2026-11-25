import { expect, it, vi } from "vitest";
import { emptySpace, type Resource } from "../contract";

vi.mock("server-only", () => ({}));
const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("@/lib/services/llm-chat-client", () => ({
  streamChatCompletion: stream,
}));
import { createStarter, discussClaim, interviewAuthor, interviewContext, summarize, writeScript } from "../assistant";

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

it("answers a claim discussion from the supplied passage, finding and prior conversation", async () => {
  stream.mockReturnValue([
    {
      type: "delta",
      text: JSON.stringify({ reply: "The outcome measured was cholesterol." }),
    },
  ]);
  const request = {
    action: "discussClaim" as const,
    claim: "Compare trial outcomes",
    question: "Which outcome?",
    origin: "The trial measured serum cholesterol.",
    finding: "There were two comparison groups.",
    history: [{ question: "Which trial?", reply: "The controlled trial." }],
  };
  const reply = await discussClaim(request, new AbortController().signal);
  expect(reply.reply).toBe("The outcome measured was cholesterol.");
  expect(stream.mock.lastCall?.[0].messages[0].content).toContain(
    JSON.stringify(request),
  );
});

it("asks on format selection even if the model prematurely offers a brief", async () => {
  const space = emptySpace();
  const id = crypto.randomUUID();
  space.interview = { id, turnId: crypto.randomUUID(), pending: true, notes: "", format: "video" };
  space.messages = [
    { role: "user", text: "A separate draft" },
    { role: "user", interviewId: id, text: "YouTube" },
  ];
  space.resources = [resource];
  const context = interviewContext("New project", space, []);
  expect(context.turns).toEqual([{ role: "user", text: "YouTube" }]);
  expect(context.materials[0].excerpt).toBe(resource.pages[0].text);
  const ask = { stage: "ask", format: "video", notes: "Video selected", reply: "Who should see this?", quickReplies: [] };
  const delta = (reply: object) => [{ type: "delta", text: JSON.stringify(reply) }];
  stream.mockReturnValueOnce(delta({ stage: "review", format: "video", brief: "A generic script." }))
    .mockReturnValueOnce(delta({ ...ask, prompts: [{question: "Who should see this?", recommendation: "First-time cooks."}] }));
  expect(await interviewAuthor(context, "en", new AbortController().signal)).toEqual({ ...ask, reply: "Who should see this? First-time cooks." });
});

it("repairs the specific missing manuscript field and keeps the approved format", async () => {
  const space = emptySpace();
  space.interview = { id: crypto.randomUUID(), turnId: crypto.randomUUID(), pending: false, notes: "", format: "blog" };
  const draft = { title: "Two oil labels", lead: "I turned the bottles around.", sections: [{ heading: "Plant names", body: "Compare the ingredients." }], reply: "Draft ready." };
  const delta = (data: unknown) => [{ type: "delta", text: JSON.stringify(data) }];
  stream.mockReturnValueOnce(delta({ ...draft, sections: [{ heading: "Plant names" }] }))
    .mockReturnValueOnce(delta(draft));
  const result = await createStarter(interviewContext("Labels", space, []), "Compare the two plants.", "en", new AbortController().signal);
  expect(result).toEqual({ ...draft, format: "blog" });
  expect(stream.mock.lastCall![0].messages[0].content).toContain("sections.0.body");
});

it("allows a clear video direction to go straight to an outline and ends clarification after one round", async () => {
  const space = emptySpace(), id = crypto.randomUUID();
  space.interview = { id, turnId: crypto.randomUUID(), pending: true, notes: "", format: "video" };
  space.messages = [{ role: "user", interviewId: id, text: "Trace the original railway map on camera." }];
  const outline = { stage: "outline", format: "video", title: "Tracing the railway map", angle: "Trace the first edition.",
    sections: [{ heading: "Find the first map", questions: [{title: "Which archive holds the first edition?", startingPoint: "Check the library catalogue."}] }] };
  const delta = (value: unknown) => [{ type: "delta", text: JSON.stringify(value) }];
  stream.mockReturnValue(delta(outline));
  const plan = () => interviewAuthor(interviewContext("Railways", space, []), "en", new AbortController().signal);
  expect(await plan()).toEqual(outline);
  space.messages.push({ role: "assistant", interviewId: id, text: "Which angle?" },
    { role: "user", interviewId: id, text: "Your recommendation." });
  stream.mockReturnValueOnce(delta({ stage: "ask", format: "video", notes: "", reply: "Anything else?" }))
    .mockReturnValueOnce(delta(outline));
  expect(await plan()).toEqual(outline);
});

it("anchors an outline's verified finding to the exact sentence in the editable script", async () => {
  const space = emptySpace(), id = crypto.randomUUID(), finding = crypto.randomUUID();
  space.interview = { id, turnId: crypto.randomUUID(), pending: false, notes: "", format: "video" };
  space.resources = [resource];
  const context = interviewContext("The map", space, []);
  context.outline = { title: "The map", angle: "Read the label", sections: [{ heading: "Date", questions: [] }] };
  context.research = [{ id: finding, question: "When?", finding: "1902", limits: [], sources: [{ title: "Map", quote: "Issued in 1902." }] }];
  const sentence = "The map dates to 1902.";
  const answer = {title: "Map", lead: "Look at the map.", sections: [{heading: "Date", body: sentence}], reply: "Ready.",
    citations: [{finding, text: sentence}, {materialId: resource.id, text: "Look at the map."}]};
  const delta = (data: unknown) => [{type: "delta", text: JSON.stringify(data)}];
  stream.mockReturnValueOnce(delta({...answer, citations: [{finding: crypto.randomUUID(), text: sentence}]}))
    .mockReturnValueOnce(delta(answer));
  const result = await createStarter(context, "Map", "en", new AbortController().signal, true);
  expect(result).toMatchObject({markers: [
    {start: "Look at the map.\n\n## Date\n".length, text: sentence, finding},
    {start: 0, material: {id: resource.id, location: "00:00", quote: resource.pages[0].text}},
  ]});
});
