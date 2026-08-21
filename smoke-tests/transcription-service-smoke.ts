/**
 * Production smoke for the public transcription-service contract.
 *
 * The command intentionally reports only endpoint/status/schema metadata. It
 * never writes request bodies, response bodies, bearer keys, or Transcript
 * content to stdout, the JSON report, or the GitHub step summary.
 */

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CAPTIONED_VIDEO =
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const DEFAULT_CAPTIONLESS_VIDEO =
  "https://www.youtube.com/watch?v=R1uK1QPwYfY";
const DEFAULT_MULTILINGUAL_VIDEO =
  "https://www.youtube.com/watch?v=xMZqTuLWSA4";
const DEFAULT_MULTILINGUAL_LANGUAGE = "zh";
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
const ALLOWED_ERROR_FIELDS = new Set(["error", "errorId", "requestId"]);

type SmokeProfile = "full" | "caption-egress";

type CheckName =
  | "health"
  | "authenticated-metadata"
  | "captioned-video"
  | "captionless-caption-miss"
  | "captionless-whisper"
  | "multilingual-metadata"
  | "multilingual-captions"
  | "safe-failure";

type CheckResult = {
  name: CheckName;
  endpoint: string;
  requestId: string;
  status: "passed" | "failed";
  httpStatus?: number;
  durationMs: number;
  detail: string;
};

type SmokeReport = {
  schemaVersion: 1;
  generatedAt: string;
  targetOrigin: string;
  status: "passed" | "failed";
  checks: CheckResult[];
};

type Config = {
  profile: SmokeProfile;
  baseUrl: string;
  apiKey: string;
  captionedVideo: string;
  captionlessVideo: string;
  multilingualVideo: string;
  multilingualLanguage: string;
  reportPath: string;
  requestTimeoutMs: number;
};

type ResponseRecord = {
  status: number;
  requestId: string;
  errorId: string | null;
  headers: Record<string, string>;
  rawText: string;
  body: unknown;
};

