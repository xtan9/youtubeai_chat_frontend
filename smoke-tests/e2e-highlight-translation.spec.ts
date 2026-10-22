import { expect, test, type Page } from "@playwright/test";

const BASE_URL = (process.env.BASE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const SUMMARY = "## Deng Xiaoping changed what officials were rewarded for\n\nAfter Mao Zedong died in 1976, China was poor and politically unsettled. Deng Xiaoping, a **pragmatist**, saw economic hardship as a threat to the party's survival. He shifted the system toward practical economic results.\n\nLocal officials received evaluation sheets with economic development near the top.";
const TRANSLATION = { translation: "务实派", explanation: "这里指重视实际经济成果、根据现实情况采取行动的人。", sameLanguage: false, partOfSpeech: "noun" };

// Browser contract fixtures replace external auth, Summary, and AI boundaries.
// API integration tests exercise authorization, source verification, rate
// limits, and gateway composition; this suite makes no paid live AI calls.
type TranslationPlayerWindow = Window & {
  loadTranslationPlayer?: () => void;
  onYouTubeIframeAPIReady?: () => void;
};

async function openSummary(page: Page, paid = true, summary = SUMMARY, delayPlayer = false) {
  // Replace only the external player API. It still inserts a sized iframe,
  // including after reading begins when a test explicitly delays its load.
  await page.addInitScript(({ delayed }) => {
    const testWindow = window as TranslationPlayerWindow;
    class Player {
      private iframe = document.createElement("iframe");
      constructor(private element: HTMLElement, options: { width: string; height: string; events: { onReady?: (event: unknown) => void } }) {
        this.iframe.width = options.width;
        this.iframe.height = options.height;
        this.iframe.title = "Video fixture";
        element.replaceWith(this.iframe);
        setTimeout(() => options.events.onReady?.({ target: this }), 0);
      }
      getIframe() { return this.iframe; }
      getCurrentTime() { return 0; }
      getPlayerState() { return -1; }
      cueVideoById() {}
      loadVideoById() {}
      destroy() { this.iframe.replaceWith(this.element); }
    }
    testWindow.loadTranslationPlayer = () => {
      Object.assign(window, { YT: { Player } });
      testWindow.onYouTubeIframeAPIReady?.();
    };
    if (!delayed) testWindow.loadTranslationPlayer();
  }, { delayed: delayPlayer });
  await page.route("**/www.youtube.com/iframe_api", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  const user = {
    id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated",
    email: "translation@example.test", app_metadata: {}, user_metadata: {},
    identities: [], created_at: "2026-10-18T00:00:00Z", is_anonymous: false,
  };
  await page.route("**/auth/v1/**", route => route.fulfill({ json: route.request().url().includes("/user")
    ? user : { access_token: "fixture-access-token", token_type: "bearer", expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "fixture-refresh-token", user } }));
  await page.route("**/api/me/entitlements*", route => route.fulfill({ json: {
    tier: paid ? "pro" : "free",
    caps: { summariesUsed: 1, summariesLimit: paid ? -1 : 10, projectsUsed: 0, projectsLimit: 1 },
    subscriptionPresentation: paid ? { state: "active_pro", plan: "monthly", renewsAt: null } : { state: "free" },
  } }));
  await page.route("**/api/summarize/stream", route => route.fulfill({
    contentType: "text/event-stream", body: [
      { type: "metadata", category: "general", cached: true },
      { type: "full_transcript", source: "auto_captions", segments: [{ text: "Economic changes and practical results.", start: 0, duration: 30 }] },
      { type: "content", text: summary },
      { type: "summary", category: "general", total_time: 3, summarize_time: 2, transcribe_time: 1 },
    ].map(event => "data: " + JSON.stringify(event) + "\n\n").join(""),
  }));
  await page.route("**/api/chat/messages?*", route => route.fulfill({ json: { messages: [] } }));
  await page.route("**/api/chat/suggestions?*", route => route.fulfill({ json: { suggestions: [] } }));
  await page.goto(BASE_URL + "/summary?url=" + encodeURIComponent(VIDEO_URL));
  await expect(page.getByTestId("summary-markdown-surface")).toContainText("pragmatist");
}

test.describe("paid highlight translation browser contract", () => {
  test.use({ viewport: { width: 1280, height: 1000 }, locale: "zh-CN", permissions: ["clipboard-read", "clipboard-write"] });

  test("desktop floating card, native selection, copy, language, and tab dismissal", async ({ page }, testInfo) => {
    let calls = 0;
    await page.route("**/api/translate", route => {
      calls++;
      expect(route.request().postDataJSON()).toMatchObject({ text: "pragmatist", targetLanguage: "zh" });
      return route.fulfill({ json: TRANSLATION });
    });
    await openSummary(page);
    const toggle = page.getByRole("switch", { name: "Highlight to translate" });
    await expect(toggle).not.toBeChecked();
    const word = page.getByTestId("summary-markdown-surface").locator("strong").filter({ hasText: "pragmatist" });
    await word.dblclick();
    await expect(page.getByRole("region", { name: "Highlight translation" })).toHaveCount(0);
    expect(calls).toBe(0);
    await toggle.click();
    await expect(toggle).toBeChecked();
    await word.dblclick();
    const card = page.getByRole("region", { name: "Highlight translation" });
    await expect(card).toContainText(TRANSLATION.translation);
    await expect(card).toContainText(TRANSLATION.explanation);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("pragmatist");
    const bounds = await card.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1280);
    await page.screenshot({ path: testInfo.outputPath("floating-card-desktop.png"), fullPage: false });
    await card.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(card.getByRole("button", { name: "Copied" })).toBeVisible();
    expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(TRANSLATION.translation + "\n\n" + TRANSLATION.explanation);
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    await word.dblclick();
    await expect(card).toContainText(TRANSLATION.translation);
    await page.getByRole("tab", { name: "Chat", exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(page).toHaveURL(/tab=chat/);
    await page.getByRole("tab", { name: "Summary", exact: true }).click();
    await expect(page).not.toHaveURL(/tab=chat/);
    await expect(toggle).toBeChecked();
    await page.getByLabel("Translate to:").selectOption("fr");
    await expect(page.getByLabel("Translate to:")).toHaveValue("fr");
    await expect(page.getByTestId("summary-markdown-surface")).toContainText("pragmatist");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("highlight-translation:v1")!))).toEqual({ enabled: true, language: "fr" });
  });

  test("translates a word selected in a heading instead of showing a sentence-limit hint", async ({ page }, testInfo) => {
    await page.route("**/api/translate", route => {
      expect(route.request().postDataJSON()).toMatchObject({
        text: "controversy", targetLanguage: "zh", selectionStart: 9,
        context: "What the controversy is about", heading: "What the controversy is about",
      });
      return route.fulfill({ json: { translation: "争议", explanation: "这里指研究结论存在不同观点。", sameLanguage: false } });
    });
    await openSummary(page, true, "## What the **controversy** is about\n\nA pragmatist examines the evidence.");
    await page.getByRole("switch", { name: "Highlight to translate" }).click();
    const word = page.getByRole("heading", { name: "What the controversy is about" }).locator("strong");
    await word.dblclick();
    expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe("controversy");
    const card = page.getByRole("region", { name: "Highlight translation" });
    await expect(card).toContainText("争议");
    await expect(card).toContainText("这里指研究结论存在不同观点。");
    await expect(card).toContainText("Based on this passage");
    await expect(card).not.toContainText("Select up to one sentence");
    await page.screenshot({ path: testInfo.outputPath("heading-translation-fixed.png"), fullPage: false });
  });
  test("Free users see the upgrade control and cannot enable translation", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/translate", route => { calls++; return route.fulfill({ status: 403, json: {} }); });
    await openSummary(page, false);
    await expect(page.getByRole("link", { name: "Upgrade to Pro", exact: true }).last()).toBeVisible();
    await expect(page.getByRole("switch", { name: "Highlight to translate" })).toHaveCount(0);
    await page.getByTestId("summary-markdown-surface").locator("strong").dblclick();
    await expect(page.getByRole("region", { name: "Highlight translation" })).toHaveCount(0);
    expect(calls).toBe(0);
  });
});

