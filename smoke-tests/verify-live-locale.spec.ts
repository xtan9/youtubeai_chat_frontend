import { expect, test } from "@playwright/test";

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
    try { await expect(page.locator("html")).toHaveAttribute("lang",locale,{timeout:6000}); }
    catch {
      console.log("Stale language in reader", locale, await page.locator("html").getAttribute("lang"), "cookie", (await page.context().cookies()).find(c=>c.name==="locale")?.value);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang",locale);
    }
    await page.getByRole("tab",{name:chat,exact:true}).click();
    await expect(page.getByRole("tab",{name:chat,exact:true})).toHaveAttribute("aria-selected","true");
    await page.getByRole("tab",{name:summary,exact:true}).click();
    await expect(page.getByRole("tab",{name:summary,exact:true})).toHaveAttribute("aria-selected","true");
    await expect(reading).toHaveText(source,{useInnerText:true});
  }
  console.log("Verified summary and chat tabs and preserved summary body");
  await page.goto(base + "/history");
  const link = page.locator('a[href^="/summary?url="][href*="jNQXAC9IVRw"]').first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(reading).toHaveText(source,{useInnerText:true});
});
