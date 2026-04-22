import { z } from "zod";

// BCP-47 primary subtag + optional region/script (`en`, `fra`, `en-US`,
// `zh-Hans`, `zh-Hant-TW`). Pinned at the schema boundary so a VPS
// regression that emits garbage ("", "und", "--model") fails parsing
// here with `reason: "schema"` instead of silently flowing through as a
// bogus `lang` parameter on downstream /captions and /transcribe calls.
const LanguageCodeSchema = z
  .string()
  .regex(
    /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/,
    "language must be a BCP-47 tag"
  );

// VPS /metadata response contract. Mirrors the shape defined in the VPS
// service's routes/metadata.ts — keep in sync.
const VpsMetadataResponseSchema = z.object({
  language: LanguageCodeSchema,
  title: z.string(),
  description: z.string(),
  availableCaptions: z.array(z.string()),
});

export type VpsMetadata = z.infer<typeof VpsMetadataResponseSchema>;

/**
 * Normalize a BCP-47 tag to its primary subtag, lowercased (`en-US` →
 * `"en"`, `zh-Hans` → `"zh"`). Used by the orchestrator so the
 * `detectedLang === "zh"` short-circuit works even when the VPS
 * returns a region-qualified variant.
 */
export function primarySubtag(code: string): string {
  return code.toLowerCase().split("-")[0];
}

// Discriminated result mirrors `video-metadata.ts` (oembed client) so
// callers can `switch (result.reason)` with exhaustive type narrowing.
// The orchestrator treats every non-ok reason as "no language signal,
// fall back to legacy behavior" — the reasons exist to make postmortem
// logs useful, not to drive per-reason retry logic.
export type VpsMetadataResult =
  | { readonly ok: true; readonly data: VpsMetadata }
  | { readonly ok: false; readonly reason: "aborted" }
  | { readonly ok: false; readonly reason: "timeout" }
  | { readonly ok: false; readonly reason: "non_ok"; readonly status: number }
  | { readonly ok: false; readonly reason: "schema" }
  | { readonly ok: false; readonly reason: "config" }
  | { readonly ok: false; readonly reason: "error"; readonly error: unknown };

// Metadata is a pure yt-dlp call — no audio transfer — so 30s is plenty.
// Keeping it well under the route's 300s budget ensures a stuck metadata
// call doesn't steal the budget from the still-mandatory transcription
// work that follows.
const DEFAULT_VPS_METADATA_TIMEOUT_MS = 30_000;

export function buildMetadataUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/metadata`;
}

/**
 * Fetch video metadata (detected language, title, description, available
 * caption track codes) from the VPS. Never throws — every failure mode
 * returns a discriminated `{ ok: false, reason }` so the orchestrator
 * can degrade gracefully to the legacy "no lang hint" flow.
 */
export async function fetchVpsMetadata(
  youtubeUrl: string,
  signal?: AbortSignal
): Promise<VpsMetadataResult> {
  const vpsBaseUrl = process.env.VPS_API_URL?.trim();
  const vpsApiKey = process.env.VPS_API_KEY?.trim();
  if (!vpsBaseUrl || !vpsApiKey) {
    return { ok: false, reason: "config" };
  }

  const timeoutMs =
    Number(process.env.VPS_METADATA_TIMEOUT_MS) ||
    DEFAULT_VPS_METADATA_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(buildMetadataUrl(vpsBaseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${vpsApiKey}`,
      },
      body: JSON.stringify({ youtube_url: youtubeUrl }),
      signal: combinedSignal,
    });
  } catch (err) {
    if (signal?.aborted) return { ok: false, reason: "aborted" };
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "error", error: err };
  }

  if (!response.ok) {
    return { ok: false, reason: "non_ok", status: response.status };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (err) {
    return { ok: false, reason: "error", error: err };
  }

  const parsed = VpsMetadataResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "schema" };
  }

  return { ok: true, data: parsed.data };
}
