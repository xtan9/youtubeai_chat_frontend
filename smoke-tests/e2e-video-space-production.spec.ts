import { expect, test } from "@playwright/test";

// Same login contract as the production Project Conversation smoke. The
// explicitly designated seed-oil QA Space retains the new run and script.
test("creator investigates and writes in the deployed Video Space @video-space-live @account-mutating", async ({
  page,
}) => {
  const email = process.env.TEST_LIVE_SUMMARY_EMAIL,
    password = process.env.TEST_LIVE_SUMMARY_PASSWORD;
  const id = process.env.TEST_VIDEO_SPACE_ID,
    base = process.env.PROD_URL || "https://www.youtubeai.chat";
  test.skip(
    !email || !password || !id,
    "Requires the designated seed-oil QA Space and registered account",
  );
  test.setTimeout(440000);
  await page.goto(base + "/auth/login");
  await page.locator("#email").fill(email!);
  await page.locator("#password").fill(password!);
  await Promise.all([
    page.waitForURL((u) => ["/", "/dashboard"].includes(u.pathname)),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);
  await page.goto(base + "/new-workspace/projects/" + id);
  const left = page.getByRole("region", { name: "研究台", exact: true }),
    right = page.getByRole("region", { name: "创作搭档", exact: true });
  await page.getByRole("button", { name: "新建脚本" }).click();
  const draft = await page.getByLabel("当前脚本").inputValue();
  const editor = page.getByLabel("脚本正文");
  const opening = "两个视频都在讲种子油。它们在比较同一件事吗？";
  await editor.fill(opening);
  const claims = left.getByText(/^关键观点 ·/).first();
  await expect(claims).toBeVisible({ timeout: 90000 });
  await claims.click();
  const [research] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/research") && r.request().method() === "POST",
      { timeout: 300000 },
    ),
    left.getByRole("button", { name: "继续深究" }).first().click(),
  ]);
  expect(research.ok()).toBeTruthy();
  await left
    .getByRole("button", { name: "查看证据", exact: true })
    .last()
    .click();
  const finding = left.locator("[data-selected=true]");
  await expect(finding.getByText("判断把握", { exact: true })).toBeVisible();
  await finding.getByText("调查发现与出处").click();
  const url = await finding
    .locator('a[href^="https://europepmc.org/article/"]')
    .first()
    .getAttribute("href");
  expect(url).toBeTruthy();
  const publication = await page.context().newPage();
  expect((await publication.goto(url!))?.ok()).toBeTruthy();
  await publication.close();
  await finding.getByRole("button", { name: "交给创作搭档" }).click();
  await right.getByRole("button", { name: "写进开场" }).last().click();
  await expect(editor).not.toHaveValue(opening, { timeout: 90000 });
  const script = await editor.inputValue();
  expect(script.startsWith(opening)).toBeTruthy();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel("当前脚本").selectOption(draft);
  await expect(editor).toHaveValue(script);
});
