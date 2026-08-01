import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT_PATH = path.join(
  REPO_ROOT,
  "smoke-tests",
  "transcription-service-smoke.ts"
);
const SECRET = "fixture-secret-that-must-never-be-reported";
const TRANSCRIPT_MARKER = "private spoken words that must stay out of reports";
const CAPTIONED_VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const CAPTIONLESS_VIDEO = "https://www.youtube.com/watch?v=R1uK1QPwYfY";
const MULTILINGUAL_VIDEO = "https://www.youtube.com/watch?v=xMZqTuLWSA4";

type RecordedRequest = {
  method: string;
  path: string;
  requestId: string | undefined;
  authorization: string | undefined;
  body: Record<string, unknown> | null;
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

async function readJsonBody(
  request: IncomingMessage
): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
    string,
    unknown
  >;
}

function sendJson(
  response: ServerResponse,
  status: number,
  requestId: string | undefined,
  body: Record<string, unknown>,
  errorId?: string
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  if (requestId) response.setHeader("X-Request-ID", requestId);
  if (errorId) response.setHeader("X-Error-ID", errorId);
  response.end(JSON.stringify(body));
}

async function startFixtureService(options?: {
  captionMissErrorId?: string;
  leakFailureBody?: boolean;
  leakFailureHeader?: boolean;
}) {
  const requests: RecordedRequest[] = [];
  const server = createServer(async (request, response) => {
    const requestId = request.headers["x-request-id"] as string | undefined;
    const authorization = request.headers.authorization;
    const body = request.method === "POST" ? await readJsonBody(request) : null;
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      requestId,
      authorization,
      body,
    });

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, requestId, { status: "ok" });
      return;
    }

    if (authorization !== `Bearer ${SECRET}`) {
      sendJson(
        response,
        403,
        requestId,
        { error: "Forbidden", errorId: "AUTH_INVALID", requestId },
        "AUTH_INVALID"
      );
      return;
    }

    const youtubeUrl = body?.youtube_url;
    if (request.url === "/metadata" && youtubeUrl === "not-a-youtube-url") {
      const failureBody: Record<string, unknown> = {
        error: "Invalid request",
        errorId: "INVALID_REQUEST",
        requestId,
      };
      if (options?.leakFailureBody) {
        failureBody.error = TRANSCRIPT_MARKER;
      }
      if (options?.leakFailureHeader) {
        response.setHeader("X-Provider-Api-Key", "gsk_leaked-provider-key");
      }
      sendJson(response, 400, requestId, failureBody, "INVALID_REQUEST");
      return;
    }

    if (request.url === "/metadata") {
      const multilingual = youtubeUrl === MULTILINGUAL_VIDEO;
      sendJson(response, 200, requestId, {
        language: multilingual ? "zh" : "en",
        title: multilingual ? "Mandarin test Video" : "Captioned test Video",
        description: "Safe public smoke fixture",
        duration: multilingual ? 120 : 212,
        availableCaptions: multilingual ? ["zh-Hans", "en"] : ["en"],
      });
      return;
    }

    if (request.url === "/captions" && youtubeUrl === CAPTIONLESS_VIDEO) {
      const errorId = options?.captionMissErrorId ?? "CAPTIONS_NOT_FOUND";
      sendJson(
        response,
        404,
        requestId,
        { error: "no_captions", errorId, requestId },
        errorId
      );
      return;
    }

    if (request.url === "/captions") {
      const multilingual = youtubeUrl === MULTILINGUAL_VIDEO;
      sendJson(response, 200, requestId, {
        segments: [{ text: TRANSCRIPT_MARKER, start: 0, duration: 1.5 }],
        transcript: TRANSCRIPT_MARKER,
        source: "auto_captions",
        language: multilingual ? "zh-Hans" : "en",
        title: "Safe public smoke fixture",
        channelName: "Fixture channel",
      });
      return;
    }

    if (request.url === "/transcribe" && youtubeUrl === CAPTIONLESS_VIDEO) {
      sendJson(response, 200, requestId, {
        segments: [{ text: TRANSCRIPT_MARKER, start: 0, duration: 2 }],
        transcript: TRANSCRIPT_MARKER,
        source: "whisper",
        language: "auto",
      });
      return;
    }

    sendJson(
      response,
      404,
      requestId,
      { error: "Not found", errorId: "NOT_FOUND", requestId },
      "NOT_FOUND"
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function runSmoke(baseUrl: string) {
  const reportDirectory = await mkdtemp(
    path.join(tmpdir(), "transcription-service-smoke-")
  );
  temporaryDirectories.push(reportDirectory);
  const reportPath = path.join(reportDirectory, "report.json");

  const child = spawn(process.execPath, ["--import", "tsx", SCRIPT_PATH], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      VPS_API_URL: baseUrl,
      VPS_API_KEY: SECRET,
      SMOKE_CAPTIONED_VIDEO_URL: CAPTIONED_VIDEO,
      SMOKE_CAPTIONLESS_VIDEO_URL: CAPTIONLESS_VIDEO,
      SMOKE_MULTILINGUAL_VIDEO_URL: MULTILINGUAL_VIDEO,
      SMOKE_MULTILINGUAL_LANGUAGE: "zh",
      SMOKE_REPORT_PATH: reportPath,
      SMOKE_REQUEST_TIMEOUT_MS: "5000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  const report = JSON.parse(await readFile(reportPath, "utf8")) as {
    status: string;
    checks: Array<{
      name: string;
      requestId: string;
      status: string;
      detail: string;
    }>;
  };
  return { exitCode, stdout, stderr, report };
}

describe("transcription service smoke command", () => {
  it("verifies every live contract path and records a redacted request-ID report", async () => {
    const fixture = await startFixtureService();
    try {
      const result = await runSmoke(fixture.baseUrl);

      expect(result.exitCode).toBe(0);
      expect(result.report.status).toBe("passed");
      expect(result.report.checks.map((check) => check.name)).toEqual([
        "health",
        "authenticated-metadata",
        "captioned-video",
        "captionless-caption-miss",
        "captionless-whisper",
        "multilingual-metadata",
        "multilingual-captions",
        "safe-failure",
      ]);
      expect(
        result.report.checks.every(
          (check) => check.status === "passed" && check.requestId.length > 0
        )
      ).toBe(true);
      expect(new Set(result.report.checks.map((check) => check.requestId)).size).toBe(
        result.report.checks.length
      );

      const combinedOutput = result.stdout + result.stderr;
      expect(combinedOutput).not.toContain(SECRET);
      expect(combinedOutput).not.toContain(TRANSCRIPT_MARKER);
      expect(JSON.stringify(result.report)).not.toContain(SECRET);
      expect(JSON.stringify(result.report)).not.toContain(TRANSCRIPT_MARKER);

      expect(fixture.requests).toHaveLength(8);
      for (const request of fixture.requests) {
        expect(request.requestId).toBeTruthy();
        if (request.path !== "/health") {
          expect(request.authorization).toBe(`Bearer ${SECRET}`);
        }
      }
      expect(
        fixture.requests.some(
          (request) =>
            request.path === "/transcribe" &&
            request.body?.youtube_url === CAPTIONLESS_VIDEO
        )
      ).toBe(true);
    } finally {
      await fixture.close();
    }
  });

  it("fails closed without echoing an unsafe error response", async () => {
    const fixture = await startFixtureService({ leakFailureBody: true });
    try {
      const result = await runSmoke(fixture.baseUrl);

      expect(result.exitCode).toBe(1);
      expect(result.report.status).toBe("failed");
      expect(result.report.checks.at(-1)).toMatchObject({
        name: "safe-failure",
        status: "failed",
      });
      const combinedOutput = result.stdout + result.stderr;
      expect(combinedOutput).toContain("safe-failure");
      expect(combinedOutput).toContain("error must equal the generic contract value");
      expect(combinedOutput).not.toContain(SECRET);
      expect(combinedOutput).not.toContain(TRANSCRIPT_MARKER);
      expect(JSON.stringify(result.report)).not.toContain(TRANSCRIPT_MARKER);
    } finally {
      await fixture.close();
    }
  });

  it("fails when the deployed caption-miss error ID drifts", async () => {
    const fixture = await startFixtureService({
      captionMissErrorId: "REGRESSED_CAPTION_MISS",
    });
    try {
      const result = await runSmoke(fixture.baseUrl);

      expect(result.exitCode).toBe(1);
      expect(result.report.checks[3]).toMatchObject({
        name: "captionless-caption-miss",
        status: "failed",
      });
      expect(result.report.checks[3].detail).toContain(
        "expected errorId CAPTIONS_NOT_FOUND"
      );
    } finally {
      await fixture.close();
    }
  });

  it("fails without echoing a sensitive response header", async () => {
    const fixture = await startFixtureService({ leakFailureHeader: true });
    try {
      const result = await runSmoke(fixture.baseUrl);

      expect(result.exitCode).toBe(1);
      const combinedOutput = result.stdout + result.stderr;
      expect(combinedOutput).toContain("sensitive header");
      expect(combinedOutput).not.toContain("gsk_leaked-provider-key");
      expect(JSON.stringify(result.report)).not.toContain(
        "gsk_leaked-provider-key"
      );
    } finally {
      await fixture.close();
    }
  });
});
