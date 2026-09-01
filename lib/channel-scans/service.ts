import "server-only";

import { randomUUID } from "node:crypto";
import {
  assessInteraction,
  type AssessmentContext,
} from "@/lib/channel/interaction-assessment";
import { retainInteractionAssessment } from "@/lib/channel/comment-retention";
import {
  CURRENT_YOUTUBE_CHANNEL_COMPLIANCE_CLEARANCE,
  evaluateYouTubeChannelAssessmentGate,
} from "@/lib/compliance/youtube-channel-clearance";
import {
  YOUTUBE_SCAN_PROVIDER,
  scanProviderSchema,
  scanWindowFor,
  type ScanProviderKind,
  type ScanRun,
  type ScanRunStore,
  type ScanRunStartResult,
  youtubeVideoIdSchema,
} from "./contracts";
import { createPostgresScanRunStore } from "./repository";
import { executeScanRun } from "./runner";
import { createSyntheticCommentProvider } from "./synthetic-provider";
import {
  createYouTubeCommentProvider,
  inspectYouTubeCommentProvider,
  YouTubeCommentProviderError,
  type YouTubeProviderReadiness,
} from "./youtube-provider";
import { resolveYouTubeScanTarget } from "./youtube-target";

function blocked(
  readiness: Exclude<YouTubeProviderReadiness, { ready: true }>,
): ScanRunStartResult {
  return {
    kind: "blocked",
    code: readiness.code,
    reason: readiness.reason,
  };
}

async function youtubeStartBlock(input: Readonly<{
  accountId: string;
  connectedChannelId: string;
  videoId?: string | null;
}>): Promise<ScanRunStartResult | null> {
  const gate = evaluateYouTubeChannelAssessmentGate(
    CURRENT_YOUTUBE_CHANNEL_COMPLIANCE_CLEARANCE,
  );
  if (gate.status === "blocked") {
    return blocked({
      ready: false,
      code: "YOUTUBE_ASSESSMENT_GATE_BLOCKED",
      reason: gate.reason,
    });
  }

  let target;
  try {
    target = await resolveYouTubeScanTarget(input);
  } catch {
    return blocked({
      ready: false,
      code: "YOUTUBE_SCAN_TARGET_UNAVAILABLE",
      reason: "The verified YouTube scan target could not be resolved.",
    });
  }
  const readiness = inspectYouTubeCommentProvider({
    target,
    compliance: CURRENT_YOUTUBE_CHANNEL_COMPLIANCE_CLEARANCE,
  });
  if (!readiness.ready) return blocked(readiness);

  if (input.videoId != null) {
    const provider = createYouTubeCommentProvider({
      target,
      compliance: CURRENT_YOUTUBE_CHANNEL_COMPLIANCE_CLEARANCE,
    });
    try {
      await provider.validateOwnedVideo({
        connectedChannelId: input.connectedChannelId,
        videoId: input.videoId,
      });
    } catch (error) {
      if (error instanceof YouTubeCommentProviderError) {
        return {
          kind: "blocked",
          code: error.code,
          reason: error.message,
        };
      }
      return blocked({
        ready: false,
        code: "YOUTUBE_VIDEO_SCOPE_UNAVAILABLE",
        reason: "The requested owned YouTube Video could not be verified.",
      });
    }
  }
  return null;
}

function interactionAssessmentPersistence(
  store: ScanRunStore,
) {
  return async (input: {
    run: ScanRun;
    thread: {
      commentId: string;
      contentHash: string;
      videoId: string;
    };
    context: AssessmentContext;
    assessment: Awaited<ReturnType<typeof assessInteraction>>;
    assessedAt: Date;
  }): Promise<string> => {
    if (!store.saveInteractionAssessment) {
      throw Object.assign(
        new Error("Interaction Assessment persistence is unavailable"),
        { code: "REVIEW_QUEUE_PERSISTENCE_UNAVAILABLE" },
      );
    }
    const retained = retainInteractionAssessment({
      assessmentId: randomUUID(),
      accountId: input.run.accountId,
      channelId: input.run.connectedChannelId,
      videoId: input.thread.videoId,
      candidate: {
        commentId: input.thread.commentId,
        text: input.context.candidate.text,
        authorRole: input.context.candidate.authorRole,
        observableTargetEvidence:
          input.context.candidate.observableTargetEvidence,
        languageHint: input.context.candidate.languageHint,
      },
      commentTextHash: input.thread.contentHash,
      context: input.context,
      assessment: input.assessment,
      assessedAt: input.assessedAt.toISOString(),
    });
    if (retained.commentTextHash !== input.thread.contentHash) {
      throw Object.assign(new Error("Comment text hash changed"), {
        code: "ITEM_COMMENT_HASH_MISMATCH",
      });
    }
    return store.saveInteractionAssessment({
      ...retained,
      scanRunId: input.run.id,
    });
  };
}

