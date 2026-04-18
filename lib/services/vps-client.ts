import { z } from "zod";

const TranscribeResponseSchema = z.object({
  transcript: z.string(),
  language: z.string(),
  source: z.literal("whisper"),
});

export type TranscribeResult = z.infer<typeof TranscribeResponseSchema>;

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
  signal?: AbortSignal
): Promise<TranscribeResult> {
  const vpsBaseUrl = process.env.VPS_API_URL;
  const vpsApiKey = process.env.VPS_API_KEY;

  if (!vpsBaseUrl || !vpsApiKey) {
    throw new Error("VPS_API_URL and VPS_API_KEY must be configured");
  }

  const timeoutMs = Number(process.env.VPS_TIMEOUT_MS) || DEFAULT_VPS_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const response = await fetch(buildTranscribeUrl(vpsBaseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${vpsApiKey}`,
    },
    body: JSON.stringify({ youtube_url: youtubeUrl }),
    signal: combinedSignal,
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
