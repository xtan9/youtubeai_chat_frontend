import type {
  AssessmentContext,
  FinalizedInteractionAssessment,
} from "@/lib/channel/interaction-assessment";
import type { ScanProviderKind } from "./contracts";

/**
 * The provider seam contains the minimum source data needed to revalidate and
 * assess one bounded top-level thread. Provider transport records (including
 * author names, author channel IDs, avatars, etags, and raw API envelopes)
 * must not cross this boundary.
 */
export type ScanProviderThread = Readonly<{
  threadId: string;
  commentId: string;
  videoId: string;
  publishedAt: string;
  content: string;
  contentHash: string;
  isTopLevel: boolean;
  assessmentContext?: AssessmentContext;
}>;

export type ScanProviderPage = Readonly<{
  threads: readonly ScanProviderThread[];
  nextPageToken: string | null;
  hasMoreWithinWindow: boolean;
  hasMoreOutsideWindow: boolean;
}>;

export type InteractionAssessmentEvaluation = Readonly<{
  kind: "interaction";
  context: AssessmentContext;
  assessment: FinalizedInteractionAssessment;
}>;

export interface ScanCommentProvider {
  readonly kind?: ScanProviderKind;
  listTopLevelThreads(input: {
    connectedChannelId: string;
    videoId?: string | null;
    windowStart: Date;
    windowEnd: Date;
    pageToken: string | null;
    pageSize: number;
  }): Promise<ScanProviderPage>;
  findThread(input: {
    connectedChannelId: string;
    videoId?: string | null;
    windowStart: Date;
    windowEnd: Date;
    threadId: string;
    contentHash: string;
  }): Promise<ScanProviderThread | null>;
  /** Returns unknown deliberately: the runner validates every provider result. */
  assess(thread: ScanProviderThread): Promise<unknown>;
}
