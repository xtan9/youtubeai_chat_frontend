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

test("public entry → controlled sign-in → real signed-in chat response", async ({
  page,
}) => {
  test.setTimeout(180_000);

  const baseUrl = requirePreviewUrl();
  const bypassSecret = requireEnv("VERCEL_AUTOMATION_BYPASS_SECRET");
  const email = requireEnv("PREVIEW_TEST_USER_EMAIL");
  const password = requireEnv("PREVIEW_TEST_USER_PASSWORD");

  await test.step("establish preview-only protection bypass", async () => {
    const response = await page.context().request.get(`${baseUrl}/`, {
      headers: {
        "x-vercel-protection-bypass": bypassSecret,
        "x-vercel-set-bypass-cookie": "true",
      },
    });

    expect(response.status()).toBe(200);
    expect(new URL(response.url()).origin).toBe(baseUrl);
  });

  await test.step("render the public cached summary and transcript", async () => {
    await page.goto(`${baseUrl}/`);
    await expect(
      page.getByRole("heading", { name: /Will Nvidia.*moat persist/i }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Jensen Huang argues/).first()).toBeVisible();

    await page.getByRole("tab", { name: /Transcript/i }).click();
    await expect(page.getByText(/^00:0\d$/).first()).toBeVisible();
  });

  await test.step("sign in with the controlled preview identity", async () => {
    await page.goto(`${baseUrl}/auth/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^login$/i }).click();
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
