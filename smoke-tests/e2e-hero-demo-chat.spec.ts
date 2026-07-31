// Anonymous visitors may explore the static demo, but chat requires an
// account so the public page cannot become an unmetered LLM relay.
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test.describe("Hero demo chat (anonymous)", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
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
});
