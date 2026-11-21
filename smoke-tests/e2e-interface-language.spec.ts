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
