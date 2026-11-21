import { expect, test } from "@playwright/test";

const base = process.env.BASE_URL || "http://localhost:3000";

test.use({ viewport: { width: 320, height: 720 } });

test("localized account pages fit a narrow phone and retain the project return link", async ({page}) => {
  const destination = "/new-workspace/projects/00000000-0000-4000-8000-000000000000?claim=example";
  await page.goto(base + destination);
  expect(new URL(page.url()).searchParams.get("redirect_to")).toBe(destination);
  for (const [locale, forgot, reset, thanks] of [
    ["zh", "忘记密码？", "重置密码", "感谢注册！"],
    ["zh-TW", "忘記密碼？", "重設密碼", "感謝註冊！"],
    ["en", "Forgot your password?", "Reset Your Password", "Thank you for signing up!"],
  ]) {
    await page.goto(base + destination);
    await page.locator("header select").selectOption(locale);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await page.getByRole("link", {name: forgot}).click();
    await expect(page.getByText(reset, {exact:true})).toBeVisible();
    expect(new URL(page.url()).searchParams.get("redirect_to")).toBe(destination);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.goto(base + "/auth/update-password");
    await expect(page.getByText(reset, {exact:true})).toBeVisible();
    await page.goto(base + "/auth/sign-up-success");
    await expect(page.getByRole("heading", {name:thanks})).toBeVisible();
  }
});

test("homepage content and demo controls follow the interface language", async ({page}) => {
  await page.goto(base);
  const summary = page.locator('button[role="tab"][value="summary"], [role=tab]').first();
  for (const [locale,title,tab,placeholder,question] of [
    ["zh", "用 AI 总结 YouTube 视频", "摘要", "粘贴 YouTube 视频链接…", "这个工具有哪些特点？"],
    ["zh-TW", "用 AI 總結 YouTube 影片", "摘要", "貼上 YouTube 影片連結…", "這個工具有哪些特點？"],
    ["en", "Summarize YouTube Videos with AI", "Summary", "Enter YouTube URL here...", "What makes YouTube AI Chat unique?"],
  ]) {
    await page.locator("header select").selectOption(locale);
    await expect(page.getByRole("heading", {name:title,exact:true})).toBeVisible();
    await expect(summary).toHaveText(tab);
    await expect(page.getByPlaceholder(placeholder)).toBeVisible();
    await expect(page.getByRole("button",{name:question})).toBeVisible();
    const schema = await page.locator("#structured-data-faq").textContent();
    expect(JSON.parse(schema!).mainEntity[0].name).toBe(question);
  }
});
