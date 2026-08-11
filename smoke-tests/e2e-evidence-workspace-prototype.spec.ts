import { expect, test } from "@playwright/test";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);

const VIEWPORTS = [
  { name: "narrow phone", width: 320, height: 720 },
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} keeps Evidence understandable without horizontal or nested scrolling`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const apiRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) {
        apiRequests.push(request.url());
      }
    });

    await page.goto(
      `${BASE_URL}/summary?evidencePrototype=1&variant=claim-desk&fixture=report`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("tab", { name: "Evidence" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByRole("heading", { name: "Evidence Check" }),
    ).toBeVisible();
    await expect(
      page.getByText("10 of 12 material claims examined"),
    ).toBeVisible();
    await expect(page.getByText("Confidence: unavailable")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /used ev prices/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /used ev prices/i }).click();
    await expect(
      page.getByText("Conflicts with retrieved evidence").last(),
    ).toBeVisible();
    await expect(page.getByText(/47% of list price/i)).toBeVisible();
    await expect(
      page.getByText("All material evidence origins · 2"),
    ).toBeVisible();
    await expect(page.getByText("Material Inventory Entry MIE-09")).toBeVisible();
    await expect(page.getByText("Evidence record for MIE-09 · MCU-09")).toBeVisible();
    await expect(page.getByText(/SRC-09-A · Transport Economics Observatory/)).toBeVisible();

    await page.getByText("Full material inventory · 12 entries").click();
    const inventory = page.getByRole("list", { name: "Full material inventory" });
    await expect(inventory.getByRole("listitem")).toHaveCount(12);
    await expect(inventory.getByRole("listitem").nth(9)).toContainText(
      "MIE-12 · Claim Unit MCU-12",
    );
    await expect(inventory.getByRole("listitem").nth(10)).toContainText("MIE-10");
    await expect(inventory.getByRole("listitem").nth(10)).not.toContainText("Claim Unit");

    const variants = [
      ["B · Coverage ledger", "coverage-ledger"],
      ["C · Guided dossier", "guided-dossier"],
      ["A · Claim desk", "claim-desk"],
    ] as const;
    for (const [buttonName, layoutName] of variants) {
      await page.getByRole("button", { name: buttonName }).click();
      await expect(
        page.locator(`[data-evidence-layout="${layoutName}"]`),
      ).toBeVisible();
      const layoutFit = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        nestedScrollers: [...document.querySelectorAll<HTMLElement>("main *")]
          .filter((element) => {
            const style = window.getComputedStyle(element);
            return (
              ["auto", "scroll"].includes(style.overflowY) &&
              element.scrollHeight > element.clientHeight + 1
            );
          })
          .map((element) => element.tagName),
      }));
      expect(layoutFit.documentWidth).toBeLessThanOrEqual(layoutFit.viewportWidth);
      expect(layoutFit.nestedScrollers).toEqual([]);
    }

    if (viewport.width < 500) {
      const fixture = page.getByRole("combobox", { name: "Fixture state" });
      await fixture.selectOption("waiting");
      await expect(page.getByRole("status")).toContainText("Waiting for sources");
      const cancel = page.getByRole("button", { name: "Cancel Evidence Check" });
      await cancel.scrollIntoViewIfNeeded();
      const cancelBox = await cancel.boundingBox();
      const controlsBox = await page.getByRole("region", { name: "Prototype controls" }).boundingBox();
      expect(cancelBox).not.toBeNull();
      expect(controlsBox).not.toBeNull();
      expect(cancelBox!.y + cancelBox!.height).toBeLessThanOrEqual(controlsBox!.y);
      await cancel.focus();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "A · Claim desk" })).toBeFocused();
      await fixture.selectOption("report");
    }

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      nestedScrollers: [...document.querySelectorAll<HTMLElement>("main *")]
        .filter((element) => {
          const style = window.getComputedStyle(element);
          return (
            ["auto", "scroll"].includes(style.overflowY) &&
            element.scrollHeight > element.clientHeight + 1
          );
        })
        .map((element) => element.tagName),
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.nestedScrollers).toEqual([]);
    expect(apiRequests).toEqual([]);
  });
}

test("prototype controls compare structural layouts and lifecycle fixtures by keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE_URL}/summary?evidencePrototype=1`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle");

  await expect(page.locator('[data-evidence-layout="claim-desk"]')).toBeVisible();
  const evidenceTab = page.getByRole("tab", { name: "Evidence" });
  await evidenceTab.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await evidenceTab.click();
  await expect(page.locator('[data-evidence-layout="claim-desk"]')).toBeVisible();

  const canvas = page.getByRole("region", {
    name: /Evidence prototype canvas/i,
  });
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.locator('[data-evidence-layout="coverage-ledger"]'),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.locator('[data-evidence-layout="guided-dossier"]'),
  ).toBeVisible();

  const fixture = page.getByRole("combobox", { name: "Fixture state" });
  await fixture.selectOption("progress");
  await expect(page.getByRole("status")).toContainText("Reviewing evidence");
  await expect(page.getByText(/you can leave this page/i)).toBeVisible();

  await fixture.selectOption("waiting");
  await expect(page.getByRole("status")).toContainText("Waiting for sources");
  await expect(page.getByText(/durable stage is saved/i)).toBeVisible();

  await fixture.selectOption("not-eligible");
  await expect(
    page.getByRole("heading", { name: "No report was created" }),
  ).toBeVisible();
  await expect(page.getByText(/visual demonstration/i)).toBeVisible();

  await fixture.selectOption("request");
  await expect(page.getByText(/visual dependency may be ineligible or excluded/i)).toBeVisible();
  await expect(page.getByText(/may abstain/i)).toHaveCount(0);

  await fixture.selectOption("recheck");
  await page.getByRole("button", { name: "Request recheck" }).click();
  await expect(page.getByRole("status")).toContainText("Reviewing evidence");
  await expect(page.getByText(/report dated 8 august 2026/i).first()).toBeVisible();

  await fixture.selectOption("corrected");
  await expect(
    page.getByRole("heading", { name: "Report history" }),
  ).toBeVisible();
  await expect(page.getByText("Current · version 2")).toBeVisible();
  await expect(page.getByText("Superseded · version 1")).toBeVisible();

  await fixture.selectOption("suppressed");
  await expect(
    page.getByRole("heading", {
      name: "This complete report is temporarily unavailable",
    }),
  ).toBeVisible();
  await expect(page.getByText("Report history shell")).toBeVisible();
  await expect(page.getByText(/collection improved after the mandate/i)).toHaveCount(0);

  await fixture.selectOption("failed");
  await expect(
    page.getByRole("button", { name: "Retry Evidence Check" }),
  ).toBeVisible();
  await expect(page.getByText(/no finding or partial report was published/i)).toBeVisible();

  await fixture.selectOption("notices");
  const privateNoticeButtons = page.getByRole("button", { name: /review private update/i });
  await expect(privateNoticeButtons).toHaveCount(9);
  await privateNoticeButtons.first().click();
  await expect(page.getByText("Reauthorization required")).toBeVisible();
  await expect(page.getByText(/10 of 12 inventory entries/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Continue as demo learner" }).click();
  await expect(page.getByText(/10 of 12 inventory entries/i)).toBeVisible();

  await fixture.selectOption("comprehension");
  await page.getByLabel(/bounded claim scope/i).selectOption("uk-three-year");
  await page.getByLabel(/which correction/i).selectOption("conflicts");
  await page.getByLabel(/what does Unresolved mean/i).selectOption("abstains");
  await page.getByLabel(/what does 10 of 12 Coverage mean/i).selectOption("ten-plus-two");
  await page.getByLabel(/what may you conclude/i).selectOption("evidence-not-honesty");
  await page.getByLabel(/what does Confidence: unavailable mean/i).selectOption("not-estimated");
  await page.getByRole("button", { name: "Evaluate simulated response" }).click();
  await expect(page.getByRole("status")).toContainText("six concepts demonstrated");
  await expect(page.getByRole("status")).toContainText("overreliance check passed");
  await expect(page.getByRole("status")).toContainText("No human participant or launch evidence");
});
