import {expect, test} from "@playwright/test";

test("pricing cards, checkout choices and FAQs switch together", async ({page}) => {
  await page.goto((process.env.BASE_URL || "http://localhost:3000") + "/pricing");
  for (const [locale, title, monthly, choose, question, manage] of [
    ["zh", "方案与价格", "Pro 月付版", "选择月付", "我可以随时取消吗？", "方案与账单"],
    ["zh-TW", "方案與價格", "Pro 月付版", "選擇月付", "我可以隨時取消嗎？", "方案與帳單"],
    ["en", "Simple pricing", "Pro Monthly", "Choose monthly", "Can I cancel anytime?", "Plan & Billing"],
  ]) {
    await page.locator("header select").selectOption(locale);
    await expect(page.getByRole("heading", {name: title, exact: true})).toBeVisible();
    await expect(page.getByRole("heading", {name: monthly})).toBeVisible();
    await expect(page.getByRole("button", {name: choose})).toBeVisible();
    const faq = page.locator("details").filter({has: page.getByText(question, {exact:true})});
    if (await faq.getAttribute("open") === null) await faq.locator("summary").click();
    await expect(faq.getByRole("link", {name: manage})).toHaveAttribute("href", "/account/billing");
  }
});
