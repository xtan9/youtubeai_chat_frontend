import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import type { Space } from "../lib/video-space/contract";
import type { ResearchVersion } from "../lib/projects/project-research-contract";

const base = "https://www.youtubeai.chat";
const folder = "test-results/workspace-intent";
const scenarios = [
  {
    id: "clear", name: "咖啡因与睡眠",
    opening: "我要做一期给普通上班族看的科普视频，主问题是睡前六小时喝含咖啡因的饮料，对当晚总睡眠时间有什么影响？从成人随机对照研究的实验设计和结果讲起，再说明研究的局限。",
  },
  {
    id: "seed-oil", name: "种子油",
    opening: "给平常做饭的人做一期视频。只讨论家用玉米油换黄油是否更护心。先给三节大纲，比较明尼苏达试验中随机分组的结果和胆固醇变化的观察性分析，再谈结论对家庭用油的适用范围。不要凭空写数字。",
  },
  {
    id: "unclear", name: "咖啡",
    opening: "想做一个跟咖啡有关的 YouTube 视频，角度和观众我都还没想好。",
    answer: "给经常下午喝咖啡的上班族看。想查清摄入咖啡因的时间怎样影响当晚睡眠，只讲成人对照实验的结果和局限。",
  },
];

test.use({ trace: "off", video: "off", screenshot: "off" });

