import { expect, test } from "@playwright/test";
import type { Space } from "../lib/video-space/contract";
import type { ResearchVersion } from "../lib/projects/project-research-contract";
import { mkdir, writeFile } from "node:fs/promises";

test.use({ trace: "off", video: "off", screenshot: "off" });
test("published workspace from naming to independently cited manuscript @workspace-intent-live @account-mutating", async ({
  page,
  context,
}) => {
  test.skip(
    process.env.RUN_WORKSPACE_INTENT_LIVE !== "1",
    "Explicit production acceptance with the designated smoke account.",
  );
  test.setTimeout(28 * 60_000);
  const base = "https://www.youtubeai.chat";
  const folder = "test-results/workspace-intent";
  await mkdir(folder, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + "/auth/login");
  await page.locator("#email").fill(process.env.TEST_LIVE_SUMMARY_EMAIL!);
  await page.locator("#password").fill(process.env.TEST_LIVE_SUMMARY_PASSWORD!);
  await Promise.all([
    page.waitForURL((url) => ["/", "/dashboard"].includes(url.pathname)),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);
  await context.addCookies([{ name: "locale", value: "zh", url: base }]);
  const listingResponse = await page.request.get(
    base + "/api/workspace/projects",
  );
  expect(listingResponse.status()).toBe(200);
  const listing = (await listingResponse.json()).workspace.projects as {
    id: string;
    createdAt: string;
  }[];
  const configured = process.env.TEST_PROJECT_ID?.trim();
  const previous =
    configured ||
    listing.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
      ?.id;
  if (previous) {
    await page.goto(base + "/workspace/projects/" + previous);
    await expect(page.locator(".intent-shell .integrated")).toBeVisible();
    await expect(page.getByRole("navigation", {name: "素材列表"})).toBeVisible();
    await expect(page.getByRole("link", {name: /原项目资料/})).toHaveCount(0);
    await expect(page.locator(".project-head select, [data-project-action]")).toHaveCount(0);
  } else {
    console.log("The dedicated smoke account had no pre-existing project.");
  }
  await page.goto(base + "/workspace");
  const name = "种子油到底好不好 · QA " + Date.now();
  await page.getByLabel("项目名称").fill(name);
  await page.screenshot({
    path: folder + "/creation.png",
    mask: [page.locator(".recent-projects")],
  });
  await page.getByRole("button", { name: "创建并打开" }).click();
  await page.waitForURL(/\/workspace\/projects\/[\da-f-]+$/);
  console.log("New isolated project created from the regular workspace.");
  const project = page.url(),
    endpoint = project.replace("/workspace/projects/", "/api/projects/");
  await expect(
    page.getByText("你希望「" + name + "」这个项目最后帮你做到什么？", {
      exact: true,
    }),
  ).toBeVisible();
  const read = async (): Promise<Space> =>
    (await (await page.request.get(endpoint + "/space")).json()).document;
  const formats = [
    ["自己弄明白", "research"],
    ["写博客", "blog"],
    ["写一本书", "book"],
    ["还没决定", "explore"],
    ["做 YouTube 视频", "video"],
  ];
  for (const [i, [label, kind]] of formats.entries()) {
    if (i) await page.getByRole("button", { name: "试试其他回答" }).click();
    const beforeDrafts = (await read()).drafts.filter(d => d.text).length;
    const waitForAction = (action: string) => page.waitForResponse(
      r => r.url() === endpoint + "/space" && r.request().method() === "POST" && r.request().postDataJSON()?.action === action,
      { timeout: 120000 },
    );
    const opening = waitForAction("interview");
    if (kind === "blog") {
      await page
        .getByLabel("用自己的话回答")
        .fill("我想写一篇博客文章，给第一次做饭的人读。");
      await page.getByRole("button", { name: "发送回答" }).click();
    } else await page.getByRole("button", { name: label, exact: true }).click();
    if (kind === "video") {
      const pending = page.locator(".chat-log .user-text").filter({ hasText: label })
        .last().locator("+ .chat-pending").getByRole("status", { name: "助手正在思考" });
      await expect(pending).toBeInViewport({ ratio: 1 });
    }
    const first = await opening;
    expect(first.status()).toBe(200);
    const firstStage = (await first.json()).stage;
    const confirm = page.getByRole("button", { name: "确认需求，开始起草" });
    await expect(confirm).toHaveCount(0);
    if (kind === "video") {
      if (firstStage === "ask") {
        const next = waitForAction("interview");
        await page.getByRole("textbox", { name: "消息", exact: true }).fill("比较葵花籽油和菜籽油瓶身标签上的原料名称，给第一次独自做饭的人看。");
        await page.getByRole("button", { name: "发送消息" }).click();
        const result = await next;
        expect(result.status()).toBe(200);
        expect((await result.json()).stage).toBe("outline");
      } else expect(firstStage).toBe("outline");
      await expect(page.getByLabel("大纲标题")).toBeVisible();
      await expect(page.locator(".outline-section li button").first()).toBeVisible();
      expect((await read()).drafts.filter(d => d.text)).toHaveLength(beforeDrafts);
      const writing = waitForAction("draftOutline");
      await page.getByRole("button", { name: "写脚本初稿" }).click();
      expect((await writing).status()).toBe(200);
      await expect(page.locator(".paper .ql-editor h2").first()).toBeVisible();
      continue;
    }
    expect(firstStage).toBe("ask");
    const answers = [
      "我想从厨房里的两瓶油出发，比较葵花籽油和菜籽油的标签。给第一次独自做饭的人看，看完能说出名称各自指哪种植物。用我在厨房翻看标签的场景开头，口吻平实，中文，约300字，分两段。只讲名称和原料，不推断哪种更健康；缺资料就标为待核查。这些是我确定的需求，其他编辑选择交给你。",
      "接受你这一轮的建议。保留两瓶油的标签作为唯一例子。没有实物照片和逐字标签，其余资料均待核查；避免品牌、价格、具体营养数字或编造场景细节。篇幅、顺序和细节由你按刚才讨论的用途决定。",
      "我对上一轮提出的选择都接受你的推荐，其他尚未决定的编辑选择也明确委托给你。请整理需求让我核对。",
    ];
    for (const answer of answers) {
      const round = waitForAction("interview");
      await page.getByRole("textbox", { name: "消息", exact: true }).fill(answer);
      await page.getByRole("button", { name: "发送消息" }).click();
      const result = await round;
      expect(result.status()).toBe(200);
      if ((await result.json()).stage === "review") break;
    }
    await expect(confirm).toBeVisible();
    await expect(page.locator(".chat-log .turn").last()).toContainText(/葵花|菜籽/);
    expect((await read()).drafts.filter(d => d.text)).toHaveLength(beforeDrafts);
    const response = waitForAction("starter");
    await confirm.click();
    const generated = await response;
    expect(generated.status()).toBe(200);
    const manuscript = await generated.json();
    expect(manuscript.format).toBe(kind);
    expect(JSON.stringify([manuscript.lead, manuscript.sections])).toMatch(/葵花|菜籽/);
    await expect
      .poll(async () => (await read()).purpose, { timeout: 60000 })
      .toBe(kind);
    await expect(page.locator(".paper .ql-editor h2")).not.toHaveCount(0);
    if (kind === "blog") {
      const before = (await read()).drafts.find((d) =>
        d.id.startsWith("blog/"),
      )!;
      const continuation = page.waitForResponse(
        (r) =>
          r.url() === endpoint + "/space" &&
          r.request().method() === "POST" &&
          r.request().postDataJSON()?.action === "write",
        { timeout: 120000 },
      );
      await page.getByRole("button", { name: "接着写", exact: true }).click();
      const reply = await continuation;
      expect(reply.status()).toBe(200);
      expect(reply.request().postDataJSON().format).toBe("blog");
      await expect
        .poll(
          async () => {
            const text = (await read()).drafts.find(
              (d) => d.id === before.id,
            )?.text;
            return (
              text?.startsWith(before.text) && text.length > before.text.length
            );
          },
          { timeout: 20000 },
        )
        .toBe(true);
    }
    console.log("Saved editable " + kind + " draft.");
  }
  expect(new Set((await read()).drafts.filter(d => d.text).map((d) => d.text)).size).toBe(5);
  await page.screenshot({ path: folder + "/draft.png" });
  await page.getByLabel("编辑视图").selectOption("sections");
  const lead = page.getByRole("textbox", { name: "文稿导语" });
  await lead.fill("这一段由作者在验收时写入。");
  await expect
    .poll(async () =>
      (await read()).drafts.some((d) => d.text.startsWith("这一段由作者")),
    )
    .toBe(true);
  const questions = [
    "种子油都有哪些？",
    "为什么叫种子油？",
    "他们有哪些共同特征？",
    "种子油是什么时候开始被用在家庭里的？",
  ];
  async function add(title: string) {
    await page.getByRole("button", { name: "新增问题", exact: true }).click();
    await page.getByLabel("问题标题").fill(title);
    await page
      .locator(".q-edit")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await expect(page.locator(".q-sheet h2")).toHaveText(title);
  }
  const priorQuestions = (await read()).questions ?? [];
  const missingQuestions = questions.filter(title => !priorQuestions.some(q => q.title === title));
  for (const question of missingQuestions) await add(question);
  await page.getByRole("button", { name: questions[0], exact: true }).click();
  await expect.poll(async () => (await read()).questions?.length).toBe(priorQuestions.length + missingQuestions.length);
  await page.screenshot({ path: folder + "/desktop.png" });
  const grid = page.locator(".integrated");
  const geometry = await grid.evaluate((el) => ({
    x: el.getBoundingClientRect().x,
    top: el.getBoundingClientRect().top,
    width: el.clientWidth,
    tracks: getComputedStyle(el).gridTemplateColumns,
    background: getComputedStyle(el).backgroundColor,
    fonts: getComputedStyle(document.querySelector(".q-sheet h2")!).fontFamily,
  }));
  expect(geometry.x).toBeCloseTo(37, 0);
  expect(geometry.background).toBe("rgb(255, 254, 250)");
  expect(geometry.fonts).toContain("Songti SC");
  const widths = geometry.tracks.split(" ").map(parseFloat);
  expect(widths[1] / widths[0]).toBeCloseTo(2.25, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(grid.locator(".pane:visible")).toHaveCount(1);
  await page.screenshot({ path: folder + "/mobile.png" });
  for (const label of ["问题与素材", "项目助手", "问题研究"]) {
    await page
      .locator(".mobile-tabs")
      .getByRole("button", { name: label })
      .click();
    await expect(grid.locator(".pane:visible")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const evidence: unknown[] = [];
  let inserted = "";
  let citedQuestion = "";
  async function investigate(title: string) {
    await page.getByRole("button", { name: title, exact: true }).click();
    const response = page.waitForResponse(
      (r) =>
        r.url() === endpoint + "/research" && r.request().method() === "POST",
      { timeout: 310000 },
    );
    await page.getByRole("button", { name: "让 AI 研究" }).click();
    const result = await response,
      body = await result.json();
    expect([201, 422], JSON.stringify(body).slice(0, 250)).toContain(
      result.status(),
    );
    if (result.status() === 422) {
      await expect(page.locator(".q-gap")).toBeVisible();
      await expect(page.locator(".q-cites button")).toHaveCount(0);
      evidence.push({ title, gap: body.message });
      console.log("Evidence gap recorded for " + title);
    } else {
      const v: ResearchVersion = body.versions[0];
      expect(v.document.question).toBe(title);
      const cited = v.document.synthesis.judgment.references.map((r) => {
        const source = v.document.evidence.find((s) => s.id === r.id)!;
        expect(source.text).toContain(r.quote);
        expect(source.title).not.toContain("中菜指南");
        return { title: source.title, url: source.url, quote: r.quote };
      });
      expect(cited.length).toBeGreaterThan(0);
      evidence.push({
        title,
        answer: v.document.synthesis.judgment.text,
        cited,
      });
      await expect(page.locator(".q-results")).toBeVisible();
      if (!inserted) {
        const select = page.getByLabel("写入位置");
        const position = await select
          .locator("option")
          .first()
          .getAttribute("value");
        expect(position).not.toBe("end");
        await select.selectOption(position!);
        await page.getByRole("button", { name: "带出处写入文稿" }).click();
        const marker = page.locator(
          '.q-draft-cites[data-answer-id="' + v.id + '"]',
        );
        await marker.getByRole("button").first().click();
        await expect(page.locator(".q-passage blockquote").first()).toHaveText(
          cited[0].quote,
        );
        const original = await page
          .locator(".q-passage a")
          .first()
          .getAttribute("href");
        expect(original?.split("#")[0]).toBe(cited[0].url);
        await expect(
          page.locator(".q-passage blockquote").first(),
        ).toBeInViewport({ ratio: 0.5 });
        await page.screenshot({ path: folder + "/original-passage.png" });
        await page.reload();
        await expect(page.locator(".q-passage blockquote").first()).toHaveText(
          cited[0].quote,
        );
        await page.getByRole("button", { name: "返回文稿" }).click();
        await expect(marker).toBeVisible();
        await page.screenshot({ path: folder + "/cited-draft.png" });
        inserted = v.id;
        citedQuestion = title;
      }
      console.log("Supported answer and exact quotations for " + title);
    }
    await writeFile(
      folder + "/research.json",
      JSON.stringify({ project, geometry, evidence }, null, 2),
    );
  }
  expect((await read()).resources).toHaveLength(0);
  await investigate(questions[0]);
  await page.getByRole("button", { name: "添加素材", exact: true }).click();
  await page.getByRole("button", { name: "贴入摘录" }).click();
  await page.getByLabel("来源标题").fill("《中菜指南》· 测试背景");
  await page
    .getByLabel("原文摘录", { exact: true })
    .fill("这份食谱在一道家常菜中使用花生油。");
  await page.getByRole("button", { name: "保存摘录" }).click();
  await expect.poll(async () => (await read()).resources.length).toBe(1);
  for (const q of questions.slice(1)) await investigate(q);
  if (!inserted) {
    const control = "高油酸葵花籽油和普通葵花籽油相比，油酸比例有何不同？";
    await add(control);
    await investigate(control);
  }
  expect(inserted).toBeTruthy();
  await page
    .getByRole("button", { name: "编辑「" + citedQuestion + "」" })
    .click();
  await page.getByLabel("问题标题").fill(citedQuestion + "（修订）");
  await page
    .locator(".q-edit")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.getByRole("button", { name: "返回文稿" }).click();
  await page
    .locator('.q-draft-cites[data-answer-id="' + inserted + '"] button')
    .first()
    .click();
  await expect(page.locator(".q-sheet h2")).toHaveText(citedQuestion);
  await expect(
    page.getByText("引用时的研究记录", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".q-results blockquote").first()).toBeVisible();
  await page.getByRole("button", { name: "返回文稿" }).click();
  const renamed = citedQuestion + "（修订）";
  await page.getByRole("button", { name: "编辑「" + renamed + "」" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除问题" }).click();
  await expect
    .poll(async () =>
      (await read()).questions?.some((q) => q.title === renamed),
    )
    .toBe(false);
  await add(citedQuestion);
  await expect(page.getByRole("button", { name: "让 AI 研究" })).toBeVisible();
  await expect(page.locator(".q-results")).toHaveCount(0);
  await page.goto(base + "/workspace");
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(
    page.locator('.q-draft-cites[data-answer-id="' + inserted + '"]'),
  ).toBeVisible();
  await page
    .locator('.q-draft-cites[data-answer-id="' + inserted + '"] button')
    .first()
    .click();
  await expect(page.locator(".q-sheet h2")).toHaveText(citedQuestion);
  await expect(
    page.getByText("引用时的研究记录", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".q-passage blockquote").first()).toBeVisible();
  expect((await read()).resources[0].title).toContain("中菜指南");
  expect((await read()).drafts.filter(d => d.text)).toHaveLength(5);
  expect((await read()).drafts.some(d => d.outline)).toBe(true);
  console.log(
    "Verified desktop/mobile layout, question CRUD, background source, citation placement, reload and reopen.",
  );
});
