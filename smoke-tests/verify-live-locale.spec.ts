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
  const summaryLink = page.locator('a[href^="/summary?url="]').first();
  if (await summaryLink.count()) {
    await summaryLink.click();
    for (const [locale,tab] of [["zh","摘要"], ["zh-TW","摘要"], ["en","Summary"]]) {
      await page.locator("header select").selectOption(locale);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("tab", {name:tab,exact:true})).toBeVisible();
    }
    console.log("Verified saved summary tabs in all three languages");
  } else {
    console.log("Test account has no saved summary to reopen");
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
  await page.goto(base + "/summary?url=" + encodeURIComponent("https://www.youtube.com/watch?v=jNQXAC9IVRw"));
  const reading = page.getByTestId("summary-markdown-surface");
  await expect(reading).toBeVisible({timeout:135000});
  const source = await reading.innerText();
  expect(source.length).toBeGreaterThan(30);
  for (const [locale,summary,chat] of [["zh","摘要","对话"],["zh-TW","摘要","對話"],["en","Summary","Chat"]]) {
    await page.locator("header select").selectOption(locale);
    await expect(page.locator("html")).toHaveAttribute("lang",locale);
    await page.getByRole("tab",{name:chat,exact:true}).click();
    await page.getByRole("tab",{name:summary,exact:true}).click();
    await expect(reading).toHaveText(source,{useInnerText:true});
  }
  await page.goto(base + "/history");
  const link = page.locator('a[href^="/summary?url="][href*="jNQXAC9IVRw"]').first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(reading).toHaveText(source,{useInnerText:true});
});