test.describe("touch translation", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "zh-CN", colorScheme: "dark" });

  test("offers an explicit action and keeps the result inside the mobile viewport", async ({ page }, testInfo) => {
    let calls = 0;
    await page.route("**/api/translate", route => { calls++; return route.fulfill({ json: TRANSLATION }); });
    await openSummary(page, true, SUMMARY, true);
    await page.getByRole("switch", { name: "Highlight to translate" }).tap();
    await expect(page.getByRole("switch")).toBeChecked();
    const word = page.getByTestId("summary-markdown-surface").locator("strong");
    await word.scrollIntoViewIfNeeded();
    await word.tap();
    await word.dispatchEvent("pointerdown", { pointerType: "touch" });
    await word.dispatchEvent("pointercancel", { pointerType: "touch" });
    // The native DOM range represents the range created by mobile selection handles.
    await word.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    const card = page.getByRole("region", { name: "Highlight translation" });
    await expect(card.getByRole("button", { name: "Translate", exact: true })).toBeVisible();
    expect(calls).toBe(0);
    const readingTop = (await word.boundingBox())!.y;
    await page.evaluate(() => (window as TranslationPlayerWindow).loadTranslationPlayer?.());
    await expect(page.getByTitle("Video fixture")).toBeVisible();
    await expect.poll(async () => Math.abs((await word.boundingBox())!.y - readingTop)).toBeLessThan(1);
    await expect(card.getByRole("button", { name: "Translate", exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Translate", exact: true }).tap();
    await expect(card).toContainText(TRANSLATION.translation);
    const bounds = await card.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    await page.screenshot({ path: testInfo.outputPath("floating-card-mobile.png"), fullPage: false });
    await card.getByRole("button", { name: "Close translation" }).tap();
    await expect(card).toHaveCount(0);
  });
});
