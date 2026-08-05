import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";
import { waitForLiveSummarySuccess } from "./live-summary";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

const SUMMARY_TIMEOUT_MS = 240_000;

const HAN = /\p{Script=Han}/u;

// xMZqTuLWSA4 is the original bug-report video from the zh-caption fix
// (BCP-47 primary-subtag retry in the VPS captions adapter). If this
// case ever fails, that fix has regressed.
//
// Japanese coverage was originally planned alongside Chinese but the
// candidate URL had no usable Japanese captions and timed the suite
// out. Same bug class would affect ja-* tracks — when a verified
// Japanese URL is available, add a HIRAGANA case.
const CASES: Array<{ url: string; label: string; matcher: RegExp }> = [
  {
    url: "https://www.youtube.com/watch?v=xMZqTuLWSA4",
    label: "Chinese (Mandarin)",
    matcher: HAN,
  },
];

for (const { url, label, matcher } of CASES) {
  test(`${label} video produces a summary in source script @live-summary`, async ({
    page,
  }) => {
    const creds = await loadSmokeCreds();
    expect(creds, "TEST_NON_ADMIN_EMAIL/TEST_NON_ADMIN_PASSWORD required").not.toBeNull();
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

    await page.goto(
      `${PROD_URL}/summary?url=${encodeURIComponent(url)}`,
      { waitUntil: "domcontentloaded" }
    );

    const summaryProse = page.locator(".prose").first();

    await waitForLiveSummarySuccess({
      page,
      success: expect(
        summaryProse,
        `summary should contain ${label} script characters`,
      ).toContainText(matcher, { timeout: SUMMARY_TIMEOUT_MS }),
      terminalTimeoutMs: SUMMARY_TIMEOUT_MS,
    });
  });
}
