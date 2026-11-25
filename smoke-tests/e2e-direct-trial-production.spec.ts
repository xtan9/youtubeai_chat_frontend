import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { ResearchDocument } from "../lib/projects/project-research-contract";

const base = "https://www.youtubeai.chat";
const folder = "test-results/workspace-intent";
// Replay the two first questions saved by the production video-outline journey.
// Expected publications are checked only after the real investigation completes.
const cases = [
  {
    id: "six-hours", project: "咖啡因与睡眠", title: "睡前六小时喝咖啡因饮料，当晚会少睡多久？",
    heading: "研究怎么测「睡前六小时」",
    question: "哪些成人随机对照研究直接比较了睡前六小时摄入咖啡因和安慰剂，并测量当晚总睡眠时间？",
    expectedDois: ["10.5664/jcsm.3170"],
  },
  {
    id: "same-dose", project: "咖啡", title: "下午喝咖啡，离睡觉多远才不影响睡眠？",
    heading: "先看时间：同样的剂量，早喝和晚喝有差别吗？",
    question: "成人对照实验有没有在剂量相同的情况下，直接比较不同摄入时间对当晚睡眠的影响？",
    expectedDois: ["10.5664/jcsm.3170", "10.1093/sleep/zsae230"],
  },
];

test.use({ trace: "off", video: "off", screenshot: "off" });

for (const scenario of cases) {
  test(`research original outline question (${scenario.id}) @account-mutating`, async ({ page, context }) => {
    test.skip(process.env.RUN_WORKSPACE_INTENT_LIVE !== "1", "Uses the dedicated production smoke account.");
    test.setTimeout(7 * 60_000);
    await page.goto(base + "/auth/login");
    await page.locator("#email").fill(process.env.TEST_LIVE_SUMMARY_EMAIL!);
    await page.locator("#password").fill(process.env.TEST_LIVE_SUMMARY_PASSWORD!);
    await Promise.all([
      page.waitForURL(url => ["/", "/dashboard"].includes(url.pathname)),
      page.getByRole("button", { name: /^login$/i }).click(),
    ]);
    await context.addCookies([{ name: "locale", value: "zh", url: base }]);
    const created = await page.request.post(base + "/api/workspace/projects", {
      data: { name: scenario.project + " · 视频验收 " + Date.now() },
    });
    expect(created.status()).toBe(201);
    const { project } = await created.json();
    const endpoint = base + "/api/projects/" + project.id;
    try {
      const id = randomUUID(), interviewId = randomUUID(), activeDraft = "outline/" + interviewId;
      const saved = await page.request.put(endpoint + "/space", {
        data: { revision: 0, document: {
          activeDraft, purpose: "video", questions: [{ id, title: scenario.question }],
          resources: [], messages: [], drafts: [{
            id: activeDraft, title: scenario.title, text: "", markers: [],
            outline: { interviewId, sections: [{ heading: scenario.heading, questionIds: [id] }] },
          }],
        } },
      });
      expect(saved.status()).toBe(200);
      await page.goto(base + "/workspace/projects/" + project.id);
      const [response] = await Promise.all([
        page.waitForResponse(r => r.url() === endpoint + "/research" && r.request().method() === "POST", { timeout: 310_000 }),
        page.locator(".outline-section").getByRole("button").filter({ hasText: scenario.question }).click(),
      ]);
      expect(response.request().postDataJSON()).toMatchObject({ question: scenario.question, space: { questionId: id } });
      const body = await response.json();
      expect(response.status(), body.message).toBe(201);
      const doc: ResearchDocument = body.versions[0].document;
      expect(doc.question).toBe(scenario.question);
      const judgment = doc.synthesis.judgment;
      const citations = judgment.references.map(ref => {
        const source = doc.evidence.find(item => item.id === ref.id)!;
        expect(source.text).toContain(ref.quote);
        return { doi: source.originId, title: source.title, url: source.url, quote: ref.quote };
      });
      await mkdir(folder, { recursive: true });
      await writeFile(folder + "/" + scenario.id + ".json", JSON.stringify({
        question: doc.question, status: response.status(), searches: doc.searches, judgment: judgment.text,
        citations, warnings: doc.warnings, candidates: doc.evidence.map(s => ({ title: s.title, url: s.url })),
      }, null, 2));
      const matched = citations.filter(item => scenario.expectedDois.includes(item.doi));
      expect(matched.length, judgment.text).toBeGreaterThan(0);
      if (scenario.id === "six-hours") {
        const excerpts = matched.map(c => c.quote).join(" ");
        expect(excerpts).toMatch(/6 hours/i);
        expect(excerpts).toMatch(/placebo/i);
        expect(excerpts).toMatch(/total sleep time/i);
        expect(judgment.text).toMatch(/(?:6|六)\s*(?:个)?小时/);
      }
      await expect(page.locator(".q-results")).toContainText(judgment.text);
      await page.locator(".q-sheet").screenshot({ path: folder + "/" + scenario.id + ".png" });
      const state = await page.request.get(endpoint + "/space");
      expect(state.ok()).toBe(true);
      expect((await state.json()).document.drafts.every((d: { text: string }) => !d.text.trim())).toBe(true);
      console.log(scenario.question, judgment.text, matched.map(item => item.url));
    } finally {
      expect((await page.request.delete(endpoint)).status()).toBe(204);
    }
  });
}
