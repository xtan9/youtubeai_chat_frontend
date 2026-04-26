import { test, expect } from "@playwright/test";
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

  // The banner is the terminal UI when the stream errors (e.g., LLM
  // gateway 502, the exact Haiku-outage regression class). Race the two
  // outcomes so the test fails within seconds of a banner appearing
  // instead of waiting the full 180s transcript budget.
  const errorBanner = page.getByTestId("stream-error-banner");
  // PR #26 replaced the static transcript card with a paragraph view that
  // exposes data-testid="transcript-container" on the scrollable wrapper.
  const transcript = page.getByTestId("transcript-container");

  await Promise.race([
    transcript.waitFor({ state: "visible", timeout: SUMMARY_TIMEOUT_MS }),
    errorBanner
      .waitFor({ state: "visible", timeout: SUMMARY_TIMEOUT_MS })
      .then(async () => {
        const text = await errorBanner.innerText().catch(() => "(no text)");
        throw new Error(`stream-error-banner appeared: ${text}`);
      }),
  ]);
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
  // run the same check. The summary + transcript together cover the
  // "summary speaks the right language" claim in the original bug.
  // Note: hasFrenchAnchors on body text is unreliable because English UI
  // chrome dominates word counts — keep the French-anchor check on the
  // transcript (unambiguously content, not chrome) only.
  const bodyText = await page.locator("body").innerText();
  expect(
    hasArabicChars(bodyText),
    "summary/page must not contain Arabic script"
  ).toBe(false);
});
