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
  test.skip(!creds, "TEST_NON_ADMIN_EMAIL/TEST_NON_ADMIN_PASSWORD required");
  if (!creds) return;

  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL(
      (url) => url.pathname === "/" || url.pathname === "/dashboard",
      { timeout: 15_000 },
    ),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);

  // Mirror the real prod 429 payload from app/api/summarize/stream/route.ts.
  // The adapter intentionally converts this private payload into stable,
  // user-safe copy before rendering it.
  await page.route("**/api/summarize/stream", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Rate limit exceeded. Please try again later.",
      }),
    })
  );

  await page.goto(
    `${PROD_URL}/summary?url=${encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ")}`,
    { waitUntil: "domcontentloaded" }
  );

  // Assert the adapter's stable, user-safe copy rather than the private API
  // payload. This also avoids false positives from unrelated page chrome.
  const limitUi = page.getByText(
    "Too many summary requests. Please wait a moment and try again."
  );
  await expect(limitUi).toBeVisible({ timeout: 30_000 });
});
