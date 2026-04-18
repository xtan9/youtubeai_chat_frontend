import { z } from "zod";

const OembedResponseSchema = z
  .object({
    title: z.string().optional(),
    author_name: z.string().optional(),
  })
  .passthrough();

export interface VideoMetadataBasic {
  readonly title: string;
  readonly channelName: string;
}

// Discriminated result. Per-reason fields are narrowed so `status` is only
// addressable when reason === "non_ok", etc. — illegal combinations are
// unrepresentable. Callers check `result.ok` first, then dispatch on
// `result.reason` knowing which payload fields exist.
export type VideoMetadataResult =
  | { readonly ok: true; readonly data: VideoMetadataBasic }
  | { readonly ok: false; readonly reason: "aborted" }
  | { readonly ok: false; readonly reason: "timeout" }
  | { readonly ok: false; readonly reason: "non_ok"; readonly status: number }
  | { readonly ok: false; readonly reason: "schema" }
  | { readonly ok: false; readonly reason: "error"; readonly error: unknown };

const OEMBED_TIMEOUT_MS = 5000;

export async function fetchVideoMetadata(
  youtubeUrl: string,
  signal?: AbortSignal
): Promise<VideoMetadataResult> {
  // Compose the caller's signal with our internal timer so the fetch aborts
  // on either user disconnect OR upstream slowness. The catch below reads
  // signal.aborted (caller's signal only) to tell the two apart.
  const timeoutSignal = AbortSignal.timeout(OEMBED_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      youtubeUrl
    )}&format=json`;
    const res = await fetch(oembedUrl, { signal: combinedSignal });
    if (!res.ok) return { ok: false, reason: "non_ok", status: res.status };
    const raw: unknown = await res.json();
    const parsed = OembedResponseSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "schema" };
    return {
      ok: true,
      data: {
        title: parsed.data.title ?? "",
        channelName: parsed.data.author_name ?? "",
      },
    };
  } catch (err) {
    // Caller-initiated aborts only when the caller's signal actually fired —
    // not our internal timeout. Timeout is a genuine failure; caller cancels
    // are no-op skip signals.
    if (signal?.aborted) return { ok: false, reason: "aborted" };
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "error", error: err };
  }
}
