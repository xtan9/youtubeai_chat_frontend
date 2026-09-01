import {
  SCAN_PAGE_SIZE,
  SCAN_WINDOW_DAYS,
  SYNTHETIC_TAXONOMY_VERSION,
  type SyntheticAssessment,
} from "./contracts";
import type {
  ScanCommentProvider,
  ScanProviderPage,
  ScanProviderThread,
} from "./provider";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RECENT_THREADS = 210;
const DEFAULT_OLDER_THREADS = 30;

export type SyntheticAssessmentFailure =
  | "provider_failure"
  | "malformed_output";

export type SyntheticThread = ScanProviderThread & Readonly<{
  assessmentFailure?: SyntheticAssessmentFailure;
}>;

export type SyntheticProviderPage = ScanProviderPage & Readonly<{
  threads: readonly SyntheticThread[];
}>;

export type SyntheticCommentProvider = ScanCommentProvider & Readonly<{
  readonly kind?: "synthetic";
  listTopLevelThreads(input: {
    connectedChannelId: string;
    windowStart: Date;
    windowEnd: Date;
    pageToken: string | null;
    pageSize: number;
  }): Promise<SyntheticProviderPage>;
  findThread(input: {
    connectedChannelId: string;
    windowStart: Date;
    windowEnd: Date;
    threadId: string;
    contentHash: string;
  }): Promise<SyntheticThread | null>;
  /** Returns unknown deliberately: the runner validates every provider result. */
  assess(thread: SyntheticThread): Promise<unknown>;
}>;

export type SyntheticProviderOptions = Readonly<{
  now?: () => Date;
  threads?: readonly SyntheticThread[];
}>;

function makeDefaultThreads(now: Date): SyntheticThread[] {
  const threads: SyntheticThread[] = [];
  const total = DEFAULT_RECENT_THREADS + DEFAULT_OLDER_THREADS;

  for (let index = 0; index < total; index += 1) {
    const isRecent = index < DEFAULT_RECENT_THREADS;
    const age = isRecent
      ? (index % SCAN_WINDOW_DAYS) * DAY_MS + (index % 60) * 60_000
      : 8 * DAY_MS + (index % 60) * 60_000;
    const content =
      index % 19 === 0
        ? `Synthetic safety example ${index}: I know where you live.`
        : index % 7 === 0
          ? `Synthetic abuse example ${index}: you are an idiot.`
          : index % 5 === 0
            ? `Synthetic review example ${index}: is this sarcasm?`
            : `Synthetic criticism example ${index}: the explanation needs more detail.`;

    threads.push({
      threadId: `synthetic-thread-${index}`,
      commentId: `synthetic-comment-${index}`,
      videoId: `synthetic-video-${index % 4}`,
      publishedAt: new Date(now.getTime() - age).toISOString(),
      content,
      contentHash: `synthetic-hash-${index}-${content.length}`,
      isTopLevel: true,
      ...(index === 17
        ? { assessmentFailure: "provider_failure" as const }
        : index === 29
          ? { assessmentFailure: "malformed_output" as const }
          : {}),
    });
  }

  return threads;
}

function pageOffset(pageToken: string | null): number {
  if (pageToken === null) return 0;
  if (!/^\d+$/.test(pageToken)) {
    throw Object.assign(new Error("Invalid synthetic page token"), {
      code: "SYNTHETIC_PAGE_TOKEN_INVALID",
    });
  }
  return Number(pageToken);
}

function boundedPageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize)) return SCAN_PAGE_SIZE;
  return Math.min(SCAN_PAGE_SIZE, Math.max(1, Math.floor(pageSize)));
}

function assessmentForContent(content: string): SyntheticAssessment {
  const normalized = content.toLowerCase();
  if (
    normalized.includes("where you live") ||
    normalized.includes("go die")
  ) {
    return {
      classification: "safety_flag",
      reasonCode: "severe_harm_signal",
      taxonomyVersion: SYNTHETIC_TAXONOMY_VERSION,
    };
  }
  if (normalized.includes("idiot") || normalized.includes("stupid")) {
    return {
      classification: "actionable_abuse",
      reasonCode: "direct_personal_insult",
      taxonomyVersion: SYNTHETIC_TAXONOMY_VERSION,
    };
  }
  if (normalized.includes("sarcasm") || normalized.includes("?")) {
    return {
      classification: "reviewable",
      reasonCode: "context_required",
      taxonomyVersion: SYNTHETIC_TAXONOMY_VERSION,
    };
  }
  return {
    classification: "allowed_criticism",
    reasonCode: "content_focused_feedback",
    taxonomyVersion: SYNTHETIC_TAXONOMY_VERSION,
  };
}

export function createSyntheticCommentProvider(
  options: SyntheticProviderOptions = {},
): SyntheticCommentProvider {
  const anchor = options.now ?? (() => new Date());
  const sourceThreads: SyntheticThread[] = [
    ...(options.threads ?? makeDefaultThreads(anchor())),
  ].map((thread): SyntheticThread => ({ ...thread }));

  return {
    kind: "synthetic",
    async listTopLevelThreads(input): Promise<SyntheticProviderPage> {
      const windowStart = input.windowStart.getTime();
      const windowEnd = input.windowEnd.getTime();
      const candidates = sourceThreads
        .filter((thread) => {
          const publishedAt = new Date(thread.publishedAt).getTime();
          return (
            thread.isTopLevel &&
            Number.isFinite(publishedAt) &&
            publishedAt >= windowStart &&
            publishedAt <= windowEnd
          );
        })
        .sort(
          (left, right) =>
            new Date(right.publishedAt).getTime() -
            new Date(left.publishedAt).getTime(),
        );
      const offset = pageOffset(input.pageToken);
      const pageSize = boundedPageSize(input.pageSize);
      const threads = candidates.slice(offset, offset + pageSize);
      const nextOffset = offset + threads.length;

      return {
        threads,
        nextPageToken:
          nextOffset < candidates.length ? String(nextOffset) : null,
        hasMoreWithinWindow: nextOffset < candidates.length,
        hasMoreOutsideWindow: sourceThreads.some((thread) => {
          const publishedAt = new Date(thread.publishedAt).getTime();
          return thread.isTopLevel && publishedAt < windowStart;
        }),
      };
    },

    async findThread(input): Promise<SyntheticThread | null> {
      const windowStart = input.windowStart.getTime();
      const windowEnd = input.windowEnd.getTime();
      return (
        sourceThreads.find((thread) => {
          const publishedAt = new Date(thread.publishedAt).getTime();
          return (
            thread.isTopLevel &&
            thread.threadId === input.threadId &&
            thread.contentHash === input.contentHash &&
            publishedAt >= windowStart &&
            publishedAt <= windowEnd
          );
        }) ?? null
      );
    },

    async assess(thread: SyntheticThread) {
      if (thread.assessmentFailure === "provider_failure") {
        throw Object.assign(new Error("Synthetic assessment failed"), {
          code: "SYNTHETIC_ASSESSMENT_FAILED",
        });
      }
      if (thread.assessmentFailure === "malformed_output") {
        return { classification: "not_an_assessment" };
      }
      return assessmentForContent(thread.content);
    },
  };
}
