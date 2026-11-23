import { expect, test } from "@playwright/test";

test("signed-in pages update in place and remember the interface language", async ({page}) => {
  test.setTimeout(180_000);
  const base = "https://www.youtubeai.chat";
  await page.goto(base + "/auth/login");
  await page.locator("#email").fill(process.env.TEST_LIVE_SUMMARY_EMAIL!);
  await page.locator("#password").fill(process.env.TEST_LIVE_SUMMARY_PASSWORD!);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(url => ["/", "/dashboard"].includes(url.pathname));

  const headings = {
    dashboard: ["最近观看", "最近觀看", "Recent"],
    history: ["你的摘要", "你的摘要", "Your summaries"],
    "account/billing": ["方案与账单", "方案與帳單", "Plan & Billing"],
    "billing/canceled": ["结账已取消", "結帳已取消", "No worries"],
    "billing/success": ["无法验证结账结果", "無法驗證結帳結果", "Checkout return unavailable"],
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
  await page.goto(base + "/history");
});

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

test("real summary retains source content across language changes and history reopen", async ({page}) => {
  test.setTimeout(230000);
  const base = "https://www.youtubeai.chat";
  await page.goto(base + "/auth/login");
  await page.locator("#email").fill(process.env.TEST_LIVE_SUMMARY_EMAIL!);
  await page.locator("#password").fill(process.env.TEST_LIVE_SUMMARY_PASSWORD!);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL(url => ["/", "/dashboard"].includes(url.pathname));
  await page.goto(base + "/dashboard");
  await page.locator("input[name=url]").fill("https://www.youtube.com/watch?v=jNQXAC9IVRw");
  await page.locator("input[name=url]").press("Enter");
  await page.waitForURL(url=>url.pathname==="/summary");
  const reading = page.getByTestId("summary-markdown-surface");
  await expect(reading).toBeVisible({timeout:135000});
  const source = await reading.innerText();
  expect(source.length).toBeGreaterThan(30);
  for (const [locale,summary,chat] of Array(3).fill([["zh","摘要","对话"],["zh-TW","摘要","對話"],["en","Summary","Chat"]]).flat()) {
    await page.locator("header select").selectOption(locale);
    await expect(page.locator("html")).toHaveAttribute("lang",locale);
    await page.getByRole("tab",{name:chat,exact:true}).click();
    await page.getByRole("tab",{name:summary,exact:true}).click();
    await expect(reading).toHaveText(source,{useInnerText:true});
  }
  console.log("Verified summary and chat tabs and preserved summary body");
  await page.goto(base + "/history");
  const link = page.locator('a[href^="/summary?url="][href*="jNQXAC9IVRw"]').first();
  console.log("History state", JSON.stringify({
    path:new URL(page.url()).pathname,summaryLinks:await page.locator('a[href*="/summary?"]').count(),
    headings:await page.locator("main h1,main h2").allInnerTexts(),
    alert:await page.locator("main [role=alert]").allInnerTexts(),
    unavailable:await page.getByText(/couldn.t load|could not load|unable to load/i).count(),
  }));
  await expect(link).toBeVisible();
  await link.click();
  await expect(reading).toHaveText(source,{useInnerText:true});
});
