import { expect, test, type Page, type Route } from "@playwright/test";

const BASE_URL = (
  process.env.BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");

const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const NEXT_VIDEO_URL = "https://www.youtube.com/watch?v=9bZkp7q19f0";

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

type TranscriptWireMode = "valid" | "missing" | "malformed";

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
  transcriptMode: TranscriptWireMode = "valid",
): string {
  const events: Record<string, unknown>[] = [
    { type: "metadata", category: "general", cached },
    {
      type: "status",
      stage: "transcribe",
      message: scenario.statusMessage,
    },
  ];

  if (transcriptMode === "valid") {
    events.push({
      type: "full_transcript",
      segments: scenario.segments,
      source: scenario.source,
    });
  } else if (transcriptMode === "malformed") {
    events.push({
      type: "full_transcript",
      segments: [{ text: "legacy transcript", start: 0, duration: 0 }],
      source: scenario.source,
    });
  }

  events.push(
    { type: "content", text: scenario.summary },
    {
      type: "summary",
      category: "general",
      total_time: 3,
      summarize_time: 2,
      transcribe_time: 1,
    },
  );

  return events
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

async function openSummaryUrl(page: Page) {
  const summaryUrl = new URL("/summary", BASE_URL);
  summaryUrl.searchParams.set("url", VIDEO_URL);
  await page.goto(summaryUrl.toString(), { waitUntil: "domcontentloaded" });
}

async function mockSuccessfulJourney(
  page: Page,
  scenario: TranscriptScenario,
  options: {
    readonly cached?: boolean;
    readonly responseDelayMs?: number;
    readonly transcriptMode?: TranscriptWireMode;
    readonly acceptedVideoUrls?: readonly string[];
  } = {},
) {
  let chatCompleted = false;

  await mockSharedBrowserBoundaries(page);
  await page.route("**/api/summarize/stream", async (route) => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    expect(request.headers().authorization).toBe(
      "Bearer contract-smoke-access-token"
    );
    const requestBody = request.postDataJSON() as {
      youtube_url?: string;
      include_transcript?: boolean;
    };
    expect(requestBody.include_transcript).toBe(true);
    expect(options.acceptedVideoUrls ?? [VIDEO_URL]).toContain(
      requestBody.youtube_url,
    );
    if (options.responseDelayMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, options.responseDelayMs),
      );
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body: summaryEvents(
        scenario,
        options.cached ?? false,
        options.transcriptMode ?? "valid",
      ),
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

const RACE_NATIVE_SUMMARY =
  "STALE NATIVE SUMMARY MUST NEVER REPLACE THE NEW LANGUAGE RESULT.";
const RACE_SPANISH_SUMMARY =
  "RESUMEN ESPAÑOL ACTUAL: ESTE ES EL RESULTADO DE LA NUEVA EJECUCIÓN.";

async function mockRacingLanguageJourney(page: Page): Promise<{
  readonly releaseFirst: () => void;
  readonly firstResponseFulfilled: Promise<void>;
}> {
  await mockSharedBrowserBoundaries(page);
  let releaseFirst!: () => void;
  let markFirstResponseFulfilled!: () => void;
  const firstResponseGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const firstResponseFulfilled = new Promise<void>((resolve) => {
    markFirstResponseFulfilled = resolve;
  });

  await page.route("**/api/summarize/stream", async (route) => {
    const requestBody = route.request().postDataJSON() as {
      output_language?: string;
    };
    const isReplacement = requestBody.output_language === "es";

    if (!isReplacement) {
      await firstResponseGate;
      try {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: { "cache-control": "no-cache" },
          body: summaryEvents(
            { ...CAPTION_SUCCESS, summary: RACE_NATIVE_SUMMARY },
            false,
          ),
        });
      } finally {
        markFirstResponseFulfilled();
      }
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body: summaryEvents(
        { ...CAPTION_SUCCESS, summary: RACE_SPANISH_SUMMARY },
        false,
      ),
    });
  });

  return { releaseFirst, firstResponseFulfilled };
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

