/**
 * One transcript line with its playback timing. Used to render clickable
 * timestamps that seek the embedded YouTube player.
 *
 * Same shape produced by both the YouTube captions API and the Whisper
 * fallback so consumers don't need to branch on transcript source.
 */
export interface TranscriptSegment {
  readonly text: string;
  readonly start: number; // seconds since video start
  readonly duration: number; // seconds
}

export interface User {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
}

export interface SummaryResult {
  title: string;
  duration: string;
  summary: string;
  transcriptionTime: number;
  summaryTime: number;
  segments?: readonly TranscriptSegment[];
}

export interface StreamingStatus {
  stage: "preparing" | "transcribing" | "summarizing" | "complete";
  progress?: number;
  message?: string;
}
