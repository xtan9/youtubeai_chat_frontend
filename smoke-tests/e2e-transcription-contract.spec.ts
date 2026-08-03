import { expect, test, type Page, type Route } from "@playwright/test";

const BASE_URL = (
  process.env.BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");

const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

type TranscriptScenario = {
  readonly source: "auto_captions" | "whisper";
  readonly statusMessage: string;
  readonly summary: string;
  readonly segments: readonly {
    readonly text: string;
    readonly start: number;
    readonly duration: number;
  }[];
};

const CAPTION_SUCCESS: TranscriptScenario = {
  source: "auto_captions",
  statusMessage: "Processing captions...",
  summary:
    "## Key idea\n\nReliable browser checks protect the complete learning journey.",
  segments: [
    {
      text: "Browser checks begin with a real timestamped transcript.",
      start: 0,
      duration: 31,
    },
    {
      text: "The summary and video chat stay grounded in that transcript.",
      start: 45,
      duration: 7,
    },
  ],
};

const WHISPER_FALLBACK: TranscriptScenario = {
  source: "whisper",
  statusMessage: "No usable captions found. Transcribing audio...",
  summary:
    "## Idea principal\n\nLa transcripción conserva el idioma y los tiempos del video.",
  segments: [
    {
      text: "La transcripción de respaldo conserva el idioma original.",
      start: 0,
      duration: 31,
    },
    {
      text: "Cada segmento mantiene tiempos útiles para navegar el video.",
      start: 52,
      duration: 8,
    },
  ],
};

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function summaryEvents(
  scenario: TranscriptScenario,
  cached = false,
): string {
  return [
    { type: "metadata", category: "general", cached },
    {
      type: "status",
      stage: "transcribe",
      message: scenario.statusMessage,
    },
    {
      type: "full_transcript",
      segments: scenario.segments,
      source: scenario.source,
    },
    { type: "content", text: scenario.summary },
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

async function mockAnonymousSession(page: Page) {
  await page.route("**/auth/v1/signup*", (route) => {
    const now = Math.floor(Date.now() / 1000);
    return fulfillJson(route, {
      access_token: "contract-smoke-access-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: "contract-smoke-refresh-token",
      user: {
        id: "00000000-0000-4000-8000-000000000151",
        aud: "authenticated",
        role: "authenticated",
        email: "",
        phone: "",
        app_metadata: { provider: "anonymous", providers: ["anonymous"] },
        user_metadata: {},
        identities: [],
        created_at: new Date(now * 1000).toISOString(),
        updated_at: new Date(now * 1000).toISOString(),
        is_anonymous: true,
      },
    });
  });
}

async function mockSharedBrowserBoundaries(page: Page) {
  await mockAnonymousSession(page);
  await page.route("**/api/me/entitlements", (route) =>
    fulfillJson(route, {
      tier: "anon",
      caps: { summariesUsed: 0, summariesLimit: 1 },
    })
  );
}

async function submitVideoUrl(page: Page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: /youtube url/i }).fill(VIDEO_URL);
  await page.getByRole("button", { name: /summarize video/i }).click();
  await page.waitForURL(/\/summary\?/);
}

async function mockSuccessfulJourney(
  page: Page,
  scenario: TranscriptScenario,
  options: { readonly cached?: boolean } = {},
) {
  let chatCompleted = false;

  await mockSharedBrowserBoundaries(page);
  await page.route("**/api/summarize/stream", async (route) => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    expect(request.headers().authorization).toBe(
      "Bearer contract-smoke-access-token"
    );
    expect(request.postDataJSON()).toMatchObject({
      youtube_url: VIDEO_URL,
      include_transcript: true,
    });
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body: summaryEvents(scenario, options.cached ?? false),
    });
  });
  await page.route("**/api/chat/messages?*", (route) =>
    fulfillJson(route, {
      messages: chatCompleted
        ? [
            {
              id: "message-user-151",
              role: "user",
              content: "What is the key idea?",
              createdAt: "2026-07-31T12:00:00.000Z",
            },
            {
              id: "message-assistant-151",
              role: "assistant",
              content:
                "The key idea is that the whole learner journey stays grounded. [0:45]",
              createdAt: "2026-07-31T12:00:01.000Z",
            },
          ]
        : [],
    })
  );
  await page.route("**/api/chat/suggestions?*", (route) =>
    fulfillJson(route, { suggestions: ["What is the key idea?"] })
  );
  await page.route("**/api/chat/stream", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      youtube_url: VIDEO_URL,
      message: "What is the key idea?",
    });
    chatCompleted = true;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        `data: ${JSON.stringify({
          type: "delta",
          text: "The key idea is that the whole learner journey stays grounded. [0:45]",
        })}\n`,
        `data: ${JSON.stringify({ type: "done" })}\n`,
      ].join(""),
    });
  });
}

async function mockDeferredSummaryJourney(
  page: Page,
  scenario: TranscriptScenario,
): Promise<() => void> {
  await mockSharedBrowserBoundaries(page);
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/summarize/stream", async (route) => {
    expect(route.request().method()).toBe("POST");
    await responseGate;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body: summaryEvents(scenario, false),
    });
  });
  return release;
}

