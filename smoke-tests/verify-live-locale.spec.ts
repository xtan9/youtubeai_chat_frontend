import { expect, test } from "@playwright/test";

test("signed-in pages update in place and remember the interface language", async ({page}) => {
  test.setTimeout(120_000);
  const base = "https://www.youtubeai.chat";
  await page.goto(base + "/auth/login");
  await page.locator("#email").fill(process.env.TEST_LIVE_SUMMARY_EMAIL!);
  await page.locator("#password").fill(process.env.TEST_LIVE_SUMMARY_PASSWORD!);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(url => ["/", "/dashboard"].includes(url.pathname));

  const headings = {
    dashboard: ["最近观看", "最近觀看", "Recent"],
    history: ["你的摘要", "你的摘要", "Your summaries"],
    account: ["账户", "帳戶", "Account"],
  };
  for (const [path, labels] of Object.entries(headings)) {
    await page.goto(base + "/" + path);
    for (const [index, locale] of ["zh", "zh-TW", "en"].entries()) {
      await page.locator("header select").selectOption(locale);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", {name:labels[index], exact:true})).toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", {name:labels[index], exact:true})).toBeVisible();
      await expect(page.locator("header select")).toHaveValue(locale);
    }
  }
});
