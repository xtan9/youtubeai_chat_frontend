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
        resources: [...docs].reverse(),
      },
    },
  });
  expect(seed.ok()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(appUrl + "/new-workspace/projects/" + projectId);
  const editor = page.getByRole("textbox", { name: "脚本正文" }),
    prompt = page.getByLabel("消息", { exact: true });
  const left = page.getByRole("region", { name: "研究台", exact: true }),
    right = page.getByRole("region", { name: "创作搭档", exact: true });
  const photo = async (name: string) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await testInfo.attach(name, {
      path: await page
        .screenshot({
          path: testInfo.outputPath(name + ".png"),
          animations: "disabled",
          fullPage: name === "narrow",
          style: "nextjs-portal,.tsqd-parent-container{display:none!important}",
        })
        .then(() => testInfo.outputPath(name + ".png")),
      contentType: "image/png",
    });
  };
  await editor.fill(opening);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  const originCard = left
    .locator(".vs-source")
    .filter({ has: page.getByRole("heading", { name: docs[0].title }) });
  await expect(
    left.locator(".vs-source").first().getByRole("heading"),
  ).toHaveText(docs[0].title);
  await expect(
    originCard.getByRole("button", { name: docs[0].title, exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await originCard.getByRole("button", { name: /^摘要/ }).click();
  await expect(left.getByText(docs[0].digest!.summary)).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await photo("workbench");
  const widths = await page
    .locator(".vs-grid section.vs-panel:visible")
    .evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().width)),
    );
  expect(widths).toEqual([358, 591, 376]);
  await prompt.fill("保留这条未发送的消息");
  const claimTitle = "胆固醇下降意味着活得更久吗？";
  const openClaim = () =>
    originCard.getByRole("button", { name: claimTitle, exact: true }).click();
  const back = () =>
    page.getByRole("button", { name: "返回项目工作台" }).click();
  // Open a claim below the initial four while another source is expanded.
  const secondSource = left
    .locator(".vs-source")
    .filter({ has: page.getByRole("heading", { name: docs[1].title }) });
  await secondSource
    .getByRole("button", { name: docs[1].title, exact: true })
    .click();
  await originCard.getByText("查看全部 6 条", { exact: true }).click();
  const lastClaim = originCard.getByRole("button", {
    name: "长期随访回答了什么问题？",
    exact: true,
  });
  const tree = page.getByRole("navigation", { name: "素材目录" });
  await lastClaim.scrollIntoViewIfNeeded();
  const scroll = () => tree.evaluate((node) => node.scrollTop);
  await tree.evaluate((node) => {
    node.scrollTop = 140;
  });
  const top = await scroll();
  expect(top).toBeGreaterThan(0);
  await lastClaim.click();
  await expect(lastClaim).toHaveAttribute("aria-current", "page");
  expect(await scroll()).toBe(top);
  await expect(
    secondSource.getByRole("button", { name: claimTitle, exact: true }),
  ).toBeVisible();
  const fromSource = page.getByRole("region", {
    name: "观点空间",
    exact: true,
  });
  const claimText = fromSource.locator("#vs-room-title");
  await expect(claimText).toHaveText("长期随访回答了什么问题？");
  await expect(fromSource.getByText("查看原文摘录")).toHaveCount(0);
  await fromSource
    .getByRole("button", { name: docs[0].title, exact: true })
    .click();
  const overview = page.getByRole("region", { name: "素材观点", exact: true });
  await expect(
    overview.getByRole("heading", { name: docs[0].title }),
  ).toBeVisible();
  await expect(
    overview.getByRole("heading", { name: "本素材观点 · 6" }),
  ).toBeVisible();
  await overview
    .getByRole("button", { name: "长期随访回答了什么问题？" })
    .click();
  await expect(lastClaim).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(
    overview.getByRole("heading", { name: docs[0].title }),
  ).toBeFocused();
  await back();
  await expect(lastClaim).toBeVisible();
  expect(await scroll()).toBe(top);
  await expect(
    originCard.getByText("收起其余观点", { exact: true }),
  ).toBeVisible();
  const panelTop = () =>
    page
      .locator(".vs-grid")
      .evaluate((grid) => grid.getBoundingClientRect().top + window.scrollY);
  for (const width of [1440, 1024, 768, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const deskTop = await panelTop();
    await openClaim();
    const header = page
      .getByRole("region", { name: "观点空间", exact: true })
      .locator("header");
    const returnButton = header.getByRole("button", { name: "返回项目工作台" });
    await expect(returnButton).toBeVisible();
    await expect(returnButton).toHaveText("");
    await expect(returnButton.locator("svg")).toBeVisible();
    const headerBox = (await header.boundingBox())!;
    const buttonBox = (await returnButton.boundingBox())!;
    expect(buttonBox.y).toBeCloseTo(headerBox.y, 0);
    expect(buttonBox.x + buttonBox.width).toBeCloseTo(
      headerBox.x + headerBox.width,
      0,
    );
    expect(await panelTop()).toBeCloseTo(deskTop, 1);
    if (width > 760) {
      await expect(tree).toBeVisible();
    } else {
      await expect(tree).toBeHidden();
      expect((await fromSource.boundingBox())!.width).toBeGreaterThan(
        width * 0.82,
      );
    }
    if (width === 390) {
      await page.getByRole("button", { name: "素材目录" }).click();
      await expect(
        originCard.getByRole("button", { name: claimTitle }),
      ).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
      await expect(tree).toBeHidden();
      const directoryToggle = page.getByRole("button", { name: "素材目录" });
      await directoryToggle.click();
      await page
        .locator(".vs-directory-shade")
        .click({ position: { x: 2, y: 150 } });
      await expect(directoryToggle).toBeFocused();
      await directoryToggle.click();
      await lastClaim.click();
      await directoryToggle.click();
      await page.goBack();
      await expect(tree).toBeHidden();
      await expect(claimText).toHaveText(claimTitle);
      await expect(claimText).toBeFocused();
    }
    await back();
    await expect(originCard).toBeVisible();
    expect(await panelTop()).toBeCloseTo(deskTop, 1);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await openClaim();
  const room = page.getByRole("region", { name: "观点空间", exact: true });
  await expect(room).toBeVisible();
  await expect(right).toBeHidden();
  expect(requests).toBe(0);
  await expect(room.getByRole("link", { name: "打开素材 · 02:06" })).toHaveAttribute(
    "href",
    /t=126s/,
  );
  await expect(room.getByText(claim, { exact: true })).toBeHidden();
  await room.getByText("查看原文摘录").click();
  await expect(room.getByText(claim, { exact: true })).toBeVisible();
  const scriptBox = await editor.boundingBox(),
    researchBox = await room.boundingBox();
  expect(scriptBox!.x).toBeGreaterThan(researchBox!.x + researchBox!.width);
  const directory = tree;
  const other = directory
    .locator(".vs-source")
    .filter({ has: page.getByRole("heading", { name: docs[1].title }) });
  await room.getByLabel("研究问题").fill("只属于第一条观点的追问");
  await other.getByRole("button", { name: claimTitle, exact: true }).click();
  await expect(room.getByLabel("研究问题")).toHaveValue("");
  await expect(room).toContainText(docs[1].title);
  await editor.fill(opening + "正在编辑");
  await page.goBack();
  await expect(room.getByLabel("研究问题")).toHaveValue(
    "只属于第一条观点的追问",
  );
  await expect(editor).toHaveValue(opening + "正在编辑");
  await editor.fill(opening);
  await room.getByLabel("研究问题").fill("这段原话是什么意思？");
  await room.getByRole("button", { name: "发送" }).click();
  await expect(room.getByText(explanation)).toBeVisible();
  expect(requests).toBe(0);
  await room.getByRole("button", { name: "查找证据" }).click();
  await expect(room.getByText(judgment, { exact: true }).first()).toBeVisible();
  await photo("investigation");
  await room.getByText("核查范围与判断依据").click();
  await expect(room.getByText("判断把握", { exact: true })).toBeVisible();
  await room.getByText("调查发现与出处").click();
  await expect(
    room.getByRole("link", { name: /Re-evaluation/ }),
  ).toHaveAttribute("href", publication.url);
  await checkClaimHighlightTranslation(page, projectId, versions[0].id);
  await room.getByRole("button", { name: "交给创作搭档" }).click();
  await expect(right).toBeHidden();
  await expect(editor).toHaveValue(opening);
  await page.setViewportSize({ width: 614, height: 853 });
  expect((await editor.boundingBox())!.x).toBeGreaterThan(
    (await room.boundingBox())!.x,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "写脚本 →" }).click();
  await expect(editor).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.getByRole("button", { name: "← 回到观点" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await back();
  await expect(prompt).toHaveValue("保留这条未发送的消息");
  await left.getByRole("button", { name: "放大研究台" }).click();
  await photo("research-max");
  await left.getByRole("button", { name: "还原研究台" }).click();
  await right.getByRole("button", { name: "放大创作搭档" }).click();
  await photo("writer-max");
  await right.getByRole("button", { name: "还原创作搭档" }).click();
  await prompt.fill("保留这条未发送的消息");
  await left.getByRole("button", { name: "收起研究台" }).click();
  await right.getByRole("button", { name: "收起创作搭档" }).click();
  await photo("writing");
  await page.getByRole("button", { name: "展开研究台" }).press("Enter");
  await page.getByRole("button", { name: "展开创作搭档" }).press("Enter");
  await expect(prompt).toHaveValue("保留这条未发送的消息");
  await page.setViewportSize({ width: 390, height: 844 });
  await prompt.fill("");
  await photo("narrow");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await editor.focus();
  await editor.press("Home");
  await editor.press("Shift+ArrowRight");
  await right.getByRole("button", { name: "写进开场" }).click();
  await expect(editor).toHaveValue(
    opening + "\n一个指标的变化，能回答寿命的问题吗？",
  );
  await page.getByRole("button", { name: /查看句子来源/ }).click();
  await expect(room).toBeVisible();
  await expect(room.locator("[data-selected=true]")).toContainText(judgment);
  await back();
  await editor.focus();
  await editor.evaluate((el: HTMLTextAreaElement) => {
    el.setSelectionRange(0, 4);
    el.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await editor.press("Shift+ArrowRight");
  await editor.press("Shift+ArrowLeft");
  await prompt.fill("这句话自然吗？");
  await right.getByRole("button", { name: "发送", exact: true }).click();
  await expect(right.getByText("可以让这句更口语一点。")).toBeVisible();
  await prompt.fill("请改写选中文字");
  await right.getByRole("button", { name: "发送", exact: true }).click();
  await expect(editor).toHaveValue(/^两段采访都在讲/);
  await page.getByRole("button", { name: "撤销 AI 编辑" }).click();
  await expect(editor).toHaveValue(/^两个视频都在讲/);
  await prompt.fill("请给两个方案");
  await right.getByRole("button", { name: "发送", exact: true }).click();
  await expect(right.getByRole("button", { name: "采用方案 1" })).toBeEnabled();
  await editor.fill(opening + "\n这是我手写的收尾。");
  await expect(
    right.getByRole("button", { name: "采用方案 1" }),
  ).toBeDisabled();
  await openClaim();
  reject = true;
  await room.getByLabel("研究问题").fill("追问有没有长期数据？");
  await room.getByRole("button", { name: "检索这个问题" }).click();
  await expect(room.getByRole("alert")).toContainText("文献服务暂不可用");
  await expect(editor).toHaveValue(/手写的收尾。$/);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(claimText).toHaveText(claimTitle);
  await expect(room.getByRole("alert")).toContainText("文献服务暂不可用");
  await expect(editor).toHaveValue(/手写的收尾。$/);
  await back();
  await expect(right.getByText("可以让这句更口语一点。")).toBeVisible();
  const add = left.getByRole("button", { name: "添加素材", exact: true });
  await add.click();
  await left.getByLabel("YouTube 或网页链接").fill(publication.url);
  await left.getByRole("button", { name: "添加到 Space" }).click();
  const web = left.locator(".vs-source").filter({ hasText: "网页 · 试验报告" });
  await web.getByRole("button", { name: /摘要/ }).click();
  await expect(web.getByText("关键观点 · 1")).toBeVisible();
  const pdfPage = await page.context().newPage();
  await pdfPage.setContent(
    "<p>Intervention and control groups reported distinct outcomes.</p>",
  );
  const buffer = await pdfPage.pdf();
  await pdfPage.close();
  await add.click();
  await left.getByLabel("或选择 PDF").setInputFiles({
    name: "Minnesota.pdf",
    mimeType: "application/pdf",
    buffer,
  });
  await left.getByRole("button", { name: "添加到 Space" }).click();
  const pdf = left.locator(".vs-source").filter({ hasText: "Minnesota.pdf" });
  await pdf.getByRole("button", { name: /摘要/ }).click();
  await expect(pdf.getByText("关键观点 · 1")).toBeVisible();
  await pdf.getByText("原文摘录").click();
  await expect(pdf.getByText("第 1 页", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    left.getByRole("heading", { name: "Minnesota.pdf" }),
  ).toBeVisible();
  reject = false;
  await openClaim();
  await room.getByRole("button", { name: "重试调查" }).click();
  await expect(room.getByRole("button", { name: "查看本次证据" })).toHaveCount(
    2,
  );
  await expect(room.getByRole("alert")).toHaveCount(0);
  expect(versions[0].document.space?.followUpTo).toBe(versions[1].id);
  await other.getByRole("button", { name: docs[1].title, exact: true }).click();
  await other.getByRole("button", { name: claimTitle, exact: true }).click();
  await expect(room.getByRole("button", { name: "查看本次证据" })).toHaveCount(
    0,
  );
  await back();
  await page.getByRole("button", { name: "新建脚本" }).click();
  await expect(editor).toHaveValue("");
  await expect(right.getByText("可以让这句更口语一点。")).toBeVisible();
  await page.getByLabel("当前脚本").selectOption("opening");
  await expect(editor).toHaveValue(/手写的收尾。$/);
  const citedCard = left
    .locator(".vs-source")
    .filter({ has: page.getByRole("heading", { name: docs[1].title }) });
  await citedCard.getByRole("button", { name: /^摘要/ }).click();
  await citedCard.getByText("相关调查 · 1", { exact: true }).click();
  await citedCard
    .getByRole("button", { name: versions[0].document.question, exact: true })
    .click();
  await expect(room).toContainText(docs[0].title);
  await expect(room.locator("[data-selected=true]")).toContainText(judgment);
  await expect(room.getByText(explanation)).toBeVisible();
  const olderFinding = versions[1].id;
  await room.getByRole("button", { name: "追问这次判断" }).click();
  await room.getByLabel("研究问题").fill("针对最初判断的分组再找证据");
  await other.getByRole("button", { name: claimTitle, exact: true }).click();
  await page.goBack();
  await expect(room.getByLabel("研究问题")).toHaveValue(
    "针对最初判断的分组再找证据",
  );
  await room.getByRole("button", { name: "检索这个问题" }).click();
  await expect(room.getByRole("button", { name: "查看本次证据" })).toHaveCount(
    3,
  );
  expect(versions[0].document.space?.followUpTo).toBe(olderFinding);
  const branchFinding = versions[0].id;
  await room.getByLabel("研究问题").fill("在新判断上检索随访时长");
  await room.getByRole("button", { name: "检索这个问题" }).click();
  await expect(room.getByRole("button", { name: "查看本次证据" })).toHaveCount(
    4,
  );
  expect(versions[0].document.space?.followUpTo).toBe(branchFinding);
  await room.getByRole("button", { name: "查看本次证据" }).first().click();
  await room.getByLabel("研究问题").fill("查证最初那一次的研究设计");
  await other.getByRole("button", { name: claimTitle, exact: true }).click();
  await directory
    .locator(".vs-source")
    .filter({ has: page.getByRole("heading", { name: docs[0].title }) })
    .getByRole("button", { name: claimTitle, exact: true })
    .click();
  await expect(room.getByLabel("研究问题")).toHaveValue(
    "查证最初那一次的研究设计",
  );
  await room.getByRole("button", { name: "检索这个问题" }).click();
  await expect(room.getByRole("button", { name: "查看本次证据" })).toHaveCount(
    5,
  );
  expect(versions[0].document.space?.followUpTo).toBe(olderFinding);
  await back();
  await prompt.fill("这条写作消息先留着");
  await openClaim();
  await expect(claimText).toHaveText(claimTitle);
  await editor.focus();
  await editor.evaluate((element: HTMLTextAreaElement) =>
    element.setSelectionRange(0, 0),
  );
  await editor.press("Shift+ArrowRight");
  await page
    .getByRole("region", { name: "脚本编辑器" })
    .getByRole("button", { name: "讨论", exact: true })
    .click();
  await expect(prompt).toHaveValue("这条写作消息先留着");
  const custom = "关于比较对象的新观点";
  await left.getByRole("button", { name: "新建观点" }).click();
  await left.getByLabel("新观点").fill(custom);
  await left.getByRole("button", { name: "打开观点空间" }).click();
  await expect(claimText).toHaveText(custom);
  await expect(room.getByText(explanation)).toHaveCount(0);
  await room.getByLabel("研究问题").fill("应该先讨论什么？");
  await room.getByRole("button", { name: "发送" }).click();
  await expect(room.getByText(explanation)).toBeVisible();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(claimText).toHaveText(custom);
  await expect(room.getByText("应该先讨论什么？")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await room.getByRole("button", { name: "项目观点", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "素材目录" }).click();
  const currentSource = tree.getByRole("button", {
    name: "项目观点",
    exact: true,
  });
  await expect(currentSource).toBeFocused();
  await expect(currentSource).toBeInViewport({ ratio: 1 });
  expect(discussed).toEqual([claimTitle, custom]);
  expect(requests).toBe(6);
  expect(writes).toBe(4);
}
