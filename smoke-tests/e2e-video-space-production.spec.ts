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
  await page.context().addCookies([{name: "locale", value: "zh", url: base}]);
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
  const details = claims.locator("..");
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open)))
    await claims.click();
  await details.getByRole("button").first().click();
  const room = page.getByRole("region", { name: "观点空间" });
  const [research] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/research") && r.request().method() === "POST",
      { timeout: 300000 },
    ),
    room.getByRole("button", { name: "查找证据" }).click(),
  ]);
  expect(research.ok()).toBeTruthy();
  await room.getByRole("button", { name: "查看本次证据" }).last().click();
  const finding = room.locator("[data-selected=true]");
  await finding.getByText("核查范围与判断依据").click();
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
  await room
    .getByLabel("研究问题")
    .fill("这份摘要里的证据能回答原观点的哪一部分？");
  const [discussion] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/space") &&
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.action === "discussClaim",
      { timeout: 100000 },
    ),
    room.getByRole("button", { name: "发送", exact: true }).click(),
  ]);
  expect(discussion.ok()).toBeTruthy();
  await expect(
    room.getByText("这份摘要里的证据能回答原观点的哪一部分？", { exact: true }),
  ).toBeVisible();
  await room.getByRole("button", { name: "交给创作搭档" }).click();
  await page.getByRole("button", { name: "返回项目工作台" }).click();
  await right.getByRole("button", { name: "写进开场" }).last().click();
  await expect(editor).not.toHaveValue(opening, { timeout: 90000 });
  const script = await editor.inputValue();
  expect(script.startsWith(opening)).toBeTruthy();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel("当前脚本").selectOption(draft);
  await expect(editor).toHaveValue(script);
});
