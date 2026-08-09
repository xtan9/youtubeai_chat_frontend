import { expect, test, type Page, type Route } from "@playwright/test";

const BASE_URL = (
  process.env.BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");
const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const SUMMARY_RETURN = `/summary?url=${encodeURIComponent(VIDEO_URL)}`;

type ContextualTier = "anon" | "free";

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockBrowserSession(page: Page, tier: ContextualTier) {
  await page.route("**/auth/v1/signup*", (route) => {
    const now = Math.floor(Date.now() / 1000);
    return fulfillJson(route, {
      access_token: `${tier}-contextual-access-token`,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: `${tier}-contextual-refresh-token`,
      user: {
        id: `00000000-0000-4000-8000-00000000030${tier === "anon" ? "4" : "5"}`,
        aud: "authenticated",
        role: "authenticated",
        email: "",
        phone: "",
        app_metadata: { provider: "anonymous", providers: ["anonymous"] },
        user_metadata: {},
        identities: [],
        created_at: new Date(now * 1000).toISOString(),
        updated_at: new Date(now * 1000).toISOString(),
        is_anonymous: tier === "anon",
      },
    });
  });

  await page.route("**/api/me/entitlements", (route) =>
    fulfillJson(route, {
      tier,
      caps: {
        summariesUsed: tier === "anon" ? 1 : 10,
        summariesLimit: tier === "anon" ? 1 : 10,
      },
      subscriptionPresentation:
        tier === "anon" ? { state: "anonymous" } : { state: "free" },
    }),
  );
}

async function openSummary(page: Page) {
  const url = new URL("/summary", BASE_URL);
  url.searchParams.set("url", VIDEO_URL);
  await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
}

function successfulSummaryEvents(): string {
  return [
    { type: "metadata", category: "general", cached: false },
    {
      type: "full_transcript",
      source: "auto_captions",
      segments: [
        {
          text: "The retained counter makes the approaching limit predictable.",
          start: 0,
          duration: 10,
        },
      ],
    },
    { type: "content", text: "## Counter fixture summary" },
    {
      type: "summary",
      category: "general",
      total_time: 3,
      summarize_time: 2,
      transcribe_time: 1,
    },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
}

test.describe("Contextual limit Upgrade journeys", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("anonymous Summary limit signs up with the safe Summary return", async ({
    page,
  }) => {
    await mockBrowserSession(page, "anon");
    await page.route("**/api/summarize/stream", (route) =>
      fulfillJson(
        route,
        {
          message: "Sign up to keep using the app.",
          errorCode: "anon_quota_exceeded",
          tier: "anon",
          upgradeUrl: "/pricing",
        },
        402,
      ),
    );

    await openSummary(page);

    const signup = page.getByRole("link", { name: /sign up free/i });
    await expect(signup).toBeVisible();
    const href = new URL((await signup.getAttribute("href"))!, BASE_URL);
    expect(href.pathname).toBe("/auth/sign-up");
    expect(href.searchParams.get("redirect_to")).toBe(SUMMARY_RETURN);

    await signup.click();
    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === "/auth/sign-up" &&
        url.searchParams.get("redirect_to") === SUMMARY_RETURN
      );
    });
  });

  test("registered Free Summary limit reaches attributed Pricing in one click", async ({
    page,
  }) => {
    await mockBrowserSession(page, "free");
    await page.route("**/api/summarize/stream", (route) =>
      fulfillJson(
        route,
        {
          message: "Summary limit reached.",
          errorCode: "free_quota_exceeded",
          tier: "free",
          upgradeUrl: "/pricing",
        },
        402,
      ),
    );

    await openSummary(page);

    // The authenticated global header also exposes an Upgrade to Pro link.
    // Scope this assertion to the summary paywall so it verifies the
    // contextual journey's attributed destination rather than the header.
    const upgrade = page
      .getByRole("main")
      .getByRole("link", { name: /^upgrade to pro$/i });
    await expect(upgrade).toBeVisible();
    await expect(page.getByText(/\$4\.99\/mo/i)).toHaveCount(0);
    expect(await upgrade.getAttribute("href")).toBe(
      "/pricing?source_surface=summary_limit",
    );

    await upgrade.click();
    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === "/pricing" &&
        url.searchParams.get("source_surface") === "summary_limit"
      );
    });
  });

  test("approaching Video Chat limit retains the 4-of-5 counter without a new paywall", async ({
    page,
  }) => {
    await mockBrowserSession(page, "free");
    await page.route("**/api/summarize/stream", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: successfulSummaryEvents(),
      }),
    );
    await page.route("**/api/chat/messages?*", (route) =>
      fulfillJson(route, {
        messages: Array.from({ length: 4 }).flatMap((_, index) => [
          {
            id: `user-${index}`,
            role: "user",
            content: `Question ${index + 1}`,
            createdAt: `2026-08-08T20:00:0${index * 2}.000Z`,
          },
          {
            id: `assistant-${index}`,
            role: "assistant",
            content: `Answer ${index + 1}`,
            createdAt: `2026-08-08T20:00:0${index * 2 + 1}.000Z`,
          },
        ]),
      }),
    );
    await page.route("**/api/chat/suggestions?*", (route) =>
      fulfillJson(route, { suggestions: [] }),
    );

    await openSummary(page);
    await expect(page.getByText("Counter fixture summary")).toBeVisible();
    await page.getByRole("tab", { name: "Chat" }).click();

    await expect(page.getByText("4 of 5 free messages used")).toBeVisible();
    await expect(
      page.locator('[data-paywall-variant^="chat-"]'),
    ).toHaveCount(0);
  });
});
