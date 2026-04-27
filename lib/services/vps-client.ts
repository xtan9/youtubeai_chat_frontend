import { z } from "zod";
import type { TranscriptSegment } from "./summarize-cache";
import { TranscriptSegmentSchema } from "@/lib/types";

// Discriminated error shape so the route's catch can log a structured
// `status` field that alert tooling can fingerprint. `number` covers
// HTTP statuses; the string variants cover the network / timeout
// failures `fetch` represents as thrown errors and the synthetic
// "schema" we raise on Zod parse failures. Mirrors GroqTranscribeError
// in the VPS service so both layers expose the same shape upward.
export class VpsTranscribeError extends Error {
  public readonly bodyExcerpt?: string;
  constructor(
    public readonly status:
      | number
      | "network"
      | "timeout"
      | "schema",
    bodyExcerpt?: string
  ) {
    // Truncate at construction so the bounded-length invariant lives in one
    // place. Consumers (logger, error.message) can read .bodyExcerpt without
    // worrying about whether it's been pre-truncated.
    const truncated = bodyExcerpt?.slice(0, 200);
    super(
      `VPS transcription failed (${status})${truncated ? `: ${truncated}` : ""}`
    );
    this.bodyExcerpt = truncated;
    this.name = "VpsTranscribeError";
  }
}

// Stable errorId for log-search alerts. Add a `case` here whenever
// VpsTranscribeError's status union grows — the assertNever default
// will fail the build until the new variant has an explicit decision.
export function vpsErrorId(status: VpsTranscribeError["status"]): string {
  if (typeof status === "number") {
    return `VPS_TRANSCRIBE_FAILED_HTTP_${status}`;
  }
  switch (status) {
    case "network":
    case "timeout":
    case "schema":
      return `VPS_TRANSCRIBE_FAILED_${status.toUpperCase()}`;
    default: {
      const _exhaustive: never = status;
      return `VPS_TRANSCRIBE_FAILED_UNKNOWN_${String(_exhaustive)}`;
    }
  }
}

// During the rollout window the schema accepts either shape:
// - new VPS emits `segments` (canonical) plus `transcript` (back-compat
//   for an old frontend deployment that hasn't picked up segments yet).
// - old VPS emits only `transcript`. Below we synthesize a single
//   un-clickable segment from it so this frontend keeps working during
//   the deploy crossover.
// Drop the `transcript`-only branch once the service rollout is done.
//
// `.min(1)` on segments rules out the "VPS bug returns empty arrays"
// failure mode — an empty-segments response is a real bug, not a
// back-compat shape, and it should fail loud through the route's catch
// instead of generating a useless empty-prompt LLM call downstream.
const TranscribeResponseSchema = z
  .object({
    segments: z.array(TranscriptSegmentSchema).min(1).optional(),
    transcript: z.string().optional(),
    language: z.string(),
    source: z.literal("whisper"),
  })
  .refine((data) => data.segments !== undefined || data.transcript !== undefined, {
    message: "either `segments` or `transcript` is required",
  });

export type TranscribeResult = {
  readonly segments: readonly TranscriptSegment[];
  readonly language: string;
  readonly source: "whisper";
};

// Vercel's route budget is 300s; leave ~60s headroom for the post-transcribe
// work on the same request (LLM streaming p99 ≈ 30s, cache write + SSE
// teardown a few seconds, plus slack for the oembed round-trip). If Vercel
// maxDuration is raised above 300s, bump this proportionally.
const DEFAULT_VPS_TIMEOUT_MS = 240_000;

