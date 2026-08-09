import { expect, test } from "@playwright/test";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

test("real Project Conversation completes the production grounded-answer path @project-grounded @account-mutating", async ({
  page,
}) => {
  const email = process.env.TEST_LIVE_SUMMARY_EMAIL?.trim();
  const password = process.env.TEST_LIVE_SUMMARY_PASSWORD?.trim();
  const projectId = process.env.TEST_PROJECT_ID?.trim();
  test.skip(
    !email || !password || !projectId,
    "TEST_LIVE_SUMMARY_EMAIL/TEST_LIVE_SUMMARY_PASSWORD/TEST_PROJECT_ID required",
  );
  if (!email || !password || !projectId) return;

  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL(
      (url) => url.pathname === "/" || url.pathname === "/dashboard",
      { timeout: 15_000 },
    ),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);

  const response = await page.goto(
    `${PROD_URL}/workspace/projects/${projectId}`,
  );
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Project Conversation" }),
  ).toBeVisible();
  const question = page.getByLabel("Ask the Project");
  await expect(question).toBeEnabled();
  await question.fill("What does the Project evidence support?");
  await page.getByRole("button", { name: "Ask Project" }).click();

  await expect(page.getByText("Grounded Answer", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByLabel("Source Coverage")).toBeVisible();
  await expect(page.getByText(/Evidence supported|Abstained|Unsupported by sources/)).toBeVisible();
});
