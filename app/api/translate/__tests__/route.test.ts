import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  user: { id: "learner-1", is_anonymous: false } as { id: string; is_anonymous: boolean } | null,
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  rateCount: 1,
  databaseError: false,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => ({
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        is(key: string, value: unknown) { filters.push([key, value]); return query; },
        async maybeSingle() {
          return {
            data: (state.rows[table] ?? []).find(row => filters.every(([key, value]) => row[key] === value)) ?? null,
            error: state.databaseError ? { code: "08006" } : null,
          };
        },
      };
      return query;
    },
    rpc: async () => ({ data: state.rateCount, error: null }),
  }),
}));

import { POST } from "../route";

const markdown = "## Practical decisions\n\nDeng Xiaoping, a **pragmatist**, focused on economic results.";
const requestBody = {
  youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  outputLanguage: null,
  targetLanguage: "zh",
  blockStart: markdown.indexOf("Deng"),
  selectionStart: 17,
  text: "pragmatist",
  context: "Deng Xiaoping, a pragmatist, focused on economic results.",
  heading: "Practical decisions",
};
function request(patch: Record<string, unknown> = {}) {
  return new Request("https://youtubeai.chat/api/translate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...requestBody, ...patch }),
  });
}
const gateway = vi.fn();
beforeEach(() => {
  state.user = { id: "learner-1", is_anonymous: false };
  state.databaseError = false;
  state.rateCount = 1;
  state.rows = {
    user_subscriptions: [{ user_id: "learner-1", tier: "free", status: null }],
    videos: [{ id: "video-1", youtube_video_id: "dQw4w9WgXcQ" }],
    user_video_history: [{ video_id: "video-1", user_id: "learner-1" }],
    summaries: [{ video_id: "video-1", output_language: null, summary: markdown }],
  };
  gateway.mockReset();
  gateway.mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
    translation: "务实派", explanation: "这里指重视实际经济成果的人。", partOfSpeech: "noun", sameLanguage: false,
  }) } }] }));
  vi.stubGlobal("fetch", gateway);
  vi.stubEnv("LLM_GATEWAY_URL", "https://gateway.example");
  vi.stubEnv("LLM_GATEWAY_API_KEY", "test-key");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("POST /api/translate", () => {
  it.each(["#", "##", "###", "####", "#####", "######"])("translates a word from an authorized Summary heading: %s", async prefix => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: "pro", status: "active" };
    const source = "# Previous section\n\n" + prefix + " What the **controversy** is about";
    state.rows.summaries[0].summary = source;
    const response = await POST(request({
      blockStart: 20, selectionStart: 9, text: "controversy",
      context: "What the controversy is about", heading: "What the controversy is about",
    }));
    expect(response.status).toBe(200);
    const prompt = JSON.parse(gateway.mock.calls[0][1].body).messages[0].content;
    expect(JSON.parse(prompt.split("\n").at(-1))).toEqual({
      targetLanguage: "zh", selection: "controversy", paragraph: "What the controversy is about", heading: "What the controversy is about",
    });
  });

  it.each([
    { context: "Unrelated paragraph" }, { heading: "Previous section" },
    { selectionStart: 0 }, { blockStart: 0 },
  ])("rejects forged heading context and offsets: %j", async patch => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: "pro", status: "active" };
    state.rows.summaries[0].summary = "# Previous section\n\n## What the controversy is about\n\nUnrelated paragraph";
    const response = await POST(request({
      blockStart: 20, selectionStart: 9, text: "controversy",
      context: "What the controversy is about", heading: "What the controversy is about", ...patch,
    }));
    expect(response.status).toBe(409);
    expect(gateway).not.toHaveBeenCalled();
  });
  it("denies a cancelled paid entitlement after its access period ends", async () => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: "pro", status: "active", cancel_at_period_end: true, current_period_end: "2020-01-01T00:00:00Z" };
    expect((await POST(request())).status).toBe(403);
    expect(gateway).not.toHaveBeenCalled();
  });

  it("translates a paid user's authorized Summary passage using its surrounding context", async () => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: "pro", status: "active" };
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ translation: "务实派", explanation: "这里指重视实际经济成果的人。" });
    const prompt = JSON.parse(gateway.mock.calls[0][1].body).messages[0].content;
    expect(prompt).toContain("focused on economic results");
    expect(prompt).toContain("Practical decisions");
    expect(prompt).not.toContain("learner-1");
  });

  it.each([
    { label: "omitted part of speech", partOfSpeech: undefined, sameLanguage: false },
    { label: "null part of speech", partOfSpeech: null, sameLanguage: false },
    { label: "omitted same-language flag", partOfSpeech: undefined, sameLanguage: undefined },
    { label: "same-language meaning", partOfSpeech: undefined, sameLanguage: true },
  ])("translates the reported full sentence with $label", async ({ partOfSpeech, sameLanguage }) => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: "pro", status: "active" };
    const heading = "Why some researchers argue omega-6s may be harmful";
    const text = "The video reviews an analysis by researchers including Ramsden that pooled older randomized controlled trials";
    const context = text + ". Across all the trials, the results showed no clear change in overall mortality. But when the researchers separated trials that increased omega-6 alone from those that increased omega-6 alongside omega-3, the patterns differed: the omega-3-included trials leaned toward benefit, while omega-6-only trials leaned toward harm.";
    const source = "## " + heading + "\n\n" + context;
    state.rows.summaries[0].summary = source;
    const translation = "视频回顾了拉姆斯登等研究人员的一项分析，该分析汇总了较早的随机对照试验。";
    const explanation = "这里描述的是视频所回顾的研究分析，以及该分析汇总的试验类型。";
    gateway.mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
      translation, explanation, sameLanguage, partOfSpeech,
    }) } }] }));
    const response = await POST(request({
      blockStart: source.indexOf(context), selectionStart: 0, text, context, heading,
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ translation, explanation, ...(sameLanguage === undefined ? {} : { sameLanguage }) });
  });

  it("denies Free users before sending any selected text to AI", async () => {
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "PAID_REQUIRED" });
    expect(gateway).not.toHaveBeenCalled();
  });

  it.each([null, { id: "visitor", is_anonymous: true }])("rejects missing or anonymous identities", async user => {
    state.user = user;
    expect((await POST(request())).status).toBe(401);
    expect(gateway).not.toHaveBeenCalled();
  });

  it.each(["past_due", "unpaid", "canceled"])("denies a %s subscription", async status => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: status === "canceled" ? "free" : "pro", status };
    expect((await POST(request())).status).toBe(403);
    expect(gateway).not.toHaveBeenCalled();
  });

  it("allows paid access through a future cancellation date", async () => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: "pro", status: "active", cancel_at_period_end: true, current_period_end: "2099-01-01T00:00:00Z" };
    expect((await POST(request())).status).toBe(200);
  });

  it("rejects a Summary absent from the learner's history", async () => {
    state.rows.user_subscriptions[0].tier = "pro";
    state.rows.user_subscriptions[0].status = "active";
    state.rows.user_video_history[0].user_id = "someone-else";
    expect((await POST(request())).status).toBe(404);
    expect(gateway).not.toHaveBeenCalled();
  });

  it.each([
    { context: "Invented context" }, { heading: "Forged heading" },
    { selectionStart: 0 }, { blockStart: 0 }, { outputLanguage: "fr" },
  ])("rejects context that does not match the exact saved Summary: %j", async patch => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: "pro", status: "active" };
    expect((await POST(request(patch))).status).toBe(409);
    expect(gateway).not.toHaveBeenCalled();
  });

  it.each([
    { text: "A sentence. Another sentence." }, { text: "They bought books, etc. They left." }, { text: "一つです。もう一つです。" },
    { text: "He lives in the U.S. Army recruitment is falling." },
    { text: "He moved to the U.K. Prime Minister Brown resigned." },
    { text: "He lives in the U.S. Stop!" },
    { text: "He lives in the U.S. Run!" },
    { text: "He lives in the U.S. Go!" },
    { text: "He lives in the U.S. It is warm." },
    { text: "He lives in the U.S. Prices rose." },
    { text: "U.S. Army. They moved." },
    { text: "The U.S. Food and Drug Administration approved it. They announced it." },
    { text: "The U.S. Armyworm numbers rose." },
    { text: "The U.S. It is warm." },
    { text: "x".repeat(501) }, { context: "x".repeat(4001) },
    { targetLanguage: "unsupported" }, { text: "  " }, { userId: "someone-else" },
  ])("rejects an invalid translation request: %j", async patch => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: "pro", status: "active" };
    expect((await POST(request(patch))).status).toBe(400);
    expect(gateway).not.toHaveBeenCalled();
  });

  it.each([
    ["U.S. Army", "U.S. Army"],
    ["The U.S. Food and Drug Administration approved it.", "The U.S. Food and Drug Administration approved it."],
    ["U.K. Prime Minister", "U.K. Prime Minister"],
    ["The U.N. Security Council met today.", "The U.N. Security Council met today."],
    ["Dr. Smith uses evidence.", "Dr. Smith uses evidence."],
    ["Er wohnt z. B. in Berlin.", "Er wohnt z. B. in Berlin."],
    ["- A **pragmatist** uses evidence.", "A pragmatist uses evidence."],
    ["我们重视实际成果。", "我们重视实际成果。"],
    ["نستخدم الأدلة لتحقيق النتائج.", "نستخدم الأدلة لتحقيق النتائج."],
  ])("accepts one sentence and rendered Markdown: %s", async (source, context) => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: "pro", status: "active" };
    state.rows.summaries[0].summary = source;
    expect((await POST(request({ blockStart: 0, selectionStart: 0, text: context, context, heading: "" }))).status).toBe(200);
  });

  it("bounds long paragraph context around the selected word", async () => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: "pro", status: "active" };
    const context = "前".repeat(5000) + "pragmatist" + "後".repeat(5000);
    state.rows.summaries[0].summary = context;
    expect((await POST(request({ blockStart: 0, selectionStart: 5000, context: context.slice(3500, 7500), heading: "" }))).status).toBe(200);
    const prompt = JSON.parse(gateway.mock.calls[0][1].body).messages[0].content;
    const source = JSON.parse(prompt.split("\n").at(-1));
    expect(Array.from(source.paragraph)).toHaveLength(4000);
  });

  it("enforces the shared AI request limit with a retry time", async () => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: "pro", status: "active" };
    state.rateCount = 31;
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(gateway).not.toHaveBeenCalled();
  });

  it("fails closed when subscription lookup is unavailable", async () => {
    state.databaseError = true;
    expect((await POST(request())).status).toBe(503);
    expect(gateway).not.toHaveBeenCalled();
  });

  it("does not expose provider errors or selected text in logs", async () => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: "pro", status: "active" };
    gateway.mockResolvedValue(new Response("PRIVATE PROVIDER pragmatist", { status: 500 }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("PRIVATE");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|pragmatist/);
    log.mockRestore();
  });

  it("rejects malformed AI output and marks successful responses no-store", async () => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: "pro", status: "active" };
    expect((await POST(request())).headers.get("Cache-Control")).toBe("no-store");
    gateway.mockResolvedValue(Response.json({ choices: [{ message: { content: "{}" } }] }));
    expect((await POST(request())).status).toBe(502);
  });

  it("diagnoses invalid AI result fields without logging values or arbitrary keys", async () => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: "pro", status: "active" };
    gateway.mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
      translation: "PRIVATE_TRANSLATION", explanation: "PRIVATE_EXPLANATION",
      partOfSpeech: false, sameLanguage: false, PRIVATE_KEY: "PRIVATE_VALUE",
    }) } }] }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await POST(request());
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        code: "TRANSLATION_FAILED", message: "Translation could not be completed. Try again.",
      });
      expect(log.mock.calls).toEqual([
        ["[highlight-translation] invalid AI result", {
          errorId: "HIGHLIGHT_TRANSLATION_INVALID_RESULT", source: "partOfSpeech", reason: "boolean",
        }],
        ["[highlight-translation] invalid AI result", {
          errorId: "HIGHLIGHT_TRANSLATION_INVALID_RESULT", source: "response", reason: "object",
        }],
      ]);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|pragmatist|learner-1/);
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    { field: "translation", value: "", type: "string" },
    { field: "translation", value: true, type: "boolean" },
    { field: "explanation", value: 42, type: "number" },
    { field: "partOfSpeech", value: ["PRIVATE_VALUE"], type: "array" },
    { field: "partOfSpeech", value: { PRIVATE_KEY: "PRIVATE_VALUE" }, type: "object" },
    { field: "translation", value: undefined, type: "missing" },
    { field: "sameLanguage", value: "false", type: "string" },
  ])("reports only the $type type for invalid $field", async ({ field, value, type }) => {
    state.rows.user_subscriptions[0] = { user_id: "learner-1", tier: "pro", status: "active" };
    gateway.mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({
      translation: "PRIVATE_TRANSLATION", explanation: "PRIVATE_EXPLANATION", sameLanguage: false,
      [field]: value,
    }) } }] }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await POST(request())).status).toBe(502);
      expect(log.mock.calls).toEqual([["[highlight-translation] invalid AI result", {
        errorId: "HIGHLIGHT_TRANSLATION_INVALID_RESULT", source: field, reason: type,
      }]]);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|pragmatist|learner-1/);
    } finally {
      log.mockRestore();
    }
  });
});
