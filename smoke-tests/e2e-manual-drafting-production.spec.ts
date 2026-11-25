import { richDraftJourney } from "./helpers/rich-draft-journey";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { Space } from "../lib/video-space/contract";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("rich text survives production reload @workspace-manual-live @account-mutating", async ({ page, context }) => {
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
    await richDraftJourney(page, readDraft, name => folder + "/" + name + ".png");
    expect(assistantCalls).toEqual([]);
    console.log("Verified handwritten title, heading, bold, undo/redo, list, link, table, and mobile editing after reload with zero assistant calls.");
  } finally {
    expect((await page.request.delete(endpoint)).status()).toBe(204);
  }
});
