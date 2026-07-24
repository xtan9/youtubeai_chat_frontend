import path from "node:path";
import { expect, test } from "@playwright/test";

const DEMO_VIDEO_URL =
  "https://www.youtube.com/watch?v=Hrbq66XqtCo";
const CHAT_QUESTION =
  "In one sentence, what is Jensen Huang's main argument about Nvidia's moat?";

type ChatEvent =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly message: string };

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the preview critical gate`);
  }
  return value;
}

function requirePreviewUrl(): string {
  const value = requireEnv("BASE_URL").replace(/\/$/, "");
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".vercel.app")) {
    throw new Error(`Refusing non-Vercel preview URL: ${url.origin}`);
  }
  return url.origin;
}

function parseChatEvents(body: string): ChatEvent[] {
  return body
    .split(/\r?\n\r?\n/)
    .flatMap((block) => block.split(/\r?\n/))
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);
}

test("public entry → controlled signed-in state → real chat response", async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);

  const baseUrl = requirePreviewUrl();
  const publicStorageStatePath = path.join(
    requireEnv("PREVIEW_STORAGE_STATE_DIR"),
    "public-storage-state.json",
  );

  await test.step("render the anonymous public cached summary and transcript", async () => {
    const publicContext = await browser.newContext({
      baseURL: baseUrl,
      storageState: publicStorageStatePath,
    });
    try {
      const publicPage = await publicContext.newPage();
      await publicPage.goto("/", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await expect(
        publicPage.getByRole("heading", {
          name: /Will Nvidia.*moat persist/i,
        }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        publicPage.getByText(/Jensen Huang argues/).first(),
      ).toBeVisible();

      await publicPage.getByRole("tab", { name: /Transcript/i }).click();
      await expect(publicPage.getByText(/^00:0\d$/).first()).toBeVisible();
    } finally {
      await publicContext.close();
    }
  });

  await test.step("confirm the controlled signed-in state", async () => {
    await page.goto(`${baseUrl}/`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: /user menu/i })).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step("receive a non-empty response from the real chat stream", async () => {
    const response = await page.evaluate(
      async ({ question, videoUrl }) => {
        const result = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            youtube_url: videoUrl,
            message: question,
          }),
        });
        return {
          status: result.status,
          body: await result.text(),
        };
      },
      { question: CHAT_QUESTION, videoUrl: DEMO_VIDEO_URL },
    );

    expect(response.status).toBe(200);
    const events = parseChatEvents(response.body);
    expect(events.some((event) => event.type === "error")).toBe(false);

    const assistantText = events
      .filter(
        (event): event is Extract<ChatEvent, { type: "delta" }> =>
          event.type === "delta",
      )
      .map((event) => event.text)
      .join("")
      .trim();
    expect(assistantText.length).toBeGreaterThan(0);
    expect(events.at(-1)).toEqual({ type: "done" });
  });
});
