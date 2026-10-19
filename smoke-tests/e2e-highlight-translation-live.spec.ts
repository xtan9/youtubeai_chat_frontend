import { expect, test } from "@playwright/test";
import { loadLiveSummaryCreds } from "./helpers";
import { waitForLiveSummarySuccess } from "./live-summary";

const PROD_URL = (process.env.PROD_URL?.trim() || "https://www.youtubeai.chat").replace(/\/$/, "");
const VIDEO_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

// Opt in after deployment with the dedicated paid Smoke Account. No auth,
// Summary, database, or LLM interception: this covers the real product path.
test("paid learner translates a saved Summary with real AI @live-highlight-translation", async ({ page }) => {
  test.skip(process.env.RUN_LIVE_HIGHLIGHT_TRANSLATION !== "1", "Opt-in paid AI smoke");
  const credentials = await loadLiveSummaryCreds();
  expect(credentials, "Dedicated TEST_LIVE_SUMMARY_EMAIL/PASSWORD are required").not.toBeNull();
  if (!credentials) return;
  await page.goto(PROD_URL + "/auth/login");
  await page.fill("#email", credentials.email);
  await page.fill("#password", credentials.password);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForURL(url => url.pathname === "/" || url.pathname === "/dashboard");

  await page.goto(PROD_URL + "/summary?url=" + encodeURIComponent(VIDEO_URL));
  const summary = page.getByTestId("summary-markdown-surface");
  await waitForLiveSummarySuccess({
    page, success: expect(summary).toBeVisible({ timeout: 180_000 }), terminalTimeoutMs: 180_000,
  });
  const toggle = page.getByRole("switch", { name: "Highlight to translate" });
  await expect(toggle).toBeVisible();
  await page.getByLabel("Translate to:").selectOption("zh");
  if (await toggle.getAttribute("aria-checked") !== "true") await toggle.click();
  await expect(toggle).toBeChecked();
  const passage = summary.locator("[data-translation-block]").filter({ hasText: /[A-Za-z]{5}/ }).first();
  await passage.scrollIntoViewIfNeeded();
  await passage.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const word = /[A-Za-z]{5,}/.exec(node.textContent ?? "");
      if (!word) continue;
      const range = document.createRange();
      range.setStart(node, word.index);
      range.setEnd(node, word.index + word[0].length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return;
    }
    throw new Error("No source word in the saved Summary");
  });
  const card = page.getByRole("region", { name: "Highlight translation" });
  // Allow equivalent model wording: require translated text and a contextual
  // explanation, not an exact phrase that changes with model revisions.
  await expect(card.locator('p[lang="zh"]').first()).toContainText(/\p{Script=Han}/u, { timeout: 30_000 });
  await expect(card.locator('p[lang="zh"]').nth(1)).toContainText(/\p{Script=Han}/u);
  await expect(card.getByText("Meaning in this passage")).toBeVisible();
  await expect(card.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
});
