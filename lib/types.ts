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
  keyPoints: string[];
  transcriptionTime: number;
  summaryTime: number;
  transcript?: string;
}

export interface StreamingStatus {
  stage: "downloading" | "transcribing" | "summarizing" | "complete";
  progress?: number;
  message?: string;
}
