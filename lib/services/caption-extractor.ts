import { z } from "zod";
import type {
  PromptLocale,
  TranscriptSegment,
  TranscriptSource,
} from "./summarize-cache";
import { TranscriptSegmentSchema } from "@/lib/types";
import { decodeCaptionEntities } from "@/lib/utils/decode-caption-entities";
import { extractVideoId } from "./youtube-url";

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

// The caption path has one recoverable outcome (HTTP 404: no usable
// captions) and several failures that must stop the pipeline. Keep those
// failures typed so the orchestrator cannot accidentally turn a VPS outage
// into a paid Whisper request.
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
    const truncated = bodyExcerpt?.slice(0, 200);
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

const LANGUAGE_SENTINELS = new Set(["und", "zxx", "mul", "mis"]);
const LanguageHintSchema = z
  .string()
  .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/)
  .refine(
    (value) => !LANGUAGE_SENTINELS.has(value.toLowerCase().split("-")[0])
  );

const CaptionSegmentSchema = TranscriptSegmentSchema.refine(
  (segment) => segment.text.trim().length > 0,
  "caption segment text must not be empty"
);

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
    transcript: z
      .string()
      .refine((value) => value.trim().length > 0, "transcript must not be empty")
      .optional(),
    source: z.literal("auto_captions"),
    language: z.enum(["en", "zh"]),
    title: z.string().nullable(),
    channelName: z.string().nullable(),
  })
  .refine((data) => data.segments !== undefined || data.transcript !== undefined, {
    message: "either `segments` or `transcript` is required",
  });

// Captions path is fast — bound a slow VPS response so the route can surface
// a typed failure well under its 300s budget instead of hanging indefinitely.
const DEFAULT_VPS_CAPTIONS_TIMEOUT_MS = 30_000;

export function buildCaptionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/captions`;
}

// Returns null only for the documented "no usable captions" outcome (404).
// Unexpected VPS, transport, timeout, and schema failures throw typed errors
// so the caller cannot silently turn an outage into paid Whisper work.
//
// When `lang` is provided, forwarded to the VPS so a specific caption
// track is selected instead of YouTube's arbitrary `tracks[0]`. A 404
// from the VPS still means "no captions available" (either the video
// has none, or the specific track doesn't exist) — the orchestrator's
// retry-with-English decision lives above this layer.
export async function extractCaptions(
  youtubeUrl: string,
  signal?: AbortSignal,
  lang?: string
): Promise<CaptionResult | null> {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) return null;

  if (lang !== undefined && !LanguageHintSchema.safeParse(lang).success) {
    throw new CaptionExtractionError("schema", "invalid language hint");
  }

  const vpsBaseUrl = process.env.VPS_API_URL?.trim();
  const vpsApiKey = process.env.VPS_API_KEY?.trim();
  if (!vpsBaseUrl || !vpsApiKey) {
    throw new Error("VPS_API_URL and VPS_API_KEY must be configured");
  }

  const timeoutMs =
    Number(process.env.VPS_CAPTIONS_TIMEOUT_MS) ||
    DEFAULT_VPS_CAPTIONS_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  // Only include `lang` when non-empty — the VPS zod schema rejects
  // `{ lang: undefined }` as a schema violation (optional means "absent",
  // not "present-but-undefined"). Back-compat: `lang`-less calls send
  // exactly the pre-PR body.
  const body: Record<string, unknown> = { youtube_url: youtubeUrl };
  if (lang) body.lang = lang;

  let response: Response;
  try {
    response = await fetch(buildCaptionsUrl(vpsBaseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${vpsApiKey}`,
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    ) {
      return reportUnexpectedFailure(
        videoId,
        "timeout",
        {
          errorClass: err.constructor.name,
          err,
        },
        err.message
      );
    }
    return reportUnexpectedFailure(
      videoId,
      "network",
      {
        errorClass: err instanceof Error ? err.constructor.name : typeof err,
        err,
      },
      err instanceof Error ? err.message : undefined
    );
  }

  // 404 is the stable "no captions available" contract — fall through to
  // Whisper without logging.
  if (response.status === 404) return null;

  if (!response.ok) {
    // Mirror of llm-client's body-read safety: preserve the status as the
    // primary error signal but surface body-read failures via a stable
    // errorId so "empty body" and "body read crashed" are distinguishable
    // in postmortem rather than collapsed into the same silent "".
    const text = await response.text().catch((err) => {
      if (!signal?.aborted) {
        console.error("[captions] failed to read error response body", {
          errorId: "CAPTIONS_GATEWAY_BODY_READ_FAILED",
          status: response.status,
          err,
        });
      }
      return "";
    });
    if (signal?.aborted) return null;
    return reportUnexpectedFailure(
      videoId,
      response.status,
      {
        status: response.status,
        body: text.slice(0, 200),
      },
      text
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (err) {
    if (signal?.aborted) return null;
    return reportUnexpectedFailure(
      videoId,
      "schema",
      {
        errorClass: "JsonParse",
        err,
      },
      err instanceof Error ? err.message : undefined
    );
  }

  const parsed = CaptionsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    if (signal?.aborted) return null;
    return reportUnexpectedFailure(
      videoId,
      "schema",
      {
        errorClass: "SchemaMismatch",
        issues: parsed.error.issues,
      },
      parsed.error.message
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
    console.warn("[caption-extractor] VPS_LEGACY_TRANSCRIPT_FALLBACK", {
      errorId: "VPS_LEGACY_TRANSCRIPT_FALLBACK",
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
    if (signal?.aborted) return null;
    return reportUnexpectedFailure(
      videoId,
      "schema",
      { errorClass: "EmptySegments" },
      "no usable segments after parse"
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
  bodyExcerpt?: string
): never {
  console.error("[caption-extractor] CAPTION_UNEXPECTED_FAILURE", {
    errorId: "CAPTION_UNEXPECTED_FAILURE",
    videoId,
    status,
    ...extra,
  });
  throw new CaptionExtractionError(status, bodyExcerpt);
}
