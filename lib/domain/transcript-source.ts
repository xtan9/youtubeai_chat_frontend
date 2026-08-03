/** Domain vocabulary shared by transcript production, reports, and disclosures. */
export const TRANSCRIPT_SOURCES = [
  "manual_captions",
  "auto_captions",
  "whisper",
] as const;

export type TranscriptSource = (typeof TRANSCRIPT_SOURCES)[number];

export function isTranscriptSource(value: unknown): value is TranscriptSource {
  return (
    typeof value === "string" &&
    (TRANSCRIPT_SOURCES as readonly string[]).includes(value)
  );
}
