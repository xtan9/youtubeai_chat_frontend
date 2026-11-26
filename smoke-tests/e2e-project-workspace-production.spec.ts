import { expect, test } from "@playwright/test";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

test("retired bookmarks open the writing desk and retain its interface language @project-workspace", async ({page}) => {
  const email = process.env.TEST_LIVE_SUMMARY_EMAIL;
  const password = process.env.TEST_LIVE_SUMMARY_PASSWORD;
  const projectId = process.env.TEST_PROJECT_ID;
  test.skip(!email || !password || !projectId, "Requires the designated production smoke project");
  await page.goto(PROD_URL + "/auth/login");
  await page.locator("#email").fill(email!);
  await page.locator("#password").fill(password!);
  await page.getByRole("button", {name: "Login", exact: true}).click();
  await page.waitForURL(url => ["/", "/dashboard"].includes(url.pathname));
  const project = PROD_URL + "/workspace/projects/" + projectId;
  await page.goto(project + "/materials?panel=conversation&conversationId=retired");
  await expect(page).toHaveURL(project);
  await expect(page.locator(".integrated")).toBeVisible();
  await expect(page.locator(".project-head select, [data-project-action]")).toHaveCount(0);
  const picker = page.getByRole("combobox", {name: "Interface language"});

  await picker.selectOption("zh-TW");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  await expect(page.getByRole("navigation", {name: "素材列表"})).toBeVisible();
});
