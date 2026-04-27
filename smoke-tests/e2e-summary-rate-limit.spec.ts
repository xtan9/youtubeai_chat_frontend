import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

// Force the rate-limit branch by intercepting and returning the same
// 429 the orchestrator returns when the per-user limit is hit. This
// avoids actually exhausting the prod limit (which would lock out the
// test user for the rest of the day).
test("429 response surfaces rate-limit / paywall UI", async ({ page }) => {
  const creds = await loadSmokeCreds();
  test.skip(!creds, "TEST_USER_EMAIL/TEST_USER_PASSWORD required");
  if (!creds) return;

  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 }),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);

  await page.route("**/api/summarize/stream", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Rate limit exceeded. Please upgrade or try again later.",
      }),
    })
  );

  await page.goto(
    `${PROD_URL}/summary?url=${encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ")}`,
    { waitUntil: "domcontentloaded" }
  );

  const limitUi = page.getByText(/rate.?limit|upgrade|too many requests/i);
  await expect(limitUi).toBeVisible({ timeout: 30_000 });
});
