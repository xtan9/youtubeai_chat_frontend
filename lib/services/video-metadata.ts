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

// Discriminated result: `ok: false` lets callers distinguish real failures
// (oembed 404/500, DNS blip, schema drift) from "video genuinely has no
// title" so we can skip caching blank rows instead of poisoning the cache.
export type VideoMetadataResult =
  | { readonly ok: true; readonly data: VideoMetadataBasic }
  | {
      readonly ok: false;
      readonly reason: "aborted" | "non_ok" | "schema" | "error";
      readonly status?: number;
      readonly error?: unknown;
    };

export async function fetchVideoMetadata(
  youtubeUrl: string,
  signal?: AbortSignal
): Promise<VideoMetadataResult> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      youtubeUrl
    )}&format=json`;
    const res = await fetch(oembedUrl, {
      signal: signal ?? AbortSignal.timeout(5000),
    });
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
    if (
      signal?.aborted ||
      (err instanceof Error && err.name === "AbortError") ||
      (err instanceof Error && err.name === "TimeoutError")
    ) {
      return { ok: false, reason: "aborted" };
    }
    return { ok: false, reason: "error", error: err };
  }
}
