import { expect, test } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

type FakeYouTubeWindow = Window & {
  YT?: {
    Player: new (element: Element, options: { events?: Record<string, (event: unknown) => void> }) => unknown;
    PlayerState: Record<string, number>;
  };
  __fakePauseCount?: number;
  __fakeCurrentTime?: number;
  __fakePlayerConstructed?: number;
  __setFakeYoutubeTime?: (seconds: number) => void;
};

test.describe("chat timestamp range playback", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("clicking a range seeks to its start and pauses at end + one second", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const testWindow = window as FakeYouTubeWindow;
      let currentTime = 0;
      let playerState = -1;

      class FakePlayer {
        private readonly events: Record<string, (event: unknown) => void>;

        constructor(
          _element: Element,
          options: { events?: Record<string, (event: unknown) => void> },
        ) {
          testWindow.__fakePlayerConstructed =
            (testWindow.__fakePlayerConstructed ?? 0) + 1;
          this.events = options.events ?? {};
          testWindow.__setFakeYoutubeTime = (seconds) => {
            currentTime = seconds;
            testWindow.__fakeCurrentTime = currentTime;
          };
          setTimeout(() => {
            this.events.onReady?.({ target: this });
          }, 0);
        }

        seekTo(seconds: number) {
          currentTime = seconds;
          testWindow.__fakeCurrentTime = currentTime;
        }

        playVideo() {
          playerState = 1;
          this.events.onStateChange?.({ data: playerState });
        }

        pauseVideo() {
          playerState = 2;
          testWindow.__fakePauseCount =
            (testWindow.__fakePauseCount ?? 0) + 1;
          this.events.onStateChange?.({ data: playerState });
        }

        getCurrentTime() {
          return currentTime;
        }

        getPlayerState() {
          return playerState;
        }

        getIframe() {
          return Promise.resolve(document.createElement("iframe"));
        }

        cueVideoById() {}
        loadVideoById() {}
        destroy() {
          return Promise.resolve();
        }
      }

      testWindow.__fakePauseCount = 0;
      testWindow.__fakeCurrentTime = currentTime;
      testWindow.__fakePlayerConstructed = 0;
      const fakeYouTubeApi = {
        Player: FakePlayer,
        PlayerState: {
          UNSTARTED: -1,
          ENDED: 0,
          PLAYING: 1,
          PAUSED: 2,
          BUFFERING: 3,
          CUED: 5,
        },
      };
      // react-youtube's loader normally assigns the real API object when its
      // script finishes. Keep the deterministic stub in place if that script
      // is requested so this regression cannot race a network overwrite.
      Object.defineProperty(testWindow, "YT", {
        configurable: false,
        enumerable: true,
        get: () => fakeYouTubeApi,
        set: () => undefined,
      });
    });

    // Keep the browser flow deterministic without requiring a real Supabase
    // project. The app only needs a session token before it will enable chat;
    // the chat routes themselves are intercepted below.
    await page.route("**/auth/v1/**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({}),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "playwright-range-access-token",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: "playwright-range-refresh-token",
          user: {
            id: "00000000-0000-4000-8000-000000000281",
            aud: "authenticated",
            role: "authenticated",
            email: "range-playback@example.test",
            created_at: "2026-08-08T00:00:00.000Z",
            app_metadata: { provider: "email", providers: ["email"] },
            user_metadata: {},
            identities: [],
            is_anonymous: false,
          },
        }),
      });
    });

    let chatPersisted = false;
    await page.route("**/api/chat/messages**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          messages: chatPersisted
            ? [
                {
                  id: "range-regression",
                  role: "assistant",
                  content: "The cited section is [4:32 - 5:10].",
                  createdAt: "2026-08-08T00:00:00.000Z",
                },
              ]
            : [],
        }),
      }),
    );
    await page.route("**/api/chat/stream", (route) => {
      chatPersisted = true;
      return route.fulfill({
        contentType: "text/event-stream",
        body:
          'data: {"type":"delta","text":"The cited section is [4:32 - 5:10]."}\n\n' +
          'data: {"type":"done"}\n\n',
      });
    });

    await page.goto(`${BASE_URL}/`);
    await expect(
      page.getByRole("heading", { name: /Will Nvidia.*moat persist/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as FakeYouTubeWindow).__fakePlayerConstructed ?? 0,
          ),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    const input = page.getByLabel("Chat message");
    await input.fill("Show me the cited section");
    await page.getByLabel("Send message").click();

    const rangeChip = page.getByRole("button", {
      name: /Seek video to \[4:32 - 5:10\]/i,
    });
    await expect(rangeChip).toBeVisible({ timeout: 15_000 });
    await rangeChip.click();

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as FakeYouTubeWindow).__fakeCurrentTime ?? 0,
        ),
      )
      .toBe(4 * 60 + 32);

    await page.evaluate(() => {
      const testWindow = window as FakeYouTubeWindow;
      testWindow.__setFakeYoutubeTime?.(4 * 60 + 32);
    });

    // Advance in small, playback-sized steps so the monitor can distinguish
    // normal progress from a user drag to an unrelated position.
    for (let seconds = 4 * 60 + 33; seconds <= 5 * 60 + 10; seconds += 1) {
      await page.evaluate((nextSeconds) => {
        const testWindow = window as FakeYouTubeWindow;
        testWindow.__setFakeYoutubeTime?.(nextSeconds);
      }, seconds);
      await page.waitForTimeout(260);
    }

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as FakeYouTubeWindow).__fakePauseCount ?? 0,
        ),
      )
      .toBe(0);

    await page.evaluate(() => {
      const testWindow = window as FakeYouTubeWindow;
      testWindow.__setFakeYoutubeTime?.(5 * 60 + 11);
    });

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as FakeYouTubeWindow).__fakePauseCount ?? 0,
        ),
      )
      .toBe(1);
  });
});
