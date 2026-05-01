// Hero demo widget e2e — runs against `pnpm dev` on :3000 by default,
// or against whatever BASE_URL points to (e.g. a Vercel preview).
//
// The widget bootstraps a Supabase anonymous session on mount, so this
// spec needs an env that can talk to Supabase. Local dev with the
// project's `.env.local` (which carries the public anon key) qualifies.
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test.describe("Hero demo widget", () => {
  test.beforeEach(async ({ context }) => {
    // Logged-in users get redirected to /dashboard before the demo
    // renders. Force the anonymous landing page every time.
    await context.clearCookies();
  });

  test("renders sample 1 and switches to sample 2", async ({ page }) => {
    await page.goto(BASE_URL + "/");

    // The dynamic-imported widget mounts after first paint; wait for
    // the active sample title to appear (Jensen × Dwarkesh by default).
    await expect(
      page.getByRole("heading", { name: /Will Nvidia.*moat persist/i }),
    ).toBeVisible({ timeout: 30_000 });

    // The Jensen summary's TL;DR sentence is rendered inside Col 2
    // markdown — proves real cached content is showing, not just the
    // skeleton.
    await expect(page.getByText(/Jensen Huang argues/).first()).toBeVisible({
      timeout: 10_000,
    });

    // Click the Huberman Sleep card in the carousel.
    await page
      .getByRole("button", { name: /Master Your Sleep/i })
      .click();

    // The active heading in Col 1 swaps to the new sample.
    await expect(
      page.getByRole("heading", { name: /Master Your Sleep/i }),
    ).toBeVisible({ timeout: 5_000 });

    // Col 2 swaps too — the Huberman summary discusses circadian rhythm.
    await expect(page.getByText(/circadian/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("switches to Transcript and shows mm:ss timestamp pills", async ({
    page,
  }) => {
    await page.goto(BASE_URL + "/");
    await expect(
      page.getByRole("heading", { name: /Will Nvidia.*moat persist/i }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("tab", { name: /Transcript/i }).click();

    // Look for any element whose entire text content is a mm:ss
    // timestamp. TranscriptParagraphs zero-pads minutes (formatTimestamp
    // in app/summary/utils/group-segments.ts) so the first segment of
    // any sample renders as "00:00".
    await expect(page.getByText(/^00:0\d$/).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("InputForm is still rendered below the widget", async ({ page }) => {
    await page.goto(BASE_URL + "/");
    await expect(
      page.getByRole("heading", { name: /Will Nvidia.*moat persist/i }),
    ).toBeVisible({ timeout: 30_000 });

    // The "Or try your own video" framing copy
    await expect(
      page.getByRole("heading", { name: /Or try your own video/i }),
    ).toBeVisible();

    // The original input form
    await expect(page.getByPlaceholder(/Enter YouTube URL here/)).toBeVisible();
  });

  test("anon-auth visitor reloading / stays on / (does not bounce to /dashboard)", async ({
    page,
    context,
  }) => {
    // Regression for the bug where the hero's signInAnonymously() issues
    // a JWT with is_anonymous=true, and the middleware's `/` → /dashboard
    // redirect treated that as a real sign-in. Without the is_anonymous
    // guard, every visitor who landed once was bounced to /dashboard on
    // the next visit, where they saw "Welcome back," with an empty name.
    await page.goto(BASE_URL + "/");
    // Wait for the hero to mount and signInAnonymously() to land a cookie.
    await expect(
      page.getByRole("heading", { name: /Will Nvidia.*moat persist/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await context.cookies()).some((c) => /^sb-.*-auth-token$/.test(c.name)), {
        timeout: 10_000,
      })
      .toBe(true);

    // Re-navigate to `/`. The bug was visible on this second hit.
    await page.goto(BASE_URL + "/");
    expect(new URL(page.url()).pathname).toBe("/");
    // Hero is still the page content — confirms we didn't end up on the
    // dashboard's "Welcome back" greeting.
    await expect(
      page.getByRole("heading", { name: /Will Nvidia.*moat persist/i }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
