import { expect, test, type Page } from "@playwright/test";

const BASE_URL = (
  process.env.BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");

async function fulfillAnonymousEntitlements(page: Page) {
  await page.route("**/api/me/entitlements", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        tier: "anon",
        caps: { summariesUsed: 0, summariesLimit: 1 },
        subscriptionPresentation: { state: "anonymous" },
      }),
      contentType: "application/json",
      status: 200,
    });
  });
}

test.describe("public Pricing conversion", () => {
  test("@production-critical desktop comparison preserves yearly signup intent and captures the visual journey", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await fulfillAnonymousEntitlements(page);
    await page.goto(`${BASE_URL}/pricing?source_surface=global_header`);

    await expect(
      page.getByRole("heading", { level: 1, name: "Simple pricing" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Free" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Pro Monthly" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Pro Yearly" }),
    ).toBeVisible();
    await expect(page.getByText("$6.99/month")).toBeVisible();
    await expect(page.getByText("$4.99/month equivalent")).toBeVisible();
    await expect(page.getByText("$59.88 charged once per year.")).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("pricing-conversion-desktop.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "Choose yearly" }).click();
    await expect(page).toHaveURL(/\/auth\/sign-up\?/);
    const signupUrl = new URL(page.url());
    expect(signupUrl.searchParams.get("redirect_to")).toBe(
      "/pricing?intent=upgrade&plan=yearly&source_surface=global_header",
    );
  });

  test("mobile Pricing keeps both cadence choices readable and preserves monthly intent", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fulfillAnonymousEntitlements(page);
    await page.goto(`${BASE_URL}/pricing?source_surface=public_footer`);

    await expect(
      page.getByRole("heading", { level: 1, name: "Simple pricing" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose monthly" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose yearly" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await page.screenshot({
      path: testInfo.outputPath("pricing-conversion-mobile.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "Choose monthly" }).click();
    await expect(page).toHaveURL(/\/auth\/sign-up\?/);
    const signupUrl = new URL(page.url());
    expect(signupUrl.searchParams.get("redirect_to")).toBe(
      "/pricing?intent=upgrade&plan=monthly&source_surface=public_footer",
    );
  });
});
