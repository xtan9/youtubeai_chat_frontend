import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

async function login(page: import("@playwright/test").Page) {
  const creds = await loadSmokeCreds();
  if (!creds) return null;
  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 }),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);
  return creds;
}

test("invalid YouTube URL surfaces a user-visible error", async ({ page }) => {
  const creds = await login(page);
  test.skip(!creds, "TEST_USER_EMAIL/TEST_USER_PASSWORD required");
  if (!creds) return;

  await page.goto(
    `${PROD_URL}/summary?url=${encodeURIComponent("https://example.com/not-a-video")}`,
    { waitUntil: "domcontentloaded" }
  );

  const errorBanner = page
    .getByTestId("stream-error-banner")
    .or(page.getByText(/invalid.*url|could not.*load|error/i));
  await expect(errorBanner).toBeVisible({ timeout: 30_000 });
});

test("upstream summary failure (intercepted) surfaces error UI", async ({
  page,
}) => {
  const creds = await login(page);
  test.skip(!creds, "TEST_USER_EMAIL/TEST_USER_PASSWORD required");
  if (!creds) return;

  // Force the streaming endpoint to return 502 on the next call, then
  // navigate. Asserts the UI degrades to the error banner rather than
  // silently spinning forever.
  await page.route("**/api/summarize/stream", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ message: "intercepted: simulated upstream 502" }),
    })
  );

  await page.goto(
    `${PROD_URL}/summary?url=${encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ")}`,
    { waitUntil: "domcontentloaded" }
  );

  const errorBanner = page
    .getByTestId("stream-error-banner")
    .or(page.getByText(/error|failed|try again/i));
  await expect(errorBanner).toBeVisible({ timeout: 30_000 });
});
