export interface TranscribeResult {
  transcript: string;
  language: string;
  source: "whisper";
}

export function buildTranscribeUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/transcribe`;
}

/**
 * Call the VPS transcription service for videos without captions.
 * Throws on failure — caller handles the error.
 */
export async function transcribeViaVps(
  youtubeUrl: string
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
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`VPS transcription failed (${response.status}): ${text}`);
  }

  return response.json();
}
