import { expect, test } from "@playwright/test";

test("a signed-out claim link returns to the project after real login", async ({page, browser}) => {
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
  await expect(page.getByRole("textbox", {name:"Script text"})).toBeVisible();
  const project = new URL(page.url());
  const destination = project.pathname + "?claim=00000000-0000-4000-8000-000000000000";
  const context = await browser.newContext({locale:"zh-TW",viewport:{width:320,height:720}});
  try {
    const fresh = await context.newPage();
    await fresh.goto(base + destination);
    expect(new URL(fresh.url()).searchParams.get("redirect_to")).toBe(destination);
    expect(await fresh.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await fresh.locator("#email").fill(process.env.TEST_LIVE_SUMMARY_EMAIL!);
    await fresh.locator("#password").fill(process.env.TEST_LIVE_SUMMARY_PASSWORD!);
    await fresh.getByRole("button",{name:"登入",exact:true}).click();
    await expect(fresh).toHaveURL(base + destination);
    await expect(fresh.locator("html")).toHaveAttribute("lang","zh-TW");
  } finally {
    await context.close();
  }
  } finally {
    if (created) {
      const deletion = await page.request.delete(base + "/api/projects/" + created);
      expect(deletion.status()).toBe(204);
      console.log("Temporary localization project removed");
    }
  }
});