class SmokeCheckError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = "SmokeCheckError";
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured`);
  return value;
}

function parseTimeout(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_REQUEST_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 600_000) {
    throw new Error(
      "SMOKE_REQUEST_TIMEOUT_MS must be a positive integer no greater than 600000"
    );
  }
  return parsed;
}

function parseProfile(value: string | undefined): SmokeProfile {
  const profile = value?.trim() || "full";
  if (profile !== "full" && profile !== "caption-egress") {
    throw new Error("SMOKE_PROFILE must be full or caption-egress");
  }
  return profile;
}

function loadConfig(): Config {
  const baseUrl = requiredEnv("VPS_API_URL").replace(/\/$/, "");
  const parsedBaseUrl = new URL(baseUrl);
  if (parsedBaseUrl.protocol !== "https:" && parsedBaseUrl.hostname !== "127.0.0.1") {
    throw new Error("VPS_API_URL must use HTTPS (localhost is allowed for tests)");
  }

  return {
    profile: parseProfile(process.env.SMOKE_PROFILE),
    baseUrl,
    apiKey: requiredEnv("VPS_API_KEY"),
    captionedVideo:
      process.env.SMOKE_CAPTIONED_VIDEO_URL?.trim() || DEFAULT_CAPTIONED_VIDEO,
    captionlessVideo:
      process.env.SMOKE_CAPTIONLESS_VIDEO_URL?.trim() || DEFAULT_CAPTIONLESS_VIDEO,
    multilingualVideo:
      process.env.SMOKE_MULTILINGUAL_VIDEO_URL?.trim() ||
      DEFAULT_MULTILINGUAL_VIDEO,
    multilingualLanguage:
      process.env.SMOKE_MULTILINGUAL_LANGUAGE?.trim() ||
      DEFAULT_MULTILINGUAL_LANGUAGE,
    reportPath:
      process.env.SMOKE_REPORT_PATH?.trim() ||
      path.join("test-results", "transcription-service-smoke.json"),
    requestTimeoutMs: parseTimeout(process.env.SMOKE_REQUEST_TIMEOUT_MS),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  record: Record<string, unknown>,
  field: string,
  context: string
): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SmokeCheckError(`${context}: ${field} must be a non-empty string`);
  }
  return value;
}

function requireObject(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new SmokeCheckError(`${context}: response must be a JSON object`);
  }
  return value;
}

function primaryLanguage(language: string): string {
  return language.trim().toLowerCase().split("-")[0];
}

function requireSegments(
  record: Record<string, unknown>,
  context: string
): number {
  const segments = record.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new SmokeCheckError(`${context}: segments must be a non-empty array`);
  }
  for (const segment of segments) {
    if (!isRecord(segment)) {
      throw new SmokeCheckError(`${context}: every segment must be an object`);
    }
    requireString(segment, "text", context);
    for (const field of ["start", "duration"] as const) {
      const value = segment[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new SmokeCheckError(
          `${context}: every segment ${field} must be finite and non-negative`
        );
      }
    }
  }
  return segments.length;
}

function sanitizeMessage(message: string, config: Config): string {
  let sanitized = message;
  for (const sensitive of [
    config.apiKey,
    config.baseUrl,
    config.captionedVideo,
    config.captionlessVideo,
    config.multilingualVideo,
  ]) {
    sanitized = sanitized.replaceAll(sensitive, "[redacted]");
  }
  return sanitized
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .slice(0, 300);
}

async function requestJson(
  config: Config,
  endpoint: string,
  requestId: string,
  options: {
    method: "GET" | "POST";
    authenticated: boolean;
    body?: Record<string, unknown>;
  }
): Promise<ResponseRecord> {
  const headers: Record<string, string> = { "X-Request-ID": requestId };
  if (options.authenticated) headers.Authorization = `Bearer ${config.apiKey}`;
  if (options.body) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${endpoint}`, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(config.requestTimeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    const kind = error instanceof Error ? error.name : typeof error;
    throw new SmokeCheckError(`${endpoint}: request failed (${kind})`);
  }

  const rawText = await response.text().catch(() => {
    throw new SmokeCheckError(
      `${endpoint}: response body could not be read`,
      response.status
    );
  });
  let body: unknown;
  try {
    body = JSON.parse(rawText);
  } catch {
    throw new SmokeCheckError(
      `${endpoint}: response body was not JSON`,
      response.status
    );
  }

  const echoedRequestId = response.headers.get("X-Request-ID");
  if (echoedRequestId !== requestId) {
    throw new SmokeCheckError(
      `${endpoint}: X-Request-ID was not echoed exactly`,
      response.status
    );
  }

  return {
    status: response.status,
    requestId,
    errorId: response.headers.get("X-Error-ID"),
    headers: Object.fromEntries(response.headers.entries()),
    rawText,
    body,
  };
}

function requireStatus(response: ResponseRecord, expected: number, context: string) {
  if (response.status !== expected) {
    throw new SmokeCheckError(
      `${context}: expected HTTP ${expected}, received ${response.status}`,
      response.status
    );
  }
}

