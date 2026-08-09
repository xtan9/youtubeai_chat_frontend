import { expect, test } from "@playwright/test";

const BASE_URL = (
  process.env.BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");

test.describe("public plan discovery", () => {
  test("desktop Footer reaches the dedicated Pricing route without changing the hero action", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE_URL}/`);

    await expect(
      page.getByRole("button", { name: "Summarize video" }),
    ).toBeAttached();
    const hero = page.locator("section").filter({
      has: page.getByRole("heading", {
        level: 1,
        name: "Summarize YouTube Videos with AI",
      }),
    });
    await expect(hero.getByRole("link", { name: /pricing|upgrade/i })).toHaveCount(
      0,
    );

    const pricingLink = page
      .getByRole("contentinfo")
      .getByRole("link", { name: "Pricing" });
    await expect(pricingLink).toBeVisible();
    await expect(pricingLink).toHaveAttribute(
      "href",
      "/pricing?source_surface=public_footer",
    );
    await pricingLink.click();

    await expect(page).toHaveURL(
      `${BASE_URL}/pricing?source_surface=public_footer`,
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Simple pricing" }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Pricing | YouTube AI Chat");

    // Assert the route response a crawler receives, independently of any
    // metadata left in the dev client's streamed head during soft navigation.
    await page.reload();
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveCount(1);
    await expect(canonical).toHaveAttribute(
      "href",
      "https://www.youtubeai.chat/pricing",
    );
    await expect(page.getByText("$4.99/mo equivalent")).toBeVisible();
    await expect(page.getByText("Billed annually at $59.88")).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("public-plan-discovery-desktop.png"),
      fullPage: true,
    });
  });

  test("mobile homepage FAQ reaches Pricing with truthful plan details", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/`);

    await expect(
      page.getByRole("button", { name: "Summarize video" }),
    ).toBeAttached();
    await expect(
      page
        .getByRole("contentinfo")
        .getByRole("link", { name: "Pricing" }),
    ).toBeHidden();

    const pricingQuestion = page.getByRole("button", {
      name: /what's included in the free plan and pro plan/i,
    });
    await pricingQuestion.scrollIntoViewIfNeeded();
    await pricingQuestion.click();
    const pricingLink = page.getByRole("link", { name: "View Pricing" });
    await expect(pricingLink).toBeVisible();
    await expect(page.getByText(/\$59\.88 annually/i)).toBeVisible();
    await pricingLink.click();

    await expect(page).toHaveURL(`${BASE_URL}/pricing`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Simple pricing" }),
    ).toBeVisible();
    await expect(page.getByText("$4.99/mo equivalent")).toBeVisible();
    await expect(page.getByText("Billed annually at $59.88")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await page.screenshot({
      path: testInfo.outputPath("public-plan-discovery-mobile.png"),
      fullPage: true,
    });
  });

  test("generated sitemap includes Pricing", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/sitemap.xml`);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(
      "https://www.youtubeai.chat/pricing",
    );
  });

  test("Plan & Billing is a real registered-only destination", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/faq`);
    const pricingQuestion = page.getByRole("button", {
      name: /what do the free plan and pro plan include/i,
    });
    await pricingQuestion.click();

    await page.getByRole("link", { name: "Plan & Billing" }).click();
    await expect(page).toHaveURL(`${BASE_URL}/auth/login`);
  });
});
