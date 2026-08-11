// Anonymous visitors may explore the static demo, but chat requires an
// account so the public page cannot become an unmetered LLM relay.
import { test, expect, type Route } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test.describe("Hero demo chat (anonymous)", () => {
  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies();
    await page.route("**/auth/v1/signup*", (route) =>
      fulfillJson(route, anonymousSession()),
    );
  });

  test("anonymous visitor is prompted to sign up before hero-demo chat", async ({
    page,
    context,
  }) => {
    await page.goto(BASE_URL + "/");

    await expect(
      page.getByRole("heading", { name: /Will Nvidia.*moat persist/i }),
    ).toBeVisible({ timeout: 30_000 });

    // The chat hook needs the anonymous Supabase session before it can call
    // the route. Waiting for the cookie avoids racing session setup.
    await expect
      .poll(
        async () =>
          (await context.cookies()).some((cookie) =>
            /^sb-.*-auth-token$/.test(cookie.name),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);

    const input = page.getByLabel("Chat message");
    await expect(input).toBeVisible({ timeout: 10_000 });

    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/chat/stream") &&
        response.request().method() === "POST",
      { timeout: 30_000 },
    );

    await input.fill("What is Jensen's main argument about Nvidia's moat?");
    await page.getByLabel("Send message").click();

    const response = await responsePromise;
    expect(response.status()).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: "anon_chat_blocked",
      tier: "anon",
      upgradeUrl: "/auth/sign-up",
    });
    await expect(
      page.locator('[data-paywall-variant="chat-anon-blocked"]'),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /sign up free/i })).toBeVisible();
  });

  test("enabled Anonymous Trial shows the authoritative counter and reconciles admission", async ({
    page,
    context,
  }) => {
    await page.route("**/api/me/entitlements", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tier: "anon",
          caps: {
            summariesUsed: 0,
            summariesLimit: 1,
            projectsUsed: 0,
            projectsLimit: 0,
          },
          anonymousTrial: { state: "available", remainingMessages: 5 },
          subscriptionPresentation: { state: "anonymous" },
        }),
      });
    });
    await page.route("**/api/chat/stream", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({
            type: "anonymous_trial_admitted",
            reservationId: "018f3f4e-8454-7e8b-a98d-f319b5c32291",
            remainingMessages: 4,
          })}\n\n`,
          `data: ${JSON.stringify({ type: "delta", text: "Grounded answer" })}\n\n`,
          `data: ${JSON.stringify({ type: "done" })}\n\n`,
        ].join(""),
      });
    });

    await page.goto(BASE_URL + "/");
    await expect(
      page.getByRole("heading", { name: /Will Nvidia.*moat persist/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () =>
          (await context.cookies()).some((cookie) =>
            /^sb-.*-auth-token$/.test(cookie.name),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);

    const input = page.getByLabel("Chat message");
    await expect(input).toHaveAttribute("maxlength", "500");
    await expect(
      page.getByText("5 Anonymous Trial messages remaining"),
    ).toBeVisible();
    await input.fill("What is the main argument?");
    await page.getByLabel("Send message").click();

    await expect(page.getByText("Grounded answer")).toBeVisible();
    await expect(
      page.getByText("4 Anonymous Trial messages remaining"),
    ).toBeVisible();
  });

  test("enabled exhausted allowance replaces the composer with registration", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/me/entitlements", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tier: "anon",
          caps: {
            summariesUsed: 0,
            summariesLimit: 1,
            projectsUsed: 0,
            projectsLimit: 0,
          },
          anonymousTrial: { state: "available", remainingMessages: 0 },
          subscriptionPresentation: { state: "anonymous" },
        }),
      });
    });

    await page.goto(BASE_URL + "/");
    await expect(
      page.getByText(/used all 5 Anonymous Trial messages/i),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Chat message")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Create Account" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      "You've used all 5 Anonymous Trial messages.",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const actionBox = await page
      .getByRole("link", { name: "Create Account" })
      .boundingBox();
    expect(actionBox).not.toBeNull();
    expect(actionBox!.x).toBeGreaterThanOrEqual(0);
    expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(390);
  });
});

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function anonymousSession() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: "anonymous-trial-browser-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: "anonymous-trial-browser-refresh",
    user: {
      id: "74000000-0000-4000-8000-000000000003",
      aud: "authenticated",
      role: "authenticated",
      email: "",
      phone: "",
      app_metadata: { provider: "anonymous", providers: ["anonymous"] },
      user_metadata: {},
      identities: [],
      created_at: new Date(now * 1000).toISOString(),
      updated_at: new Date(now * 1000).toISOString(),
      is_anonymous: true,
    },
  };
}