function requireSafeError(
  response: ResponseRecord,
  config: Config,
  context: string,
  expectedError: string,
  expectedErrorId: string
): Record<string, unknown> {
  const body = requireObject(response.body, context);
  const unexpectedFields = Object.keys(body).filter(
    (field) => !ALLOWED_ERROR_FIELDS.has(field)
  );
  if (unexpectedFields.length > 0) {
    throw new SmokeCheckError(
      `${context}: unexpected error response fields (${unexpectedFields.join(", ")})`,
      response.status
    );
  }
  if (response.rawText.length > 1_024) {
    throw new SmokeCheckError(
      `${context}: error response exceeded 1024 bytes`,
      response.status
    );
  }
  const lowered = response.rawText.toLowerCase();
  const forbiddenValues = [
    config.apiKey,
    config.captionedVideo,
    config.captionlessVideo,
    config.multilingualVideo,
  ];
  if (
    forbiddenValues.some((value) => response.rawText.includes(value)) ||
    lowered.includes("bearer ") ||
    lowered.includes("transcript")
  ) {
    throw new SmokeCheckError(
      `${context}: error response contained secret or Transcript content`,
      response.status
    );
  }
  for (const [name, value] of Object.entries(response.headers)) {
    if (/(authorization|api[-_]?key|secret|token|transcript|cookie)/i.test(name)) {
      throw new SmokeCheckError(
        `${context}: error response contained a sensitive header`,
        response.status
      );
    }
    if (
      forbiddenValues.some((secret) => value.includes(secret)) ||
      /(?:bearer\s+|transcript|\bgsk_|\bsk-|\bsb_secret_|\bgh[opusr]_)/i.test(
        value
      )
    ) {
      throw new SmokeCheckError(
        `${context}: error response header contained secret or Transcript content`,
        response.status
      );
    }
  }
  if (body.error !== expectedError) {
    throw new SmokeCheckError(
      `${context}: error must equal the generic contract value`,
      response.status
    );
  }
  const errorId = requireString(body, "errorId", context);
  if (errorId !== expectedErrorId) {
    throw new SmokeCheckError(
      `${context}: expected errorId ${expectedErrorId}, received ${errorId}`,
      response.status
    );
  }
  if (body.requestId !== response.requestId) {
    throw new SmokeCheckError(
      `${context}: body requestId did not match X-Request-ID`,
      response.status
    );
  }
  if (response.errorId !== errorId) {
    throw new SmokeCheckError(
      `${context}: X-Error-ID did not match body errorId`,
      response.status
    );
  }
  return body;
}

async function runCheck(
  config: Config,
  results: CheckResult[],
  name: CheckName,
  endpoint: string,
  check: (requestId: string) => Promise<{ httpStatus: number; detail: string }>
): Promise<void> {
  const requestId = `smoke-${randomUUID()}`;
  const startedAt = Date.now();
  try {
    const outcome = await check(requestId);
    const result: CheckResult = {
      name,
      endpoint,
      requestId,
      status: "passed",
      httpStatus: outcome.httpStatus,
      durationMs: Date.now() - startedAt,
      detail: outcome.detail,
    };
    results.push(result);
    console.log(
      `[transcription-smoke] PASS ${name} requestId=${requestId} status=${outcome.httpStatus} ${outcome.detail}`
    );
  } catch (error) {
    const message = sanitizeMessage(
      error instanceof Error ? error.message : String(error),
      config
    );
    const httpStatus =
      error instanceof SmokeCheckError ? error.httpStatus : undefined;
    results.push({
      name,
      endpoint,
      requestId,
      status: "failed",
      ...(httpStatus === undefined ? {} : { httpStatus }),
      durationMs: Date.now() - startedAt,
      detail: message,
    });
    console.error(
      `[transcription-smoke] FAIL ${name} requestId=${requestId}: ${message}`
    );
  }
}

function requireMetadata(
  response: ResponseRecord,
  context: string
): Record<string, unknown> {
  requireStatus(response, 200, context);
  const body = requireObject(response.body, context);
  requireString(body, "language", context);
  requireString(body, "title", context);
  if (typeof body.description !== "string") {
    throw new SmokeCheckError(`${context}: description must be a string`);
  }
  if (
    body.duration !== null &&
    (typeof body.duration !== "number" ||
      !Number.isFinite(body.duration) ||
      body.duration < 0)
  ) {
    throw new SmokeCheckError(
      `${context}: duration must be finite, non-negative, or null`
    );
  }
  if (
    !Array.isArray(body.availableCaptions) ||
    body.availableCaptions.some((language) => typeof language !== "string")
  ) {
    throw new SmokeCheckError(
      `${context}: availableCaptions must be a string array`
    );
  }
  return body;
}

