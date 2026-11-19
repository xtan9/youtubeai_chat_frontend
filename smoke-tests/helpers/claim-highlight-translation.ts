import { expect, type Locator, type Page } from "@playwright/test";

export async function checkClaimHighlightTranslation(page: Page, projectId: string, versionId: string) {
  const room = page.getByRole("region", { name: "观点空间", exact: true });
  const card = page.getByRole("region", { name: "划词翻译", exact: true });
  const settingsButton = room.locator("header").getByRole("button", { name: "划词翻译设置" });
  const settings = page.getByRole("dialog", { name: "划词翻译设置" });
  const toggle = settings.getByRole("switch", { name: "划词翻译" });
  const requests: Array<{ text: string; context: string; projectId: string; targetLanguage: string; versionId?: string }> = [];
  await page.route("**/api/translate", async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { translation: "示例译文", explanation: "这段文字中的含义。" } });
  });
  const evidence = room.locator(".vs-room-evidence");
  await settingsButton.scrollIntoViewIfNeeded();
  const evidenceTop = (await evidence.boundingBox())!.y;
  await expect(settings).toBeHidden();
  await settingsButton.click();
  await toggle.check();
  await settings.getByLabel("翻译目标语言").selectOption("zh");
  expect((await evidence.boundingBox())!.y).toBeCloseTo(evidenceTop, 0);
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(settingsButton).toBeFocused();

  async function highlight(block: Locator, word: string, sourceVersion?: string, touch = false) {
    await block.scrollIntoViewIfNeeded();
    const context = await block.innerText();
    const previous = requests.length;
    if (touch) await block.dispatchEvent("pointerdown", { pointerType: "touch" });
    await block.evaluate((el, word) => {
      const text = el.firstChild!;
      const offset = text.textContent!.indexOf(word);
      const range = document.createRange();
      range.setStart(text, offset);
      range.setEnd(text, offset + word.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    }, word);
    if (touch) {
      await block.dispatchEvent("pointerup", { pointerType: "touch" });
      const translate = card.getByRole("button", { name: "翻译", exact: true });
      await expect(translate).toBeVisible();
      expect(requests).toHaveLength(previous);
      await translate.click();
    }
    await expect(card.getByText("示例译文")).toBeVisible();
    await expect(card.getByText("这段文字中的含义。")).toBeVisible();
    expect(requests).toHaveLength(previous + 1);
    expect(requests.at(-1)).toMatchObject({ text: word, context, targetLanguage: "zh", projectId });
    expect(requests.at(-1)?.versionId).toBe(sourceVersion);
    await card.getByRole("button", { name: "关闭译文" }).click();
    await expect(card).toBeHidden();
  }

  await highlight(room.locator("#vs-room-title"), "胆固醇");
  await highlight(room.locator(".vs-finding blockquote").first(), "mortality", versionId);
  await page.setViewportSize({ width: 390, height: 844 });
  await highlight(room.getByText("我们可以先从这个观点的原话说起。", { exact: true }), "原话", undefined, true);
  await settingsButton.click();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await settingsButton.click();
  await expect(settings).toBeHidden();
  await page.unroute("**/api/translate");
  await page.setViewportSize({ width: 1440, height: 900 });
}
