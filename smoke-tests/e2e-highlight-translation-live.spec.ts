import { expect, test, type Locator, type Page } from "@playwright/test";
import { loadLiveSummaryCreds } from "./helpers";
import { waitForLiveSummarySuccess } from "./live-summary";

const PROD_URL = (process.env.PROD_URL?.trim() || "https://www.youtubeai.chat").replace(/\/$/, "");
const VIDEO_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

async function signIn(page: Page) {
  const credentials = await loadLiveSummaryCreds();
  expect(credentials, "Dedicated TEST_LIVE_SUMMARY_EMAIL/PASSWORD are required").not.toBeNull();
  if (!credentials) throw new Error("Missing live smoke credentials");
  await page.goto(PROD_URL + "/auth/login");
  await page.fill("#email", credentials.email);
  await page.fill("#password", credentials.password);
  await page.getByRole("button", { name: /^login$/i }).click();
  await page.waitForURL(url => url.pathname === "/" || url.pathname === "/dashboard");
}

async function highlightWord(passage: Locator) {
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
    throw new Error("No source word in the saved passage");
  });
}

// Opt in after deployment with the dedicated paid Smoke Account. No auth,
// Summary, database, or LLM interception: this covers the real product path.
test("paid learner translates a saved Summary with real AI @live-highlight-translation", async ({ page }) => {
  test.skip(process.env.RUN_LIVE_HIGHLIGHT_TRANSLATION !== "1", "Opt-in paid AI smoke");
  await signIn(page);

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
  await highlightWord(passage);
  const card = page.getByRole("region", { name: "Highlight translation" });
  // Allow equivalent model wording: require translated text and a contextual
  // explanation, not an exact phrase that changes with model revisions.
  await expect(card.locator('p[lang="zh"]').first()).toContainText(/\p{Script=Han}/u, { timeout: 30_000 });
  await expect(card.locator('p[lang="zh"]').nth(1)).toContainText(/\p{Script=Han}/u);
  await expect(card.getByText("Meaning in this passage")).toBeVisible();
  await expect(card.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
});

test("paid researcher translates a saved Project claim with real AI @live-claim-translation", async ({ page }) => {
  const projectId = process.env.LIVE_TRANSLATION_PROJECT_ID;
  const claimId = process.env.LIVE_TRANSLATION_CLAIM_ID;
  test.skip(process.env.RUN_LIVE_HIGHLIGHT_TRANSLATION !== "1" || !projectId || !claimId, "Requires a paid smoke account with an existing English claim");
  await signIn(page);
  await page.goto(PROD_URL + "/dashboard");
  await page.locator("header select").selectOption("zh");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh");
  await page.goto(PROD_URL + "/workspace/projects/" + encodeURIComponent(projectId!) + "?claim=" + encodeURIComponent(claimId!));
  await page.getByRole("button", { name: "划词翻译设置" }).click();
  const settings = page.getByRole("dialog", { name: "划词翻译设置" });
  await settings.getByRole("switch", { name: "划词翻译" }).check();
  await settings.getByLabel("翻译目标语言").selectOption("zh");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await highlightWord(page.locator("#vs-room-title"));
  const paragraphs = page.getByRole("region", { name: "划词翻译", exact: true }).locator('p[lang="zh"]');
  await expect(paragraphs.first()).toContainText(/\p{Script=Han}/u, { timeout: 30_000 });
  await expect(paragraphs.nth(1)).toContainText(/\p{Script=Han}/u);
});
