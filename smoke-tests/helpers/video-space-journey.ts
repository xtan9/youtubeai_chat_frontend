import { checkClaimHighlightTranslation } from "./claim-highlight-translation";
import { expect, type Page, type TestInfo } from "@playwright/test";
import type { Resource } from "../../lib/video-space/contract";
import type { ResearchVersion } from "../../lib/projects/project-research-contract";
const opening =
  "两个视频都在讲 seed oil，却给了我不同的答案。\n\n我想先弄清楚：它们在回答同一个问题吗？";
const judgment = "干预组的胆固醇降幅更大，但在这项试验中没有观察到死亡率获益。";
const claim = "指标下降，人就会活得更久。";
export async function videoSpaceJourney(
  page: Page,
  testInfo: TestInfo,
  appUrl: string,
  projectId: string,
  videoIds: string[],
) {
  const endpoint = appUrl + "/api/projects/" + projectId;
  const versions: ResearchVersion[] = [];
  const publication = {
    id: "E1234567890123456",
    kind: "publication_abstract" as const,
    originId: "10.1136/bmj.i1246",
    title: "Re-evaluation of the traditional diet-heart hypothesis",
    url: "https://europepmc.org/article/MED/27071971",
    text: "There was no mortality benefit for the intervention group.",
    retrievedAt: "2026-11-18T00:00:00Z",
    year: "2016",
    authors: null,
    publicationTypes: ["Clinical Trial"],
  };
  const secondVideoClip = {
    ...publication,
    id: "V1234567890123456",
    kind: "video" as const,
    url: "https://www.youtube.com/watch?v=aaaaaaa0002&t=126s",
    originId: "second-video-passage",
    title: "同一试验，另一个问题",
    text: "这段视频比较了干预组和对照组的死亡结局。",
  };
  const observation = {
    text: judgment,
    references: [{ id: publication.id, quote: publication.text }],
  };
  let reject = false,
    requests = 0;
  await page.route(endpoint + "/research**", async (r) => {
    if (r.request().method() === "GET")
      return r.fulfill({ json: { versions } });
    requests++;
    if (reject)
      return r.fulfill({
        status: 503,
        json: { message: "文献服务暂不可用。" },
      });
    const body = r.request().postDataJSON();
    versions.unshift({
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      document: {
        question: body.question,
        space: body.space,
        evidence: [publication, secondVideoClip],
        synthesis: {
          judgment: observation,
          reasoning: body.space?.followUpTo
            ? {
                text: judgment,
                references: [
                  { id: secondVideoClip.id, quote: secondVideoClip.text },
                ],
              }
            : observation,
          findings: [observation],
          uncertainties: ["家庭用油的影响有待研究。"],
          nextSteps: ["调查其他比较条件。"],
          changes: "建立此问题的初步判断。",
          assessment: {
            category: "problematic",
            direction: "challenges",
            strength: "moderate",
            strengthReason: "试验直接比较了干预组和对照组。",
            confidence: "high",
            confidenceReason: "摘要分别报告了两个结局。",
          },
        },
        searches: [],
        warnings: [],
        sourceSetRevision: 2,
        promptVersion: "project-research-v1",
      },
    });
    return r.fulfill({ json: { versions } });
  });
  const discussed: string[] = [];
  const explanation = "我们可以先从这个观点的原话说起。";
  let writes = 0;
  await page.route(endpoint + "/space", async (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const b = r.request().postDataJSON();
    if (b.action === "discussClaim") {
      discussed.push(b.claim);
      if (b.claim === "关于比较对象的新观点") expect(b.history).toEqual([]);
      return r.fulfill({ json: { reply: explanation } });
    }
    if (b.action === "write") {
      writes++;
      const discussion = b.prompt.includes("吗"),
        options = b.prompt.includes("方案");
      if (discussion) expect(b.passage.text).toBe("两个视频");
      return r.fulfill({
        json: {
          mode: discussion ? "discuss" : options ? "options" : "edit",
          reply: discussion ? "可以让这句更口语一点。" : "稿子在这里。",
          options: discussion
            ? []
            : options
              ? ["第一种表达", "第二种表达"]
              : [
                  b.passage && !b.appendOnly
                    ? "两段采访"
                    : "一个指标的变化，能回答寿命的问题吗？",
                ],
          usedFinding: !!b.finding,
          target: b.appendOnly ? "append" : b.passage ? "passage" : "append",
        },
      });
    }
    if (b.action === "web")
      return r.fulfill({
        json: {
          id: crypto.randomUUID(),
          kind: "web",
          url: b.url,
          title: "网页 · 试验报告",
          pages: [{ text: publication.text, label: "段落 1" }],
          coverage: "已读取网页摘录 · 1 段",
        },
      });
    if (b.action === "summary") {
      const resource = b.resource as Resource;
      expect(resource.pages.length).toBeGreaterThan(0);
      return r.fulfill({
        json: {
          summary: resource.pages[0].text,
          claims: [
            {
              id: "fixture-" + resource.id,
              text: resource.pages[0].text,
              quote: resource.pages[0].text,
              location: resource.pages[0].label,
            },
          ],
        },
      });
    }
    return r.fallback();
  });
  const docs: Resource[] = videoIds.map((id, i) => ({
    id,
    kind: "video",
    title: i ? "同一试验，另一个问题" : "换一种油，指标会怎样？",
    url: "https://www.youtube.com/watch?v=aaaaaaa000" + (i + 1),
    coverage: "视频字幕摘录",
    pages: [],
    analyzed: true,
    digest: {
      summary: i
        ? "片段关注试验对象、死亡结局。"
        : "片段从换油对胆固醇的影响谈起，继而把指标变化延伸到寿命。",
      claims: [
        "这项试验换了饮食里的油。",
        claim,
        "这是否适用于家里的炸锅？",
        "同一试验跟踪了哪些人？",
        "多久后重新测量了指标？",
        "长期随访回答了什么问题？",
      ].map((q, j) => ({
        text: j === 1 ? "胆固醇下降意味着活得更久吗？" : q,
        quote: q,
        location: ["00:18", "02:06", "04:12", "04:30", "05:15", "06:00"][j],
        seconds: [18, 126, 252, 270, 315, 360][j],
      })),
    },
  }));
  const seed = await page.request.put(endpoint + "/space", {
    data: {
      revision: 0,
      document: {
        drafts: [{ id: "opening", title: "开场脚本", text: "", markers: [] }],
        messages: [],
        customClaims:[{id:"f7e00000-0000-4000-8000-000000000001",text:"关于比较对象的新观点"}],
        resources: [...docs].reverse(),
      },
    },
  });
  expect(seed.ok()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(appUrl + "/new-workspace/projects/" + projectId + "?view=investigations");
  await expect(page).toHaveURL(appUrl + "/workspace/projects/" + projectId + "?view=investigations");
  const left = page.getByRole("navigation", {name: "素材列表"});
  await page.locator("select.rich-view").selectOption("source");
  const editor = page.getByRole("textbox", {name: "脚本正文"});
  await editor.fill(opening);
  const card = left.locator(".vs-source").filter({has: page.getByRole("heading", {name: docs[0].title})});
  const claimTitle = "胆固醇下降意味着活得更久吗？";
  await card.getByRole("button", {name: claimTitle, exact: true}).click();
  const room = page.getByRole("region", {name: "观点研究", exact: true});
  await expect(room.locator("#vs-room-title")).toHaveText(claimTitle);
  await room.getByLabel("研究问题").fill("这些结论的适用范围是什么？");
  await room.getByRole("button", {name: "发送", exact: true}).click();
  await expect(room.getByText(explanation)).toBeVisible();
  reject = true;
  await room.getByRole("button", {name: "查找证据"}).click();
  await expect(room.getByRole("alert").first()).toBeVisible();
  reject = false;
  await room.getByRole("button", {name: "查找证据"}).click();
  await expect(room.getByText(judgment, {exact: true}).first()).toBeVisible();
  await room.getByText("调查发现与出处").click();
  await checkClaimHighlightTranslation(page, projectId, versions[0].id);
  await testInfo.attach("Research in the project", {body: await room.screenshot(), contentType: "image/png"});
  await room.getByRole("button", {name: "交给创作搭档"}).click();
  await page.getByRole("button", {name: "写入当前文稿"}).last().click();
  await expect(editor).not.toHaveValue(opening);
  const script = await editor.inputValue();
  expect(script.startsWith(opening)).toBe(true);
  await expect(page.getByText("已保存", {exact:true})).toBeVisible();
  await page.reload();
  await page.locator("select.rich-view").selectOption("source");
  await expect(editor).toHaveValue(script);
  expect(requests).toBe(2);
  expect(writes).toBe(1);
}
