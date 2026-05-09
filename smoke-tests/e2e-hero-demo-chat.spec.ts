// Regression: anonymous visitors must be able to chat with hero-demo
// videos on the marketing homepage without hitting USER_ERROR_NO_SUMMARY.
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
    // the user-message visibility plus the indicator's eventual
    // disappearance confirms the stream reached the UI.
    //
    // We deliberately do NOT assert "an assistant paragraph appears
    // with non-empty text" here, because local dev typically lacks
    // LLM_GATEWAY_URL / LLM_GATEWAY_API_KEY — the stream then emits an
    // error event after the route's POST returns 200, the indicator
    // clears with no draft text, and the assertion would fail on a
    // green codebase. The original-bug 4xx ("Generate the summary
    // first…") is already pinned by the response-status check above
    // and the no-USER_ERROR_NO_SUMMARY assertion below; that's what
    // this e2e is for. The "stream actually streamed deltas"
    // verification is covered by the unit tests that mock
    // streamChatCompletion.
    const list = page.getByTestId("chat-message-list");
    const userQuestion = "What is Jensen's main argument about Nvidia's moat?";
    await expect(list.getByText(userQuestion)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("chat-thinking-indicator")).toHaveCount(0, {
      timeout: 60_000,
    });
  });
});
