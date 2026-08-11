import { expect, test } from "@playwright/test";
import {
  anonymousSessionFromCookies,
  deleteAnonymousProductionProbe,
  installAnonymousProductionProbeSession,
  markAnonymousProductionProbe,
  refreshAnonymousProductionProbeSession,
} from "./anonymous-trial-production-probe";

const BASE_URL = process.env.BASE_URL ?? process.env.PROD_URL;
const PHASE = process.env.ANONYMOUS_TRIAL_PRODUCTION_SMOKE_PHASE;
const QUESTION = "What does Jensen say supports Nvidia's competitive moat?";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

test("@anonymous-trial-production verifies one admitted question or kill-switch denial", async ({
  context,
  page,
}) => {
  test.skip(
    !BASE_URL || (PHASE !== "admitted" && PHASE !== "killed"),
    "Run only from the manual two-phase Anonymous Trial rollout workflow.",
  );
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error(
      "Anonymous Trial production probe requires Supabase admin credentials",
    );
  }

  await context.clearCookies();
  // Prevent the brief pre-mark bootstrap from creating a human PostHog
  // person. After the trusted marker is installed, the app's identity
  // boundary also opts this synthetic anonymous user out.
  await context.route("**/ingest/**", (route) => route.abort());
  await context.route(/https:\/\/[^/]*posthog\.com\//u, (route) => route.abort());
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

  let probeUserId: string | null = null;
  try {
    const initialSession = await anonymousSessionFromCookies(context);
    probeUserId = await markAnonymousProductionProbe({
      accessToken: initialSession.access_token,
      supabaseUrl: SUPABASE_URL!,
      serviceRoleKey: SUPABASE_SECRET_KEY!,
    });
    const syntheticSession = await refreshAnonymousProductionProbeSession(
      probeUserId,
      initialSession.refresh_token,
      SUPABASE_URL!,
      SUPABASE_SECRET_KEY!,
    );
    await installAnonymousProductionProbeSession(context, syntheticSession);
    await page.reload();

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
        page.getByRole("button", {
          name: /Seek video to \[\d{1,2}:\d{2}(?:[-–]\d{1,2}:\d{2})?\]/u,
        }),
      ).toBeVisible({ timeout: 90_000 });
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: /could not|couldn't|temporarily unavailable|invalid/i }),
      ).toHaveCount(0);
      await expect(
        page.getByText(/selected video does not (?:support|contain) enough evidence/i),
      ).toHaveCount(0);
      await expect(page.getByText(/anonymous_trial_invalid_answer/i)).toHaveCount(0);
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
  } finally {
    if (probeUserId) {
      await deleteAnonymousProductionProbe(
        probeUserId,
        SUPABASE_URL!,
        SUPABASE_SECRET_KEY!,
      );
    }
  }
});
