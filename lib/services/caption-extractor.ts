import { z } from "zod";
import type {
  PromptLocale,
  TranscriptSegment,
  TranscriptSource,
} from "./summarize-cache";
import { decodeCaptionEntities } from "@/lib/utils/decode-caption-entities";
import { REQUEST_ID_HEADER } from "../request-id";
import { logAppEvent, redactSensitiveText } from "../observability";
import { fetchWithVpsKeyRotation, getVpsApiKeys } from "./vps-auth";
import { extractVideoId } from "./youtube-url";
import {
  NonEmptyTranscriptSegmentSchema,
  NonEmptyTranscriptSchema,
  TranscriptionRequestSchema,
  isTimeoutError,
  resolveBoundedTimeoutMs,
  throwCallerAbort,
} from "./transcription-contract";

export { extractVideoId };

// The VPS response doesn't distinguish ASR from uploader-provided tracks, so
// everything through this path is honestly labelled auto_captions.
export type CaptionSource = Extract<TranscriptSource, "auto_captions">;

export interface CaptionResult {
  readonly segments: readonly TranscriptSegment[];
  readonly source: CaptionSource;
  readonly language: PromptLocale;
  readonly title: string;
  readonly channelName: string;
}

// The caption path has one recoverable outcome (a bounded HTTP 404 with the
// CAPTIONS_NOT_FOUND classification) and several failures that must stop the
// pipeline. Keep those failures typed so the orchestrator cannot accidentally
// turn a VPS outage into a paid Whisper request.
export class CaptionExtractionError extends Error {
  public readonly bodyExcerpt?: string;

  constructor(
    public readonly status:
      | number
      | "network"
      | "timeout"
      | "schema",
    bodyExcerpt?: string
  ) {
    const truncated = bodyExcerpt
      ? redactSensitiveText(bodyExcerpt).slice(0, 200)
      : undefined;
    super(
      `VPS captions failed (${status})${truncated ? `: ${truncated}` : ""}`
    );
    this.bodyExcerpt = truncated;
    this.name = "CaptionExtractionError";
  }
}

export function captionErrorId(
  status: CaptionExtractionError["status"]
): string {
  if (typeof status === "number") {
    return `VPS_CAPTIONS_FAILED_HTTP_${status}`;
  }
  return `VPS_CAPTIONS_FAILED_${status.toUpperCase()}`;
}

const CaptionSegmentSchema = NonEmptyTranscriptSegmentSchema;

// Matches the VPS /captions 200 contract. VPS returns `string | null` for
// title/channelName when video metadata is unavailable; normalize to "" here
// so the route's existing string contract holds.
//
// During the rollout window the schema accepts either shape:
// - new VPS emits `segments` (canonical) plus `transcript` (back-compat
//   for an old frontend deployment that hasn't picked up segments yet)
// - old VPS emits only `transcript`. We synthesize a single segment from
//   it so this frontend works during the deploy crossover. Those rows
//   show one un-clickable paragraph at 00:00 — same fail-soft as the
//   legacy DB migration backfill — and resolve themselves once the new
//   VPS ships.
// Drop the `transcript`-only branch in the cleanup PR after the service
// has been live long enough to retire the alias.
const CaptionsResponseSchema = z
  .object({
    // `.min(1)` rules out the failure mode where the VPS returns
    // `{segments: [], transcript: ""}` after some upstream bug. Without it,
    // an empty array could be mistaken for a healthy "no captions" 404.
    segments: z.array(CaptionSegmentSchema).min(1).optional(),
    transcript: NonEmptyTranscriptSchema.optional(),
    source: z.literal("auto_captions"),
    language: z.enum(["en", "zh"]),
    title: z.string().nullable(),
    channelName: z.string().nullable(),
  })
  .refine((data) => data.segments !== undefined || data.transcript !== undefined, {
    message: "either `segments` or `transcript` is required",
  });

// Error responses are a separate, bounded wire contract. The frontend must
// inspect the service classification before treating a non-success response
// as Caption Track Absent; an HTTP status alone is not sufficient.
const BoundedCaptionErrorResponseSchema = z.object({
  error: z.string().min(1).max(128),
  errorId: z.string().min(1).max(64),
  requestId: z.string().min(1).max(64),
});

const MAX_BOUNDED_CAPTION_ERROR_BODY_CHARS = 512;

