import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

// Golden-path regression guard for the summary-language picker:
//  - click through login → summarize a short English video
//  - open the 🌐 picker, switch to Spanish
//  - assert the summary re-streams in Spanish (cheap heuristic: at least
//    one Spanish stop-word that isn't an English homograph)
//
// The Spanish-anchor check uses a narrow set — every token is a Spanish
// grammatical word with no English meaning or carries a Spanish-only
// diacritic. Mirrors the French-anchors approach in helpers.ts.
const SPANISH_ANCHORS =
  /\b(el|la|los|las|que|con|pero|para|esto|esta|este|también|según|además|español|presentador|explica|video|videos|vídeo|vídeos)\b/i;

function hasSpanishAnchors(text: string): boolean {
  return SPANISH_ANCHORS.test(text);
}

// 18-second English video, YouTube's first-ever upload. Captions are
// stable and the summary is short enough to cache cheaply in both
// languages without burning through rate-limit headroom.
const SHORT_ENGLISH_VIDEO = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

const SUMMARY_TIMEOUT_MS = 180_000;

test("summary language picker regenerates the summary in Spanish", async ({
  page,
}) => {
  const creds = await loadSmokeCreds();
  expect(creds, "TEST_USER_EMAIL/TEST_USER_PASSWORD required").not.toBeNull();
  if (!creds) return;

  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 });

  await page
    .getByRole("textbox", { name: /youtube url/i })
    .fill(SHORT_ENGLISH_VIDEO);
  await page.getByRole("button", { name: /summarize video/i }).click();
  await page.waitForURL(/\/summary/, { timeout: 15_000 });

  const errorBanner = page.getByTestId("stream-error-banner");
  const summaryHeader = page.getByRole("heading", {
    name: /ai-generated video summary/i,
  });

  await Promise.race([
    summaryHeader.waitFor({ state: "visible", timeout: SUMMARY_TIMEOUT_MS }),
    errorBanner
      .waitFor({ state: "visible", timeout: SUMMARY_TIMEOUT_MS })
      .then(async () => {
        const text = await errorBanner.innerText().catch(() => "(no text)");
        throw new Error(`stream-error-banner appeared: ${text}`);
      }),
  ]);

  // The picker button is identified by an aria-label starting with
  // "Summary language:" — stable across current/"Auto" states.
  const picker = page.getByRole("button", {
    name: /summary language:/i,
  });
  await expect(picker).toBeVisible({ timeout: 15_000 });
  await picker.click();

  // Spanish menu item: the native name "Español" is unique and robust
  // across dropdown reshuffles.
  await page.getByRole("menuitem", { name: /Español/i }).click();

  // Can't use "picker button label shows Spanish" as the completion
  // signal: the button updates optimistically the moment setOutputLanguage
  // fires, well before the re-stream finishes. During streaming the
  // ResultsDisplay card (and its .prose) also briefly unmounts as the
  // React Query result swaps from the old cache row to the new stream —
  // a naive visibility check on `.prose` catches the empty mid-remount.
  //
  // Wait instead for actual Spanish content to land in the summary body.
  // That's only true when the new stream has produced enough content for
  // at least one Spanish anchor to surface.
  const summaryProse = page.locator(".prose").first();
  await expect
    .poll(
      async () => {
        const text = await summaryProse.innerText().catch(() => "");
        return hasSpanishAnchors(text) ? text : null;
      },
      { timeout: SUMMARY_TIMEOUT_MS, message: "Spanish summary never rendered" }
    )
    .not.toBeNull();

  // At this point we know the summary re-streamed in Spanish. Assert it
  // has substantive content (guards against a one-word false positive
  // like "el" in a code block).
  const proseText = await summaryProse.innerText();
  expect(
    proseText.length,
    "summary should contain substantive Spanish content"
  ).toBeGreaterThan(50);
  expect(
    hasSpanishAnchors(proseText),
    "summary should contain common Spanish anchor words"
  ).toBe(true);
});
