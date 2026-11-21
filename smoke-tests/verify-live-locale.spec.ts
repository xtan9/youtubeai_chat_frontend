import { expect, test } from "@playwright/test";

test("mobile workspace, menu and project editor follow the selected interface language", async ({page}) => {
  test.setTimeout(180_000);
  const base = "https://www.youtubeai.chat";
  await page.goto(base + "/auth/login");
  await page.locator("#email").fill(process.env.TEST_LIVE_SUMMARY_EMAIL!);
  await page.locator("#password").fill(process.env.TEST_LIVE_SUMMARY_PASSWORD!);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(url => ["/", "/dashboard"].includes(url.pathname));

  await page.setViewportSize({width:390, height:844});
  await page.goto(base+"/new-workspace");
  let temp;
  try {
    const first = page.locator('a[href^="/new-workspace/projects/"]').first();
    if (!await first.count()) {
      const r = await page.request.post(base+"/api/workspace/projects",{data:{name:"Localization acceptance "+Date.now(),goal:""}});
      expect(r.ok()).toBeTruthy();
      temp=(await r.json()).project.id;
      await page.reload();
    }
    for(const [lang, heading, editor] of [["zh","视频项目","脚本正文"],["zh-TW","影片專案","腳本正文"],["en","Video Spaces","Script text"]]){
      await page.goto(base+"/dashboard");
      await page.locator('[aria-controls="mobile-primary-navigation"]').click();
      await page.locator("header select").selectOption(lang);
      await expect(page.locator("html")).toHaveAttribute("lang",lang);
      console.log(lang,"mobile menu", await page.locator("#mobile-primary-navigation").allInnerTexts());
      await page.goto(base+"/new-workspace");
      await expect(page.getByRole("heading",{name:heading,exact:true})).toBeVisible();
      await first.click();
      await expect(page.getByRole("textbox",{name:editor})).toBeAttached();
      console.log(lang,"mobile project width",await page.evaluate(()=>document.documentElement.scrollWidth));
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang",lang);
      await expect(page.getByRole("textbox",{name:editor})).toBeAttached();
    }
  } finally {
    if (temp) expect((await page.request.delete(base+"/api/projects/"+temp)).status()).toBe(204);
  }
});