async function expectUsableTranscript(
  page: Page,
  scenario: TranscriptScenario
) {
  const secondTimestamp = `00:${scenario.segments[1].start
    .toString()
    .padStart(2, "0")}`;
  const transcript = page.getByTestId("transcript-container");
  await expect(transcript).toBeVisible();
  await expect(transcript).toHaveAttribute(
    "data-transcript-source",
    scenario.source
  );
  await expect(transcript).toContainText(scenario.segments[0].text);
  await expect(transcript).toContainText(scenario.segments[1].text);
  await expect(
    page.getByRole("button", { name: "Jump to 00:00" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: `Jump to ${secondTimestamp}`,
    })
  ).toBeVisible();
}

test("caption success flows from URL to Transcript, Summary, and Video Chat", async ({
  page,
}) => {
  await mockSuccessfulJourney(page, CAPTION_SUCCESS);
  await submitVideoUrl(page);

  await expectUsableTranscript(page, CAPTION_SUCCESS);
  await expect(page.getByText("Reliable browser checks protect")).toBeVisible();

  await page.getByRole("tab", { name: "Chat" }).click();
  await page.getByRole("textbox", { name: "Chat message" }).fill(
    "What is the key idea?"
  );
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText(/whole learner journey stays grounded/)
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Seek video to [0:45]" })
  ).toBeVisible();
});

test("documented Whisper fallback keeps a multilingual timestamped Transcript usable", async ({
  page,
}) => {
  await mockSuccessfulJourney(page, WHISPER_FALLBACK);
  await submitVideoUrl(page);

  await expectUsableTranscript(page, WHISPER_FALLBACK);
  await expect(
    page.getByText(/La transcripción conserva el idioma/)
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Chat" })).toBeEnabled();
});

test("live Summary Run renders a non-actionable Draft until the terminal Summary arrives", async ({
  page,
}) => {
  const release = await mockDeferredSummaryJourney(page, CAPTION_SUCCESS);
  await submitVideoUrl(page);

  await expect(page.getByTestId("summary-draft")).toBeVisible();
  await expect(page.getByTestId("summary-draft")).toContainText(
    "Summary Draft",
  );
  await expect(page.getByTestId("summary-results")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Chat" })).toBeDisabled();

  release();
  await expect(page.getByTestId("summary-results")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Chat" })).toBeEnabled();
  await expect(page.getByTestId("summary-draft")).toHaveCount(0);
});

test("cached Summary Run success uses the API metadata and unlocks completed actions", async ({
  page,
}) => {
  await mockSuccessfulJourney(page, CAPTION_SUCCESS, { cached: true });
  await submitVideoUrl(page);

  await expect(page.getByTestId("summary-results")).toBeVisible();
  await expect(page.getByText("Reliable browser checks protect")).toBeVisible();
  await expect(page.getByTestId("summary-draft")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Chat" })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: /copy summary/i }),
  ).toBeVisible();
});

test("typed transcription failure shows safe messaging without partial output", async ({
  page,
}) => {
  await mockSharedBrowserBoundaries(page);
  await page.route("**/api/summarize/stream", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: {
        "cache-control": "no-cache",
        "x-error-id": "VPS_TRANSCRIBE_FAILED_HTTP_503",
      },
      body: `data: ${JSON.stringify({
        type: "error",
        errorId: "VPS_TRANSCRIBE_FAILED_HTTP_503",
        message: "private VPS exception with upstream payload",
      })}\n\n`,
    })
  );

  await submitVideoUrl(page);

  const failure = page.getByTestId("stream-error-banner");
  await expect(failure).toContainText("Summary failed");
  await expect(failure).toContainText("Couldn't process this video");
  await expect(failure).not.toContainText("private VPS exception");
  await expect(failure).toHaveAttribute(
    "data-error-id",
    "PROCESSING_FAILURE"
  );
  await expect(page.getByRole("button", { name: /retry summary/i })).toBeVisible();
  await expect(page.getByTestId("transcript-container")).toHaveCount(0);
  await expect(page.getByText("AI-Generated Video Summary")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Chat" })).toBeDisabled();
});

test("failed Summary Run retries only after an explicit click with the original request inputs", async ({
  page,
}) => {
  await mockSharedBrowserBoundaries(page);
  let requestCount = 0;
  await page.route("**/api/summarize/stream", async (route) => {
    requestCount += 1;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      youtube_url: VIDEO_URL,
      include_transcript: true,
    });

    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          { type: "metadata", category: "general", cached: false },
          { type: "content", text: "Retained draft" },
          {
            type: "error",
            message: "private failure payload",
            errorId: "PRIVATE_FAILURE",
          },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: summaryEvents(CAPTION_SUCCESS),
    });
  });

  await submitVideoUrl(page);
  await expect(page.getByTestId("stream-error-banner")).toBeVisible();
  await expect.poll(() => requestCount).toBe(1);
  await expect(page.getByTestId("summary-draft")).toContainText("Retained draft");
  await expect(page.getByTestId("summary-results")).toHaveCount(0);

  await page.getByRole("button", { name: /retry summary/i }).click();
  await expect.poll(() => requestCount).toBe(2);
  await expect(page.getByTestId("summary-results")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Chat" })).toBeEnabled();
  await expect(page.getByTestId("summary-draft")).toHaveCount(0);
});
