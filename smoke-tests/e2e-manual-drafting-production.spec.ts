import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { Space } from "../lib/video-space/contract";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("handwritten title and sections survive production reload @workspace-manual-live @account-mutating", async ({ page, context }) => {
  test.skip(process.env.RUN_WORKSPACE_INTENT_LIVE !== "1", "Uses the dedicated production smoke account.");
  const base = "https://www.youtubeai.chat";
  const folder = "test-results/workspace-intent";
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

  const name = "手动写作验收 " + Date.now();
  const created = await page.request.post(base + "/api/workspace/projects", { data: { name } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  expect(project.name).toBe(name);
  const endpoint = base + "/api/projects/" + project.id;
  const spaceUrl = endpoint + "/space";
  const assistantCalls: string[] = [];
  page.on("request", request => {
    if (request.url() === spaceUrl && request.method() === "POST") assistantCalls.push(request.postDataJSON().action);
  });
  const readDraft = async () => {
    const saved = await page.request.get(spaceUrl);
    expect(saved.status()).toBe(200);
    const { document }: { document: Space } = await saved.json();
    return document.drafts.find(d => d.id === document.activeDraft) ?? document.drafts[0];
  };
  try {
    await page.goto(base + "/workspace/projects/" + project.id);
    const title = page.getByRole("textbox", { name: "文稿标题", exact: true });
    const heading = page.getByRole("textbox", { name: "段落标题" });
    await title.fill("第一稿");
    await page.getByRole("textbox", { name: "文稿导语" }).fill("这是手写的开头。");
    await page.getByRole("button", { name: "添加小节" }).click();
    await expect(heading).toBeFocused();
    await heading.fill("第一节");
    const body = page.getByRole("textbox", { name: "正文 · 第一节" });
    await body.fill("这一段由作者填写。");
    const text = "这是手写的开头。\n\n## 第一节\n这一段由作者填写。";
    await expect.poll(readDraft).toMatchObject({ title: "第一稿", text });
    await page.getByRole("region", { name: "当前文稿" }).screenshot({ path: folder + "/manual-desktop.png" });
    await page.getByRole("button", { name: "全文编辑" }).click();
    await expect(page.getByRole("textbox", { name: "脚本正文" })).toHaveValue(text);
    await title.fill("手写的终稿标题");
    await expect.poll(readDraft).toMatchObject({ title: "手写的终稿标题", text });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(title).toHaveValue("手写的终稿标题");
    await expect(heading).toHaveText("第一节");
    await expect(body).toHaveText("这一段由作者填写。");
    await page.getByRole("region", { name: "当前文稿" }).screenshot({ path: folder + "/manual-mobile.png" });
    expect(assistantCalls).toEqual([]);
    console.log("Verified persisted title, introduction, section heading and body, full-text rename, and mobile reload with zero assistant calls.");
  } finally {
    expect((await page.request.delete(endpoint)).status()).toBe(204);
  }
});
