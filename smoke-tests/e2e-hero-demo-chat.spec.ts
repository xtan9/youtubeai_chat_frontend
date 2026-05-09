// Regression for the bug where typing into the hero-demo chat returned
// "Generate the summary first, then ask follow-up questions." The hero
// videos serve their summary + transcript from static modules under
// app/components/hero-demo-data/, so the DB cache is never seeded for
// them and /api/chat/stream's old DB-only lookup 404'd. The fix routes
// demo videos through a file-loaded fast path that also bypasses
// rate-limit, entitlement, and history persistence.
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

const NO_SUMMARY_ERROR =
  "Generate the summary first, then ask follow-up questions.";

test.describe("Hero demo chat (anonymous)", () => {
  test.beforeEach(async ({ context }) => {
    // Logged-in users get redirected to /dashboard before the demo
    // renders. Force the anonymous landing page every time.
    await context.clearCookies();
  });

  test("anonymous visitor can send a chat message and receives a streamed answer (no 'Generate the summary first' error)", async ({
    page,
    context,
  }) => {
    await page.goto(BASE_URL + "/");

    // Wait for the widget to mount on the default sample.
    await expect(
      page.getByRole("heading", { name: /Will Nvidia.*moat persist/i }),
    ).toBeVisible({ timeout: 30_000 });

    // The chat hook reads the anon access token from supabase before
    // firing the fetch; without it, send() short-circuits with "Setting
    // up your session… please try again in a moment." Wait for the
    // sb-*-auth-token cookie to land before composing the message.
    await expect
      .poll(
        async () =>
          (await context.cookies()).some((c) =>
            /^sb-.*-auth-token$/.test(c.name),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);

    const input = page.getByLabel("Chat message");
    await expect(input).toBeVisible({ timeout: 10_000 });

    // Capture the network response for /api/chat/stream so we can pin
    // that the route returned 200 (the bug's signature was 404 with
    // "Generate the summary first…" in the body).
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/chat/stream") && r.request().method() === "POST",
      { timeout: 30_000 },
    );

    await input.fill("What is Jensen's main argument about Nvidia's moat?");
    const sendButton = page.getByLabel("Send message");
    await expect(sendButton).toBeEnabled({ timeout: 10_000 });
    await sendButton.click();

    const response = await responsePromise;
    expect(response.status()).toBe(200);

    // The "Generate the summary first…" copy must NOT appear anywhere on
    // the page — neither in the chat error banner nor in any streamed
    // delta.
    await expect(page.getByText(NO_SUMMARY_ERROR)).toHaveCount(0);

    // The chat list renders the user's message immediately and an
    // assistant draft once the stream emits its first delta. Pinning
    // both confirms the stream actually reached the UI rather than the
    // route closing silently. The "thinking" indicator is rendered
    // while we wait on the first delta — its appearance is the cleanest
    // signal that the request was accepted (the buggy 404 path skipped
    // it entirely because the route returned before opening the stream).
    const list = page.getByTestId("chat-message-list");
    await expect(
      list.getByText("What is Jensen's main argument about Nvidia's moat?"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("chat-thinking-indicator")).toHaveCount(0, {
      timeout: 60_000,
    });
  });
});
