import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

const TEST_VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const SUMMARY_TIMEOUT_MS = 300_000;

test("landing page → input form → summary streaming", async ({ page }) => {
  // Override the global 240s cap — cold-cache Whisper transcription can take
  // 4-5 minutes on prod. The inner SUMMARY_TIMEOUT_MS is aligned with this.
  test.setTimeout(360_000);
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

  // Should already be on home after login. Confirm the input form is rendered.
  await expect(
    page.getByRole("textbox", { name: /youtube url/i })
  ).toBeVisible();

  await page.getByRole("textbox", { name: /youtube url/i }).fill(TEST_VIDEO);
  await Promise.all([
    page.waitForURL(/\/summary/, { timeout: 15_000 }),
    page.getByRole("button", { name: /summarize video/i }).click(),
  ]);

  // Wait for streamed summary to render
  await page.waitForSelector(".prose p", { timeout: SUMMARY_TIMEOUT_MS });

  const summaryText = await page.evaluate(() => {
    const els = document.querySelectorAll(".prose p, .prose li");
    return Array.from(els).map((el) => el.textContent || "").join(" ");
  });
  expect(summaryText.length).toBeGreaterThan(50);
});
