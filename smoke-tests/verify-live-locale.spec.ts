import { expect, test } from "@playwright/test";

test("production smoke account can reopen a project in each interface language", async ({page}) => {
  const base = "https://www.youtubeai.chat";
  await page.goto(base + "/auth/login");
  await page.locator("#email").fill(process.env.TEST_LIVE_SUMMARY_EMAIL!);
  await page.locator("#password").fill(process.env.TEST_LIVE_SUMMARY_PASSWORD!);
  await page.getByRole("button", {name:"Login",exact:true}).click();
  await page.waitForURL(url => ["/", "/dashboard"].includes(url.pathname));
  await page.goto(base + "/new-workspace");
  await expect(page.getByRole("heading", {name:"Video Spaces"})).toBeVisible();
  const link = page.locator('a[href^="/new-workspace/projects/"]').first();
  await expect(link, "The smoke account needs an existing project").toBeVisible();
  await link.click();
  for (const [locale,script,directory] of [
    ["en","Script text","Source directory"], ["zh","脚本正文","素材目录"], ["zh-TW","腳本正文","素材目錄"],
  ]) {
    await page.locator("header select").first().selectOption(locale);
    await expect(page.locator("html")).toHaveAttribute("lang",locale);
    await expect(page.getByRole("textbox",{name:script,exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole("navigation",{name:directory,exact:true})).toBeVisible();
    await expect(page.locator("header select").first()).toHaveValue(locale);
    console.log("Production project opened and reloaded in",locale);
  }
});
