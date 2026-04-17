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

const EMPTY: VideoMetadataBasic = { title: "", channelName: "" };

export async function fetchVideoMetadata(
  youtubeUrl: string,
  signal?: AbortSignal
): Promise<VideoMetadataBasic> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      youtubeUrl
    )}&format=json`;
    const res = await fetch(oembedUrl, {
      signal: signal ?? AbortSignal.timeout(5000),
    });
    if (!res.ok) return EMPTY;
    const raw: unknown = await res.json();
    const parsed = OembedResponseSchema.safeParse(raw);
    if (!parsed.success) return EMPTY;
    return {
      title: parsed.data.title ?? "",
      channelName: parsed.data.author_name ?? "",
    };
  } catch (err) {
    console.warn("[video-metadata] oembed fetch failed", {
      youtubeUrl,
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
    });
    return EMPTY;
  }
}