async function expectFullVideoAtPageTop(page: Page) {
  const videoRegion = page.getByTestId("summary-video-region");
  await expect
    .poll(async () => page.evaluate(() => window.scrollY), { timeout: 3_000 })
    .toBeLessThanOrEqual(1);

  const [headerBox, videoBox] = await Promise.all([
    page.locator("header").first().boundingBox(),
    videoRegion.boundingBox(),
  ]);
  expect(headerBox).not.toBeNull();
  expect(videoBox).not.toBeNull();
  expect(videoBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
  expect(videoBox!.y + videoBox!.height).toBeLessThanOrEqual(844);
}

async function expectMobileVideoAspectRatio(page: Page) {
  const iframe = page.getByTestId("summary-video-region").locator("iframe");
  await expect
    .poll(async () => {
      const box = await iframe.boundingBox();
      if (!box || box.height === 0) return Number.POSITIVE_INFINITY;
      return Math.abs(box.width / box.height - 16 / 9);
    })
    .toBeLessThan(0.02);
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

test("opt-in Summary seam polls Continue Learning and enters Summarize Next", async ({
  page,
}) => {
  test.skip(
    process.env.CONTINUE_LEARNING_READER_ENABLED?.trim().toLowerCase() !==
      "true",
    "Set CONTINUE_LEARNING_READER_ENABLED=true to exercise the dormant learner seam.",
  );

  await mockSuccessfulJourney(page, CAPTION_SUCCESS, {
    acceptedVideoUrls: [VIDEO_URL, NEXT_VIDEO_URL],
  });
  let feedbackBody: unknown;
  await page.route("**/api/continue-learning*", async (route) => {
    if (route.request().url().endsWith("/feedback")) {
      feedbackBody = route.request().postDataJSON();
      return fulfillJson(route, {
        outcome: "recorded",
        judgment: "useful",
        ordinal: 1,
      });
    }
    return fulfillJson(route, {
      outcome: "ready",
      setVersionToken: "cl1s.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      items: [
        {
          token: "cl1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          ordinal: 1,
          canonicalUrl: NEXT_VIDEO_URL,
          title: "A next lesson",
          channelName: "Teaching Channel",
          thumbnailUrl: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
          relationship: "deeper_explanation",
          explanation: "Builds on the source concept.",
        },
      ],
    });
  });
  await submitVideoUrl(page);

  const section = page.getByTestId("continue-learning-section");
  await expect(section).toBeVisible();
  await expect(section.getByRole("listitem")).toContainText("A next lesson");
  const next = section.getByRole("link", { name: /summarize next/i });
  await expect(next).toHaveAttribute(
    "href",
    `/summary?url=${encodeURIComponent(NEXT_VIDEO_URL)}`,
  );
  const useful = section.getByRole("button", { name: "Useful recommendation" });
  await expect(useful).toHaveAttribute("aria-pressed", "false");
  await useful.click();
  await expect(useful).toHaveAttribute("aria-pressed", "true");
  expect(feedbackBody).toEqual({
    token: "cl1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    judgment: "useful",
  });
  await Promise.all([
    page.waitForURL(/\/summary\?url=/),
    next.click(),
  ]);
  await expect(page.getByTestId("summary-results")).toBeVisible();
});

test("mobile Summary workspace keeps Video first and navigates three sticky tabs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSuccessfulJourney(page, CAPTION_SUCCESS);
  await submitVideoUrl(page);

  await expect(page.getByTestId("summary-results")).toBeVisible();
  const videoRegion = page.getByTestId("summary-video-region");
  const tabRail = page.getByTestId("summary-tab-rail");
  await expect(videoRegion).toBeVisible();
  await expect(page.getByRole("tab")).toHaveText([
    "Summary",
    "Transcript",
    "Chat",
  ]);
  expect(
    await videoRegion.evaluate(
      (video, rail) =>
        Boolean(
          video.compareDocumentPosition(rail as Node) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      await tabRail.elementHandle(),
    ),
  ).toBe(true);

  await page.getByRole("tab", { name: "Transcript" }).click();
  await expect(page).toHaveURL(/(?:\?|&)tab=transcript(?:&|$)/);
  await expectUsableTranscript(page, CAPTION_SUCCESS);

  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.style.height = "1600px";
    document
      .querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]')
      ?.append(spacer);
    window.scrollTo(0, 900);
  });
  await expect
    .poll(async () => {
      const railBox = await tabRail.boundingBox();
      if (!railBox) return Number.POSITIVE_INFINITY;
      return Math.abs(railBox.y);
    })
    .toBeLessThanOrEqual(1);

  await page.getByRole("tab", { name: "Chat" }).click();
  await expect(page).toHaveURL(/(?:\?|&)tab=chat(?:&|$)/);
  const chatInput = page.getByRole("textbox", { name: "Chat message" });
  await expect(chatInput).toBeVisible();
  await expect
    .poll(async () => {
      const chatBox = await chatInput
        .locator("xpath=ancestor::div[@data-slot='tabs-content']/div")
        .boundingBox();
      return chatBox ? chatBox.y + chatBox.height : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(845);

  await page.goBack();
  await expect(page).toHaveURL(/(?:\?|&)tab=transcript(?:&|$)/);
  await expect(page.getByRole("tab", { name: "Transcript" })).toHaveAttribute(
    "data-state",
    "active",
  );
});

test("mobile completed Summary reload settles at the top with the full Video visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSuccessfulJourney(page, CAPTION_SUCCESS, {
    responseDelayMs: 500,
  });
  await openSummaryUrl(page);
  await expect(page.getByTestId("summary-results")).toBeVisible();
  await expectMobileVideoAspectRatio(page);

  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectFullVideoAtPageTop(page);
  await expect(page.getByTestId("summary-results")).toBeVisible();

  await expectFullVideoAtPageTop(page);
  await page.waitForTimeout(500);
  await expectFullVideoAtPageTop(page);
});