export function buildTranscribeUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/transcribe`;
}

export async function transcribeViaVps(
  youtubeUrl: string,
  signal?: AbortSignal,
  lang?: string
): Promise<TranscribeResult> {
  const vpsBaseUrl = process.env.VPS_API_URL?.trim();
  const vpsApiKey = process.env.VPS_API_KEY?.trim();

  if (!vpsBaseUrl || !vpsApiKey) {
    throw new Error("VPS_API_URL and VPS_API_KEY must be configured");
  }

  const timeoutMs = Number(process.env.VPS_TIMEOUT_MS) || DEFAULT_VPS_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  // Spread `lang` in only when provided — the VPS zod schema rejects
  // `{ lang: undefined }` fields and a literal `null` body field. Back-
  // compat: callers that don't pass lang see the exact same request body
  // as before.
  const body: Record<string, unknown> = { youtube_url: youtubeUrl };
  if (lang) body.lang = lang;

  // Translate pre-HTTP failures (DNS, connection-reset, internal-timeout)
  // into typed VpsTranscribeErrors so the route's catch can fingerprint
  // them the same way it fingerprints HTTP statuses. Caveat: when the
  // *caller's* signal fires, fetch also throws AbortError — but the route
  // checks `isCallerAbort(request.signal)` BEFORE looking at the error
  // type, so re-throwing the original error in that case keeps the
  // existing silent-drop behavior intact. We only translate when the
  // caller signal is NOT the one that fired (i.e. internal timeout via
  // AbortSignal.any, or any non-abort throw from fetch).
  let response: Response;
  try {
    response = await fetch(buildTranscribeUrl(vpsBaseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${vpsApiKey}`,
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });
  } catch (err) {
    // Caller-abort: re-throw the original AbortError. The route's
    // isCallerAbort(request.signal) check picks this up and silently
    // closes the stream — no log, no error SSE.
    if (signal?.aborted) throw err;
    // Internal-timeout (composed via AbortSignal.any) — fetch throws an
    // AbortError but the caller's signal is clean. Surface as a typed
    // "timeout" so log-search alerts can fingerprint frontend-side
    // timeouts vs. upstream-side 504s.
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    ) {
      throw new VpsTranscribeError("timeout", err.message);
    }
    // Everything else (DNS, connection-reset, TLS, "fetch failed") —
    // surface as "network" so 502/503 from the VPS proxy can be told
    // apart from "we never reached the VPS at all".
    // Defensive: callers may throw non-Error values (rare but legal in JS).
    // String(err) on a plain object produces "[object Object]" which pollutes
    // log aggregation and masks the real failure. Stamp typeof + JSON so
    // logs stay distinguishable.
    let bodyExcerpt: string;
    if (err instanceof Error) {
      bodyExcerpt = err.message || err.name || "Error";
    } else if (err === null || err === undefined) {
      bodyExcerpt = `non-Error throw: ${String(err)}`;
    } else {
      // Avoid "[object Object]" — try JSON, fall back to typeof.
      // (Symbol throws on String() so JSON.stringify is the safer first attempt;
      // it returns undefined for Symbols, which we detect.)
      try {
        const json = JSON.stringify(err);
        bodyExcerpt =
          json === undefined
            ? `non-Error throw (${typeof err})`
            : `non-Error throw (${typeof err}): ${json.slice(0, 200)}`;
      } catch {
        bodyExcerpt = `non-Error throw (${typeof err})`;
      }
    }
    throw new VpsTranscribeError("network", bodyExcerpt);
  }

  if (!response.ok) {
    // Mirror caption-extractor's body-read safety: preserve the status
    // even if `text()` rejects (chunked-transfer break, malformed
    // content-encoding). Without the catch a body-read failure swallows
    // the original status and surfaces as a generic "TypeError: failed
    // to fetch body" — costs an hour in postmortem.
    const text = await response.text().catch(() => "");
    throw new VpsTranscribeError(response.status, text);
  }

  const raw: unknown = await response.json();
  const parsed = TranscribeResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new VpsTranscribeError("schema", parsed.error.message);
  }
  // Prefer the new `segments` field; fall through to deriving a single
  // segment from the legacy `transcript` string for the rollout window.
  // The schema's refine() guarantees one of the two is present.
  let segments: readonly TranscriptSegment[];
  if (parsed.data.segments && parsed.data.segments.length > 0) {
    segments = parsed.data.segments;
  } else if (parsed.data.transcript) {
    // Hot path during the deploy crossover: log once with a stable errorId
    // so the cleanup PR has a signal the legacy branch is no longer hit
    // before the alias is dropped.
    console.warn("[vps-client] VPS_LEGACY_TRANSCRIPT_FALLBACK", {
      errorId: "VPS_LEGACY_TRANSCRIPT_FALLBACK",
    });
    segments = [
      { text: parsed.data.transcript, start: 0, duration: 0 },
    ];
  } else {
    throw new VpsTranscribeError("schema", "no segments after parse");
  }
  return {
    segments,
    language: parsed.data.language,
    source: parsed.data.source,
  };
}
