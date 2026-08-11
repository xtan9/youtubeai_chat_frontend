import { expect, test } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? process.env.PROD_URL;
const PHASE = process.env.ANONYMOUS_TRIAL_PRODUCTION_SMOKE_PHASE;
const QUESTION = "What does Jensen say supports Nvidia's competitive moat?";

test("@anonymous-trial-production verifies one admitted question or kill-switch denial", async ({
  context,
  page,
}) => {
  test.skip(
    !BASE_URL || (PHASE !== "admitted" && PHASE !== "killed"),
    "Run only from the manual two-phase Anonymous Trial rollout workflow.",
  );

  await context.clearCookies();
  await page.goto(BASE_URL!);
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
  await expect(input).toBeVisible();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/chat/stream") &&
      response.request().method() === "POST",
    { timeout: 90_000 },
  );

  await input.fill(QUESTION);
  await page.getByLabel("Send message").click();
  const response = await responsePromise;

  if (PHASE === "admitted") {
    expect(response.status()).toBe(200);
    await expect(page.getByText(QUESTION)).toBeVisible();
    await expect(
      page.getByTestId("chat-message-list").locator("p"),
    ).toHaveCount(2, { timeout: 90_000 });
    return;
  }

  expect(response.status()).toBe(503);
  expect(response.headers()["x-error-id"]).toBe(
    "ANONYMOUS_TRIAL_GLOBAL_SHUTDOWN",
  );
  await expect(page.getByRole("alert")).toContainText(
    "Anonymous chat is temporarily unavailable",
  );
  await expect(input).toBeVisible();
});