test("mobile Transcript timestamp reveals the full Video from the page top", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockSuccessfulJourney(page, CAPTION_SUCCESS);
  await openSummaryUrl(page);
  await expect(page.getByTestId("summary-results")).toBeVisible();
  await expectMobileVideoAspectRatio(page);

  await page.getByRole("tab", { name: "Transcript" }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const timestampButton = page.getByRole("button", { name: "Jump to 00:45" });
  await timestampButton.scrollIntoViewIfNeeded();
  const transcriptScrollPosition = await page.evaluate(() => window.scrollY);
  await expect
    .poll(
      async () => {
        await page.evaluate(
          (position) => window.scrollTo(0, position),
          transcriptScrollPosition,
        );
        await timestampButton.click();
        return page.evaluate(() => window.scrollY);
      },
      { timeout: 15_000, intervals: [250] },
    )
    .toBeLessThanOrEqual(1);

  await expectFullVideoAtPageTop(page);
  await page.getByRole("tab", { name: "Summary" }).click();
  await expect(page.getByRole("tab", { name: "Summary" })).toHaveAttribute(
    "data-state",
    "active",
  );
  await page.getByRole("tab", { name: "Transcript" }).click();
  await expect(page.getByRole("tab", { name: "Transcript" })).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect
    .poll(async () => page.evaluate(() => window.scrollY))
    .toBe(transcriptScrollPosition);
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

test("explicit cancellation keeps a Draft non-actionable after a late response", async ({
  page,
}) => {
  const release = await mockDeferredSummaryJourney(page, CAPTION_SUCCESS);
  await submitVideoUrl(page);

  await expect(page.getByTestId("summary-draft")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /cancel summary/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: /cancel summary/i }).click();

  await expect(page.getByTestId("summary-draft")).toBeVisible();
  await expect(page.getByTestId("stream-error-banner")).toHaveCount(0);
  await expect(page.getByTestId("summary-results")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Chat" })).toBeDisabled();

  release();
  await expect(page.getByTestId("summary-results")).toHaveCount(0);
  await expect(page.getByTestId("stream-error-banner")).toHaveCount(0);
});

test("in-flight language replacement ignores stale output from the old run", async ({
  page,
}) => {
  const { releaseFirst, firstResponseFulfilled } =
    await mockRacingLanguageJourney(page);

  await submitVideoUrl(page);
  await expect(page.getByTestId("summary-draft")).toBeVisible();

  const replacementRequest = page.waitForRequest((request) => {
    if (!request.url().includes("/api/summarize/stream")) return false;
    const body = request.postDataJSON() as { output_language?: string };
    return body.output_language === "es";
  });
  await page.getByRole("button", { name: /summary language:/i }).click();
  await page.getByRole("menuitem", { name: /Español/i }).click();
  await replacementRequest;

  await expect(page.getByText(RACE_SPANISH_SUMMARY)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Chat" })).toBeEnabled();

  releaseFirst();
  await firstResponseFulfilled;
  await expect(page.getByText(RACE_NATIVE_SUMMARY)).toHaveCount(0);
  await expect(page.getByText(RACE_SPANISH_SUMMARY)).toBeVisible();
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

test("a successful Summary without timed Transcript data explains that seeking is unavailable", async ({
  page,
}) => {
  await mockSuccessfulJourney(page, CAPTION_SUCCESS, {
    transcriptMode: "missing",
  });
  await submitVideoUrl(page);

  await expect(page.getByTestId("summary-results")).toBeVisible();
  await expect(page.getByTestId("transcript-container")).toHaveCount(0);
  const videoNotice = page.getByTestId("transcript-timing-notice");
  await expect(videoNotice).toHaveAttribute(
    "data-transcript-status",
    "unavailable",
  );
  await expect(videoNotice).toContainText(/timestamp seeking is unavailable/i);

  await page.getByRole("tab", { name: "Chat" }).click();
  await expect(page.getByTestId("chat-transcript-timing-notice")).toContainText(
    /timestamp seeking is unavailable/i,
  );
});

test("malformed timed Transcript data does not discard an otherwise valid Summary", async ({
  page,
}) => {
  await mockSuccessfulJourney(page, CAPTION_SUCCESS, {
    transcriptMode: "malformed",
  });
  await submitVideoUrl(page);

  await expect(page.getByTestId("summary-results")).toBeVisible();
  await expect(page.getByText(/Reliable browser checks protect/)).toBeVisible();
  await expect(page.getByTestId("transcript-container")).toHaveCount(0);
  await expect(page.getByTestId("transcript-timing-notice")).toHaveAttribute(
    "data-transcript-status",
    "unavailable",
  );
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
