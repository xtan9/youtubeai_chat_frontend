import { z } from "zod";

const TranscribeResponseSchema = z.object({
  transcript: z.string(),
  language: z.string(),
  source: z.literal("whisper"),
});

export type TranscribeResult = z.infer<typeof TranscribeResponseSchema>;

export function buildTranscribeUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/transcribe`;
}

/**
 * Call the VPS transcription service for videos without captions.
 * Throws on failure; caller emits a user-visible error event.
 */
export async function transcribeViaVps(
  youtubeUrl: string,
  signal?: AbortSignal
): Promise<TranscribeResult> {
  const vpsBaseUrl = process.env.VPS_API_URL;
  const vpsApiKey = process.env.VPS_API_KEY;

  if (!vpsBaseUrl || !vpsApiKey) {
    throw new Error("VPS_API_URL and VPS_API_KEY must be configured");
  }

  const response = await fetch(buildTranscribeUrl(vpsBaseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${vpsApiKey}`,
    },
    body: JSON.stringify({ youtube_url: youtubeUrl }),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`VPS transcription failed (${response.status}): ${text}`);
  }

  const raw: unknown = await response.json();
  const parsed = TranscribeResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `VPS transcription returned unexpected shape: ${parsed.error.message}`
    );
  }
  return parsed.data;
}
