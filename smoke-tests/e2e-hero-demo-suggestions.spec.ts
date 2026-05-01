// Hero demo widget — language picker drives the chat empty state.
// Asserts the three suggestion buttons in column 3 change content when
// the picker swaps from English to Spanish, sourced from the bundled
// per-(id, lang) modules (no API call).
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test.describe("Hero demo — localized chat suggestions", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("picker swap rewrites the empty-state suggestion buttons", async ({
    page,
  }) => {
    await page.goto(BASE_URL + "/");

    // Wait for the demo to mount.
    await expect(
      page.getByRole("heading", { name: /Will Nvidia.*moat persist/i }),
    ).toBeVisible({ timeout: 30_000 });

    // The "Ask anything about this video" empty state lives in column 3.
    const emptyStateCopy = page.getByText(
      /Ask anything about this video, or start with a suggestion/i,
    );
    await expect(emptyStateCopy).toBeVisible({ timeout: 10_000 });

    // The empty-state buttons live in a <ul> alongside the prompt copy —
    // grab their text snapshot before switching language.
    const buttonsBefore = await page
      .locator("ul li button")
      .filter({ hasText: /\?$/ })
      .allInnerTexts();
    expect(buttonsBefore).toHaveLength(3);
    expect(buttonsBefore.every((t) => t.trim().length > 0)).toBe(true);

    // Switch the picker to Spanish.
    await page.getByRole("button", { name: /Summary language/i }).click();
    await page.getByTestId("lang-option-es").click();

    // Wait for the suggestion buttons to swap. Equality on the array
    // proves the swap happened; the new text doesn't need to be
    // language-detected, just *different*.
    await expect(async () => {
      const buttonsAfter = await page
        .locator("ul li button")
        .filter({ hasText: /\?$/ })
        .allInnerTexts();
      expect(buttonsAfter).toHaveLength(3);
      expect(buttonsAfter).not.toEqual(buttonsBefore);
    }).toPass({ timeout: 10_000 });
  });
});