function requireTranscriptResponse(
  response: ResponseRecord,
  context: string,
  expectedSource: "auto_captions" | "whisper",
  expectedPrimaryLanguage?: string
): { language: string; segmentCount: number } {
  requireStatus(response, 200, context);
  const body = requireObject(response.body, context);
  if (body.source !== expectedSource) {
    throw new SmokeCheckError(`${context}: source must be ${expectedSource}`);
  }
  const segmentCount = requireSegments(body, context);
  requireString(body, "transcript", context);
  const language = requireString(body, "language", context);
  if (
    expectedPrimaryLanguage !== undefined &&
    primaryLanguage(language) !== primaryLanguage(expectedPrimaryLanguage)
  ) {
    throw new SmokeCheckError(
      `${context}: expected language ${primaryLanguage(expectedPrimaryLanguage)}, received ${primaryLanguage(language)}`
    );
  }
  return { language, segmentCount };
}

async function executeSmoke(config: Config): Promise<SmokeReport> {
  const results: CheckResult[] = [];
  console.log(
    `[transcription-smoke] target=${new URL(config.baseUrl).origin} (responses are redacted)`
  );

  await runCheck(config, results, "health", "/health", async (requestId) => {
    const response = await requestJson(config, "/health", requestId, {
      method: "GET",
      authenticated: false,
    });
    requireStatus(response, 200, "health");
    const body = requireObject(response.body, "health");
    if (body.status !== "ok") {
      throw new SmokeCheckError("health: status must equal ok", response.status);
    }
    return { httpStatus: response.status, detail: "status=ok" };
  });

  const runCaptionedVideoCheck = () =>
    runCheck(
      config,
      results,
      "captioned-video",
      "/captions",
      async (requestId) => {
        const response = await requestJson(config, "/captions", requestId, {
          method: "POST",
          authenticated: true,
          body: { youtube_url: config.captionedVideo },
        });
        const { language, segmentCount } = requireTranscriptResponse(
          response,
          "captioned-video",
          "auto_captions"
        );
        return {
          httpStatus: response.status,
          detail: `source=auto_captions; language=${language}; segments=${segmentCount}`,
        };
      }
    );

  // The hourly profile is intentionally small and uncached. Calling the VPS
  // Caption Track endpoint proves that the residential exit route, YouTube,
  // and the caption provider all work; a process-only /health response cannot.
  if (config.profile === "caption-egress") {
    await runCaptionedVideoCheck();
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      targetOrigin: new URL(config.baseUrl).origin,
      status: results.every((result) => result.status === "passed")
        ? "passed"
        : "failed",
      checks: results,
    };
  }

  await runCheck(
    config,
    results,
    "authenticated-metadata",
    "/metadata",
    async (requestId) => {
      const response = await requestJson(config, "/metadata", requestId, {
        method: "POST",
        authenticated: true,
        body: { youtube_url: config.captionedVideo },
      });
      const body = requireMetadata(response, "authenticated-metadata");
      return {
        httpStatus: response.status,
        detail: `language=${String(body.language)}; duration=${String(body.duration)}`,
      };
    }
  );

  await runCaptionedVideoCheck();

  await runCheck(
    config,
    results,
    "captionless-caption-miss",
    "/captions",
    async (requestId) => {
      const response = await requestJson(config, "/captions", requestId, {
        method: "POST",
        authenticated: true,
        body: { youtube_url: config.captionlessVideo },
      });
      requireStatus(response, 404, "captionless-caption-miss");
      const body = requireSafeError(
        response,
        config,
        "captionless-caption-miss",
        "no_captions",
        "CAPTIONS_NOT_FOUND"
      );
      return {
        httpStatus: response.status,
        detail: `expected miss; errorId=${String(body.errorId)}`,
      };
    }
  );

  await runCheck(
    config,
    results,
    "captionless-whisper",
    "/transcribe",
    async (requestId) => {
      const response = await requestJson(config, "/transcribe", requestId, {
        method: "POST",
        authenticated: true,
        body: { youtube_url: config.captionlessVideo },
      });
      const { language, segmentCount } = requireTranscriptResponse(
        response,
        "captionless-whisper",
        "whisper"
      );
      return {
        httpStatus: response.status,
        detail: `source=whisper; language=${language}; segments=${segmentCount}`,
      };
    }
  );

  await runCheck(
    config,
    results,
    "multilingual-metadata",
    "/metadata",
    async (requestId) => {
      const response = await requestJson(config, "/metadata", requestId, {
        method: "POST",
        authenticated: true,
        body: { youtube_url: config.multilingualVideo },
      });
      const body = requireMetadata(response, "multilingual-metadata");
      const expected = primaryLanguage(config.multilingualLanguage);
      const actual = primaryLanguage(String(body.language));
      const captions = body.availableCaptions as string[];
      if (actual !== expected) {
        throw new SmokeCheckError(
          `multilingual-metadata: expected language ${expected}, received ${actual}`
        );
      }
      if (!captions.some((language) => primaryLanguage(language) === expected)) {
        throw new SmokeCheckError(
          `multilingual-metadata: no ${expected} caption track was reported`
        );
      }
      return {
        httpStatus: response.status,
        detail: `language=${actual}; matchingCaptionTrack=true`,
      };
    }
  );

  await runCheck(
    config,
    results,
    "multilingual-captions",
    "/captions",
    async (requestId) => {
      const response = await requestJson(config, "/captions", requestId, {
        method: "POST",
        authenticated: true,
        body: {
          youtube_url: config.multilingualVideo,
          lang: config.multilingualLanguage,
        },
      });
      const { language, segmentCount } = requireTranscriptResponse(
        response,
        "multilingual-captions",
        "auto_captions",
        config.multilingualLanguage
      );
      return {
        httpStatus: response.status,
        detail: `source=auto_captions; language=${primaryLanguage(language)}; segments=${segmentCount}`,
      };
    }
  );

  await runCheck(
    config,
    results,
    "safe-failure",
    "/metadata",
    async (requestId) => {
      const response = await requestJson(config, "/metadata", requestId, {
        method: "POST",
        authenticated: true,
        body: { youtube_url: "not-a-youtube-url" },
      });
      requireStatus(response, 400, "safe-failure");
      const body = requireSafeError(
        response,
        config,
        "safe-failure",
        "Invalid request",
        "INVALID_REQUEST"
      );
      return {
        httpStatus: response.status,
        detail: `expected invalid-input failure; errorId=${String(body.errorId)}`,
      };
    }
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    targetOrigin: new URL(config.baseUrl).origin,
    status: results.every((result) => result.status === "passed")
      ? "passed"
      : "failed",
    checks: results,
  };
}

async function writeReport(config: Config, report: SmokeReport): Promise<void> {
  await mkdir(path.dirname(config.reportPath), { recursive: true });
  await writeFile(config.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = report.checks.map(
      (check) =>
        `| ${check.name} | ${check.status} | ${check.httpStatus ?? "-"} | \`${check.requestId}\` | ${check.detail.replaceAll("|", "\\|")} |`
    );
    const summary = [
      "## Transcription service contract smoke",
      "",
      `Overall: **${report.status}**`,
      "",
      "| Check | Result | HTTP | Request ID | Detail |",
      "| --- | --- | ---: | --- | --- |",
      ...rows,
      "",
    ].join("\n");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
  }
}

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(
      `[transcription-smoke] configuration error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = 1;
    return;
  }

  const report = await executeSmoke(config);
  await writeReport(config, report);
  console.log(
    `[transcription-smoke] report=${config.reportPath} overall=${report.status}`
  );
  if (report.status === "failed") process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[transcription-smoke] fatal: ${message.slice(0, 300)}`);
  process.exitCode = 1;
});
