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
  let created: string | undefined;
  try {
  if (!(await link.count())) {
    const name = "Interface language smoke " + Date.now();
    const response = await page.request.post(base + "/api/workspace/projects", {data:{name,goal:""}});
    expect(response.ok(), "Temporary project creation returned " + response.status()).toBeTruthy();
    const project = (await response.json()).project;
    expect(project.name).toBe(name);
    created = project.id;
    await page.reload();
  }
  await expect(link).toBeVisible();
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
  } finally {
    if (created) {
      const deletion = await page.request.delete(base + "/api/projects/" + created);
      expect(deletion.status()).toBe(204);
      console.log("Temporary localization project removed");
    }
  }
});