export async function startChannelScanRun(input: {
  accountId: string;
  connectedChannelId: string;
  retryOf?: string | null;
  provider?: ScanProviderKind;
  videoId?: string | null;
}): Promise<ScanRunStartResult> {
  const parsedProvider = scanProviderSchema.safeParse(input.provider ?? "synthetic");
  if (!parsedProvider.success) return { kind: "invalid" };
  const provider = parsedProvider.data;
  const videoId = input.videoId ?? null;
  if (
    (provider === "synthetic" && videoId !== null) ||
    (provider === YOUTUBE_SCAN_PROVIDER &&
      videoId !== null &&
      !youtubeVideoIdSchema.safeParse(videoId).success)
  ) {
    return { kind: "invalid" };
  }
  if (provider === YOUTUBE_SCAN_PROVIDER) {
    const blockedResult = await youtubeStartBlock({ ...input, videoId });
    if (blockedResult) return blockedResult;
  }
  const store = createPostgresScanRunStore();
  const { windowStart, windowEnd } = scanWindowFor(new Date());
  return store.startRun({
    accountId: input.accountId,
    connectedChannelId: input.connectedChannelId,
    videoId,
    provider,
    windowStart,
    windowEnd,
    retryOf: input.retryOf ?? null,
  });
}
export async function retryChannelScanRun(input: {
  accountId: string;
  runId: string;
}): Promise<ScanRunStartResult | { kind: "missing" }> {
  const store = createPostgresScanRunStore();
  const previous = await store.getRun(input.runId, input.accountId);
  if (!previous) return { kind: "missing" };
  if (previous.provider === YOUTUBE_SCAN_PROVIDER) {
    const blockedResult = await youtubeStartBlock({
      accountId: input.accountId,
      connectedChannelId: previous.connectedChannelId,
      videoId: previous.videoId,
    });
    if (blockedResult) return blockedResult;
  }
  const { windowStart, windowEnd } = scanWindowFor(new Date());
  return store.startRun({
    accountId: input.accountId,
    connectedChannelId: previous.connectedChannelId,
    videoId: previous.videoId,
    provider: previous.provider,
    windowStart,
    windowEnd,
    retryOf: previous.id,
  });
}

export async function getChannelScanRun(
  runId: string,
  accountId: string,
): Promise<ScanRun | null> {
  return createPostgresScanRunStore().getRun(runId, accountId);
}

export async function listChannelScanRuns(
  accountId: string,
  connectedChannelId?: string,
): Promise<ScanRun[]> {
  return createPostgresScanRunStore().listRuns(accountId, connectedChannelId);
}

export async function cancelChannelScanRun(input: {
  accountId: string;
  runId: string;
}): Promise<ScanRun | null> {
  return createPostgresScanRunStore().requestCancellation(input);
}

export async function failChannelScanScheduling(input: {
  accountId: string;
  runId: string;
}): Promise<void> {
  await createPostgresScanRunStore().failScheduling({
    ...input,
    failureCode: "WORKER_SCHEDULING_FAILED",
  });
}

export async function runChannelScanRun(runId: string): Promise<void> {
  const store = createPostgresScanRunStore();
  const run = await store.getRun(runId);
  if (!run) return;

  if (run.provider === "synthetic") {
    await executeScanRun(runId, {
      store,
      provider: createSyntheticCommentProvider(),
      workerId: randomUUID(),
    });
    return;
  }

  let target = null;
  try {
    target = await resolveYouTubeScanTarget({
      accountId: run.accountId,
      connectedChannelId: run.connectedChannelId,
    });
  } catch {
    // The provider remains explicitly YouTube with no target. Its first
    // operation fails closed and the durable run records the blocked failure;
    // it must never fall back to synthetic data.
  }
  await executeScanRun(runId, {
    store,
    provider: createYouTubeCommentProvider({
      target,
      assessInteraction: (context) => assessInteraction({ context }),
    }),
    persistInteractionAssessment: interactionAssessmentPersistence(store),
    workerId: randomUUID(),
  });
}
