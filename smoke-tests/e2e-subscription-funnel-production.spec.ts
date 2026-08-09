import { expect, test } from "@playwright/test";
import {
  SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS,
  type SubscriptionFunnelSuccessStageEvent,
} from "../lib/analytics/subscription-funnel-query";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

test("real admin report completes the production subscription funnel path", async ({
  page,
}) => {
  const email = process.env.TEST_ADMIN_EMAIL?.trim();
  const password = process.env.TEST_ADMIN_PASSWORD?.trim();
  test.skip(
    !email || !password,
    "TEST_ADMIN_EMAIL/TEST_ADMIN_PASSWORD required (must be in ADMIN_EMAILS)",
  );
  if (!email || !password) return;

  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL(
      (url) => url.pathname === "/" || url.pathname === "/dashboard",
      { timeout: 15_000 },
    ),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);

  const response = await page.goto(
    `${PROD_URL}/admin/subscriptions?window=7`,
  );
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "Subscription conversion" }),
  ).toBeVisible();
  await expect(page.locator(".subscription-funnel-stage")).toHaveCount(
    SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS.length,
  );
  for (const event of SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS) {
    await expect(
      page.locator(".subscription-funnel-stage").getByText(stageLabel(event)),
    ).toBeVisible();
  }
  await expect(page.getByText("Current failures")).toBeVisible();
  await expect(page.getByText("Baseline failures")).toBeVisible();
  await expect(page.locator(".subscription-funnel-loss-baseline")).toHaveCount(
    SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS.length - 1,
  );
  await expect(
    page.getByText(/Smoke Account activity is excluded from every metric/i),
  ).toBeVisible();
});

function stageLabel(event: SubscriptionFunnelSuccessStageEvent): string {
  switch (event) {
    case "subscription_discovery_viewed":
      return "Plan control viewed";
    case "subscription_discovery_clicked":
      return "Plan control clicked";
    case "pricing_viewed":
      return "Pricing viewed";
    case "plan_choice_attempted":
      return "Plan chosen";
    case "checkout_started":
      return "Checkout started";
    case "subscription_activated":
      return "Subscription activated";
  }
}