function parseBoundedCaptionErrorResponse(
  body: string
): z.infer<typeof BoundedCaptionErrorResponseSchema> | null {
  if (body.length > MAX_BOUNDED_CAPTION_ERROR_BODY_CHARS) return null;

  try {
    const parsed = BoundedCaptionErrorResponseSchema.safeParse(
      JSON.parse(body)
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Captions path is fast — bound a slow VPS response so the route can surface
// a typed failure well under its 300s budget instead of hanging indefinitely.
const DEFAULT_VPS_CAPTIONS_TIMEOUT_MS = 30_000;
const MAX_VPS_CAPTIONS_TIMEOUT_MS = 60_000;

export function buildCaptionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/captions`;
}

// Returns null only for the documented, bounded "no usable captions" outcome
// (404 with errorId=CAPTIONS_NOT_FOUND). Unexpected VPS, transport, timeout,
// and schema failures throw typed errors so the caller cannot silently turn an
// outage into paid Whisper work.
//
// When `lang` is provided, forwarded to the VPS so a specific caption
// track is selected instead of YouTube's arbitrary `tracks[0]`. A bounded
// 404 from the VPS still means "no captions available" (either the video
// has none, or the specific track doesn't exist) — the orchestrator's
// retry-with-English decision lives above this layer.
export async function extractCaptions(
  youtubeUrl: string,
  signal?: AbortSignal,
  lang?: string,
  requestId?: string
): Promise<CaptionResult | null> {
  const validatedRequest = TranscriptionRequestSchema.safeParse({
    youtube_url: youtubeUrl,
    lang,
  });
  if (!validatedRequest.success) {
    throw new CaptionExtractionError("schema", validatedRequest.error.message);
  }
  const videoId = extractVideoId(validatedRequest.data.youtube_url) ?? "unknown";

  const vpsBaseUrl = process.env.VPS_API_URL?.trim();
  const vpsApiKeys = getVpsApiKeys();
  if (!vpsBaseUrl || vpsApiKeys.length === 0) {
    throw new Error("VPS_API_URL and VPS_API_KEY must be configured");
  }

  if (signal?.aborted) throwCallerAbort(signal);

  const timeoutMs = resolveBoundedTimeoutMs(
    process.env.VPS_CAPTIONS_TIMEOUT_MS,
    DEFAULT_VPS_CAPTIONS_TIMEOUT_MS,
    MAX_VPS_CAPTIONS_TIMEOUT_MS
  );
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  // Only include `lang` when non-empty — the VPS zod schema rejects
  // `{ lang: undefined }` as a schema violation (optional means "absent",
  // not "present-but-undefined"). Back-compat: `lang`-less calls send
  // exactly the pre-PR body.
  const body = validatedRequest.data;

  let response: Response;
  try {
    response = await fetchWithVpsKeyRotation(
      buildCaptionsUrl(vpsBaseUrl),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(requestId ? { [REQUEST_ID_HEADER]: requestId } : {}),
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
      },
      vpsApiKeys
    );
  } catch (err) {
    if (signal?.aborted) throw err;
    if (
      isTimeoutError(err, timeoutSignal)
    ) {
      return reportUnexpectedFailure(
        videoId,
        "timeout",
        {
          errorClass: err instanceof Error ? err.constructor.name : typeof err,
        },
        err instanceof Error ? err.message : undefined,
        requestId
      );
    }
    return reportUnexpectedFailure(
      videoId,
      "network",
      {
        errorClass: err instanceof Error ? err.constructor.name : typeof err,
      },
      err instanceof Error ? err.message : undefined,
      requestId
    );
  }

  if (signal?.aborted) throwCallerAbort(signal);
  if (timeoutSignal.aborted) {
    return reportUnexpectedFailure(
      videoId,
      "timeout",
      { errorClass: "ResponseTimeout" },
      "VPS captions request timed out",
      requestId
    );
  }

  if (!response.ok) {
    // Mirror of llm-client's body-read safety: preserve the status as the
    // primary error signal but surface body-read failures via a stable
    // errorId so "empty body" and "body read crashed" are distinguishable
    // in postmortem rather than collapsed into the same silent "".
    const text = await response.text().catch(() => {
      if (!signal?.aborted) {
        logAppEvent("error", "[captions] failed to read error response body", {
          errorId: "CAPTIONS_GATEWAY_BODY_READ_FAILED",
          status: response.status,
          requestId,
        });
      }
      return "";
    });
    if (signal?.aborted) throwCallerAbort(signal);
    if (timeoutSignal.aborted) {
      return reportUnexpectedFailure(
        videoId,
        "timeout",
        { errorClass: "ErrorResponseBodyTimeout" },
        "VPS captions error response timed out",
        requestId
      );
    }

    const errorResponse = parseBoundedCaptionErrorResponse(text);
    if (
      response.status === 404 &&
      errorResponse?.errorId === "CAPTIONS_NOT_FOUND"
    ) {
      // This is the only response that authorizes the Transcript Acquisition
      // orchestrator to start audio Transcription.
      return null;
    }

    return reportUnexpectedFailure(
      videoId,
      response.status,
      {
        status: response.status,
        body: text.slice(0, 200),
      },
      text,
      requestId
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (err) {
    if (signal?.aborted) throwCallerAbort(signal, err);
    if (
      isTimeoutError(err, timeoutSignal)
    ) {
      return reportUnexpectedFailure(
        videoId,
        "timeout",
        { errorClass: "ResponseBodyTimeout" },
        err instanceof Error ? err.message : undefined,
        requestId
      );
    }
    return reportUnexpectedFailure(
      videoId,
      "schema",
      {
        errorClass: "JsonParse",
        err,
      },
      err instanceof Error ? err.message : undefined,
      requestId
    );
  }

  if (signal?.aborted) throwCallerAbort(signal);
  if (timeoutSignal.aborted) {
    return reportUnexpectedFailure(
      videoId,
      "timeout",
      { errorClass: "ResponseBodyTimeout" },
      "VPS captions response timed out",
      requestId
    );
  }

  const parsed = CaptionsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    if (signal?.aborted) throwCallerAbort(signal);
    return reportUnexpectedFailure(
      videoId,
      "schema",
      {
        errorClass: "SchemaMismatch",
        issues: parsed.error.issues,
      },
      parsed.error.message,
      requestId
    );
  }

  const data = parsed.data;
  // Prefer the new `segments` field; fall through to deriving a single
  // segment from the legacy `transcript` string for the rollout window.
  // After the cleanup PR removes the alias the second branch is dead
  // code and the schema's refine() guarantees segments is defined.
  let segments: readonly TranscriptSegment[] = [];
  if (data.segments && data.segments.length > 0) {
    // Defense in depth — VPS-side fix decodes captions canonically, this
    // pass swallows any encoded entities that slip through (e.g. during
    // VPS rollout, or future caption sources). See decode-caption-entities.
    segments = data.segments.map((s) => ({
      ...s,
      text: decodeCaptionEntities(s.text),
    }));
  } else if (data.transcript) {
    // Hot path during the deploy crossover: log once with a stable errorId
    // so the cleanup PR has a signal that the legacy branch is no longer
    // hit before the alias is dropped. Without this, we'd silently keep
    // the fallback alive past its expiry.
    logAppEvent("warn", "[caption-extractor] VPS_LEGACY_TRANSCRIPT_FALLBACK", {
      errorId: "VPS_LEGACY_TRANSCRIPT_FALLBACK",
      requestId,
    });
    segments = [
      {
        text: decodeCaptionEntities(data.transcript),
        start: 0,
        duration: 0,
      },
    ];
  }

  if (
    segments.length === 0 ||
    segments.some((segment) => segment.text.trim().length === 0)
  ) {
    if (signal?.aborted) throwCallerAbort(signal);
    return reportUnexpectedFailure(
      videoId,
      "schema",
      { errorClass: "EmptySegments" },
      "no usable segments after parse",
      requestId
    );
  }

  return {
    segments,
    source: data.source,
    language: data.language,
    title: data.title ?? "",
    channelName: data.channelName ?? "",
  };
}

// Alertable: unexpected failures here stop the caption-first pipeline. The
// stable errorId in the log and typed status on the thrown error let the
// orchestrator surface the failure without spending on Whisper.
//
// Suppresses the log when the caller's own signal aborted: a user closing
// the tab mid-request will typically surface as a fetch/JSON-parse failure
// on whichever await was in flight, and classifying those as unexpected
// would fire a false alert on every client disconnect.
function reportUnexpectedFailure(
  videoId: string,
  status: CaptionExtractionError["status"],
  extra: Record<string, unknown>,
  bodyExcerpt?: string,
  requestId?: string
): never {
  logAppEvent("error", "[caption-extractor] CAPTION_UNEXPECTED_FAILURE", {
    errorId: "CAPTION_UNEXPECTED_FAILURE",
    videoId,
    status,
    requestId,
    ...extra,
  });
  throw new CaptionExtractionError(status, bodyExcerpt);
}
