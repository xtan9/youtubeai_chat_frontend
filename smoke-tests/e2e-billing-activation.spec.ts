import { expect, test } from "@playwright/test";

const BASE_URL = (
  process.env.BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");
const ACTIVATION_PENDING_KEY = "youtubeai:billing-activation-pending";

test.describe("checkout activation return", () => {
  test("shows bounded activation, confirms Pro, and stays repeat-safe", async ({
    page,
  }, testInfo) => {
    let checkoutCreates = 0;
    let statusReads = 0;

    await page.route("**/api/billing/checkout/status?**", async (route) => {
      statusReads += 1;
      const body =
        statusReads === 1
          ? { status: "pending" }
          : {
              status: "active",
              subscriptionPresentation: {
                state: "active_pro",
                plan: "yearly",
                renewsAt: "2027-08-09T00:00:00.000Z",
              },
            };
      await route.fulfill({
        body: JSON.stringify(body),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/billing/checkout", async (route) => {
      if (route.request().method() === "POST") checkoutCreates += 1;
      await route.fulfill({
        body: JSON.stringify({ message: "unexpected checkout" }),
        contentType: "application/json",
        status: 500,
      });
    });

    await page.goto(
      `${BASE_URL}/billing/success?session_id=cs_test_browser_return`,
    );

    await expect(
      page.getByRole("heading", { name: "Activating Pro" }),
    ).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", {
        name: /pricing|upgrade|checkout|choose/i,
      }),
    ).toHaveCount(0);
    await expect(page.getByRole("banner").getByRole("status")).toHaveText(
      "Activating Pro",
    );
    await expect(
      page.getByRole("contentinfo").getByRole("link", { name: "Pricing" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /upgrade|checkout|choose/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /upgrade|checkout|choose/i }),
    ).toHaveCount(0);
    expect(
      await page.evaluate((key) => sessionStorage.getItem(key), ACTIVATION_PENDING_KEY),
    ).toBe("cs_test_browser_return");
    await page.screenshot({
      path: testInfo.outputPath("checkout-activation-pending.png"),
      fullPage: true,
    });

    await expect(
      page.getByRole("heading", { name: "Pro Plan is active" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("banner").getByRole("status")).toHaveCount(0);
    await expect(
      page.getByRole("contentinfo").getByRole("link", { name: "Pricing" }),
    ).toHaveCount(1);
    const billingLink = page.getByRole("link", {
      name: "View Plan & Billing",
    });
    await expect(billingLink).toHaveAttribute("href", "/account/billing");
    await billingLink.focus();
    await expect(billingLink).toBeFocused();
    expect(
      await page.evaluate((key) => sessionStorage.getItem(key), ACTIVATION_PENDING_KEY),
    ).toBeNull();
    await page.screenshot({
      path: testInfo.outputPath("checkout-activation-confirmed.png"),
      fullPage: true,
    });

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Pro Plan is active" }),
    ).toBeVisible();
    await expect(page.getByRole("banner").getByRole("status")).toHaveCount(0);
    expect(statusReads).toBeGreaterThanOrEqual(3);
    expect(checkoutCreates).toBe(0);
  });

  test("keeps the mobile pending-to-active return actionless and usable", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let checkoutCreates = 0;
    let statusReads = 0;

    await page.route("**/api/billing/checkout/status?**", async (route) => {
      statusReads += 1;
      await route.fulfill({
        body: JSON.stringify(
          statusReads === 1
            ? { status: "pending" }
            : {
                status: "active",
                subscriptionPresentation: {
                  state: "active_pro",
                  plan: "monthly",
                  renewsAt: "2026-09-09T00:00:00.000Z",
                },
              },
        ),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/billing/checkout", async (route) => {
      if (route.request().method() === "POST") checkoutCreates += 1;
      await route.fulfill({ status: 500 });
    });

    await page.goto(
      `${BASE_URL}/billing/success?session_id=cs_test_mobile_return`,
    );

    await expect(
      page.getByRole("heading", { name: "Activating Pro" }),
    ).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("link", {
        name: /pricing|upgrade|checkout|choose/i,
      }),
    ).toHaveCount(0);
    await expect(page.getByRole("banner").getByRole("status")).toHaveText(
      "Activating Pro",
    );
    await expect(
      page.getByRole("contentinfo").getByRole("link", { name: "Pricing" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /upgrade|checkout|choose/i }),
    ).toHaveCount(0);
    expect(
      await page.evaluate((key) => sessionStorage.getItem(key), ACTIVATION_PENDING_KEY),
    ).toBe("cs_test_mobile_return");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("checkout-activation-mobile-pending.png"),
      fullPage: true,
    });

    await expect(
      page.getByRole("heading", { name: "Pro Plan is active" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("banner").getByRole("status")).toHaveCount(0);
    const billingLink = page.getByRole("link", {
      name: "View Plan & Billing",
    });
    await billingLink.focus();
    await expect(billingLink).toBeFocused();
    expect(
      await page.evaluate((key) => sessionStorage.getItem(key), ACTIVATION_PENDING_KEY),
    ).toBeNull();
    expect(checkoutCreates).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath("checkout-activation-mobile-confirmed.png"),
      fullPage: true,
    });
  });

  test("releases global guards after a valid-shaped return is rejected", async ({
    page,
  }) => {
    let statusReads = 0;
    await page.route("**/api/billing/checkout/status?**", async (route) => {
      statusReads += 1;
      await route.fulfill({
        body: JSON.stringify({ message: "Checkout session not found" }),
        contentType: "application/json",
        status: 404,
      });
    });

    await page.goto(
      `${BASE_URL}/billing/success?session_id=cs_test_unknown_return`,
    );

    await expect(
      page.getByRole("heading", { name: "Checkout return unavailable" }),
    ).toBeVisible();
    await expect(page.getByRole("banner").getByRole("status")).toHaveCount(0);
    await expect(
      page.getByRole("contentinfo").getByRole("link", { name: "Pricing" }),
    ).toHaveCount(1);
    expect(statusReads).toBe(1);
  });

  test("does not leak activation into a direct success-page visit", async ({
    page,
  }) => {
    let statusReads = 0;
    await page.route("**/api/billing/checkout/status?**", async (route) => {
      statusReads += 1;
      await route.abort();
    });

    await page.goto(`${BASE_URL}/billing/success`);

    await expect(
      page.getByRole("heading", { name: "Checkout return unavailable" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Activating Pro" }),
    ).toHaveCount(0);
    await expect(page.getByRole("banner").getByRole("status")).toHaveCount(0);
    expect(statusReads).toBe(0);
  });
});
