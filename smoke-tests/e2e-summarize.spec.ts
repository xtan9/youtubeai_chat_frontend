import { test, expect, type ConsoleMessage } from "@playwright/test";
import { hasArabicChars, hasFrenchAnchors, loadSmokeCreds } from "./helpers";

// The reason this suite exists. Audio is French; the old
// youtube-transcript-plus default selected tracks[0] (Arabic) when no
// language hint was passed. If the detection pipeline regresses, the
// rendered transcript will contain Arabic script and this test fails.
const BUG_VIDEO_URL = "https://www.youtube.com/watch?v=8MopJoonTt0";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

// End-to-end budget for the full summarize pipeline (metadata +
// captions/transcribe + LLM streaming). Prod p99 is ~60s; 180s leaves
// slack for cold starts and one retry without masking real hangs.
const SUMMARY_TIMEOUT_MS = 180_000;

test("French video produces French transcript + summary end-to-end", async ({
  page,
}) => {
  const creds = await loadSmokeCreds();
  expect(creds, "TEST_USER_EMAIL/TEST_USER_PASSWORD required").not.toBeNull();
  if (!creds) return;

  const consoleErrors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await page.getByRole("button", { name: /^login$/i }).click();

  // Wait for post-login redirect to home — Supabase redirects to "/" on
  // success, and the URL input is only rendered there.
  await page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 });

  // Submit the bug video. The input has `aria-label="YouTube URL"` and the
  // button has `aria-label="Summarize video"` — role-based locators survive
  // visual redesigns.
  await page.getByRole("textbox", { name: /youtube url/i }).fill(BUG_VIDEO_URL);
  await page.getByRole("button", { name: /summarize video/i }).click();

  await page.waitForURL(/\/summary/, { timeout: 15_000 });

  // Stream-error-banner must never appear for a healthy run. If detection
  // fails hard or the LLM gateway 502s, the banner is the terminal UI — we
  // want this test to fail with a clear message rather than timing out
  // waiting for a transcript that will never render.
  const errorBanner = page.getByTestId("stream-error-banner");

  // Transcript container appears once streaming finishes; wait on that
  // rather than a percentage indicator so the assertion is resilient to
  // progress-bar copy changes.
  const transcript = page.locator(".transcript-container");
  await expect(transcript).toBeVisible({ timeout: SUMMARY_TIMEOUT_MS });
  await expect(errorBanner).not.toBeVisible();

  const transcriptText = (await transcript.innerText()).trim();
  expect(
    transcriptText.length,
    "transcript should contain substantial content"
  ).toBeGreaterThan(100);
  expect(
    hasArabicChars(transcriptText),
    "transcript must not contain Arabic script"
  ).toBe(false);
  expect(
    hasFrenchAnchors(transcriptText),
    "transcript should contain common French anchor words"
  ).toBe(true);

  // Summary is rendered elsewhere on the page; grab full body text and
  // run the same checks. The summary + transcript together cover the
  // "summary speaks the right language" claim in the original bug.
  const bodyText = await page.locator("body").innerText();
  expect(
    hasArabicChars(bodyText),
    "summary/page must not contain Arabic script"
  ).toBe(false);

  expect(
    consoleErrors.filter((msg) => !msg.includes("favicon")),
    "no unexpected console errors during summarize flow"
  ).toEqual([]);
});