for (const scenario of scenarios) {
  test(`production video outline and investigation (${scenario.id}) @account-mutating`, async ({ page, context }) => {
    test.skip(process.env.RUN_WORKSPACE_INTENT_LIVE !== "1", "Uses the dedicated production smoke account.");
    test.setTimeout(15 * 60_000);
    await mkdir(folder, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + "/auth/login");
    await page.locator("#email").fill(process.env.TEST_LIVE_SUMMARY_EMAIL!);
    await page.locator("#password").fill(process.env.TEST_LIVE_SUMMARY_PASSWORD!);
    await Promise.all([
      page.waitForURL(url => ["/", "/dashboard"].includes(url.pathname)),
      page.getByRole("button", { name: /^login$/i }).click(),
    ]);
    await context.addCookies([{ name: "locale", value: "zh", url: base }]);

    const created = await page.request.post(base + "/api/workspace/projects", {
      data: { name: scenario.name + " · 视频验收 " + Date.now() },
    });
    expect(created.status()).toBe(201);
    const { project } = await created.json();
    const endpoint = base + "/api/projects/" + project.id;
    const spaceUrl = endpoint + "/space";
    const researchUrl = endpoint + "/research";
    const actions: string[] = [];
    const report: Record<string, unknown> = { scenario: scenario.id, opening: scenario.opening, actions };
    const evidencePath = folder + "/video-" + scenario.id;
    const read = async (): Promise<Space> => {
      const result = await page.request.get(spaceUrl);
      expect(result.status()).toBe(200);
      return (await result.json()).document;
    };
    const writeCalls = () => actions.filter(a => ["draftOutline", "starter", "write"].includes(a));
    const waitForAction = (action: string) => page.waitForResponse(r =>
      r.url() === spaceUrl && r.request().method() === "POST" && r.request().postDataJSON().action === action,
      { timeout: 110_000 });
    page.on("request", r => {
      if (r.method() !== "POST") return;
      if (r.url() === spaceUrl) actions.push(r.postDataJSON().action);
      if (r.url() === researchUrl) actions.push("research");
    });
    try {
      await page.goto(base + "/workspace/projects/" + project.id);
      await page.getByLabel("用自己的话回答").fill(scenario.opening);
      const [opening] = await Promise.all([waitForAction("interview"), page.getByRole("button", { name: "发送回答" }).click()]);
      expect(opening.status()).toBe(200);
      const first = await opening.json();
      report.firstStage = first.stage;
      report.clarification = first.reply;
      if (scenario.answer) {
        expect(first.stage, JSON.stringify(first)).toBe("ask");
        await expect(page.locator(".chat-log")).toContainText(first.reply);
        await page.locator(".pane.chat").screenshot({ path: evidencePath + "-clarification.png" });
        await page.getByRole("textbox", { name: "消息", exact: true }).fill(scenario.answer);
        const [next] = await Promise.all([waitForAction("interview"), page.getByRole("button", { name: "发送消息" }).click()]);
        expect(next.status()).toBe(200);
        expect((await next.json()).stage).toBe("outline");
      } else expect(first.stage, JSON.stringify(first)).toBe("outline");
      const outline = page.locator(".video-outline");
      await expect(outline).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => (await read()).drafts.some(d => d.outline)).toBe(true);
      const planned = await read();
      const plan = planned.drafts.find(d => d.id === planned.activeDraft)!;
      expect(plan.outline!.sections.every(s => s.questionIds.length > 0)).toBe(true);
      expect(planned.drafts.filter(d => d.text.trim())).toHaveLength(0);
      report.outline = { title: plan.title, sections: plan.outline!.sections.map(s => ({
        heading: s.heading, note:s.note, questions: s.questionIds.map(id => planned.questions!.find(q => q.id === id)!.title),
      })) };
      expect(plan.outline!.sections.every(s => s.note?.trim())).toBe(true);
      await outline.screenshot({ path: evidencePath + "-outline.png" });
      if (scenario.id === "seed-oil") {
        await outline.getByRole("button", {name:"编辑大纲"}).click();
        const editor = outline.locator("form");
        await editor.getByLabel("本节要点").first().fill("用随机分组和观察性分析的比较对象解释数字。");
        await editor.getByRole("button", {name:"添加小节"}).click();
        await editor.getByLabel("段落标题").last().fill("核对家庭用油的适用范围");
        await editor.getByRole("button", {name:"上移"}).last().click();
        await editor.getByRole("button", {name:"保存大纲"}).click();
        await expect.poll(async () => (await read()).drafts.find(d => d.id === plan.id)?.outline?.sections.at(-2)?.heading)
          .toBe("核对家庭用油的适用范围");
        await page.reload();
        await expect(outline).toContainText("用随机分组和观察性分析的比较对象解释数字。");
        await page.screenshot({path:evidencePath+"-manual-edit.png"});
      }
      const savedOutline = (await read()).drafts.find(d => d.id === plan.id)!.outline!;
      const investigations = [];
      let selectedSection = 0;
      for (const [index, section] of savedOutline.sections.slice(0, 3).entries()) {
        if (!section.questionIds.length) continue;
        const q = planned.questions!.find(q => q.id === section.questionIds[0])!;
        const button = outline.locator(".outline-section").nth(index).getByRole("button").filter({ hasText: q.title }).first();
        const [research] = await Promise.all([
          page.waitForResponse(r => r.url() === researchUrl && r.request().method() === "POST", { timeout: 310_000 }),
          button.click(),
        ]);
        expect(research.request().postDataJSON()).toMatchObject({ question: q.title, space: { questionId: q.id } });
        const payload = await research.json();
        expect([201, 422], JSON.stringify(payload).slice(0, 300)).toContain(research.status());
        await expect(page.locator(".q-sheet h2")).toHaveText(q.title);
        if (research.status() === 201) {
          const run: ResearchVersion = payload.versions[0];
          expect(run.document.space?.questionId).toBe(q.id);
          const sources = run.document.synthesis.judgment.references.map(ref => {
            const source = run.document.evidence.find(s => s.id === ref.id)!;
            expect(source.text).toContain(ref.quote);
            return { title: source.title, url: source.url };
          });
          expect(sources.length).toBeGreaterThan(0);
          await expect(page.locator(".q-results")).toBeVisible();
          investigations.push({ question: q.title, status: 201, finding: run.document.synthesis.judgment.text, sources });
          selectedSection = index;
          await page.locator(".q-sheet").screenshot({ path: evidencePath + "-investigation.png" });
        } else {
          await expect(page.locator(".q-gap")).toBeVisible();
          investigations.push({ question: q.title, status: 422, gap: payload.message });
        }
        await page.getByRole("button", { name: "返回大纲" }).click();
        if (research.status() === 201) break;
      }
      report.investigations = investigations;
      await page.reload();
      await expect(outline).toBeVisible();
      const beforeWriting = await read();
      report.manuscriptsBeforeClick = beforeWriting.drafts.filter(d => d.text.trim()).length;
      report.writingRequestsBeforeClick = [...writeCalls()];
      expect(report.manuscriptsBeforeClick).toBe(0);
      expect(writeCalls()).toEqual([]);
      const sectionOnly = Boolean(scenario.answer) || scenario.id === "seed-oil";
      const write = sectionOnly ? outline.locator(".outline-section").nth(selectedSection).getByRole("button", { name: "写这一段" })
        : outline.getByRole("button", { name: "写脚本初稿" });
      // Reopen the same question the author just researched while the real draft request runs.
      const q = planned.questions!.find(q => q.id === savedOutline.sections[selectedSection].questionIds[0])!;
      const [draft] = await Promise.all([waitForAction("draftOutline"), (async () => {
        await write.click();
        if (!sectionOnly) {
          await expect(write).toBeDisabled();
          await outline.locator(".outline-section").nth(selectedSection).getByRole("button").filter({ hasText: q.title }).first().click();
          await expect(page.locator(".q-sheet h2")).toHaveText(q.title);
        }
      })()]);
      report.writeStatus = draft.status();
      expect(draft.status()).toBe(200);
      expect(draft.request().postDataJSON().section).toBe(sectionOnly ? selectedSection : undefined);
      const manuscript = await draft.json();
      await expect.poll(async () => (await read()).drafts.filter(d => d.text.trim()).length).toBe(1);
      if (!sectionOnly) {
        expect((await read()).activeDraft).toBe(plan.id);
        await expect(page.locator(".q-sheet h2")).toHaveText(q.title);
        await page.getByRole("region", { name: "问题研究" }).screenshot({ path: evidencePath + "-question-after-drafting.png" });
        await page.getByRole("button", { name: "返回大纲" }).click();
        await expect(outline.getByLabel("大纲标题")).toHaveValue(plan.title);

      }
      await expect(page.getByRole("textbox", { name: "文稿标题" })).toHaveValue(plan.title);
      await expect.poll(async () => {
        const current = await read();
        return current.drafts.find(d => d.id === current.activeDraft)?.text;
      }).toContain(manuscript.lead);
      const saved = await read();
      const script = saved.drafts.find(d => d.id === saved.activeDraft)!;
      expect(script.text).toContain(manuscript.lead);
      expect(saved.drafts.find(d => d.id === plan.id)?.outline).toBeDefined();
      expect(script.id).toBe(plan.id);
      if (scenario.id === "seed-oil") {
        await outline.getByRole("button", {name:"编辑大纲"}).click();
        await outline.getByRole("button", {name:"移除",exact:true}).nth(selectedSection).click();
        await outline.getByRole("button", {name:"保存大纲"}).click();
        await expect.poll(async () => (await read()).drafts.find(d => d.id===plan.id)?.outline?.removed?.length).toBe(1);
        await page.reload();
        await expect(outline).toContainText("已移出大纲");
        expect((await read()).drafts.find(d => d.id===plan.id)?.text).toBe(script.text);
        await outline.getByRole("button", {name:"编辑大纲"}).click();
        await outline.getByRole("button", {name:"放回大纲"}).click();
        await outline.getByRole("button", {name:"保存大纲"}).click();
        await expect.poll(async () => (await read()).drafts.find(d => d.id===plan.id)?.outline?.removed?.length ?? 0).toBe(0);
        report.manualEdit = {reloaded:true, removedAndRestored:true, manuscriptPreserved:true};
      }
      expect(writeCalls()).toEqual(["draftOutline"]);
      report.script = { title: script.title, characters: script.text.length, citations: script.markers.length,
        sectionOnly, text: script.text };
      await page.getByRole("region", { name: "当前文稿" }).screenshot({ path: evidencePath + "-script.png" });
      console.log(JSON.stringify(report));
    } finally {
      await writeFile(evidencePath + ".json", JSON.stringify(report, null, 2));
      expect((await page.request.delete(endpoint)).status()).toBe(204);
    }
  });
}
