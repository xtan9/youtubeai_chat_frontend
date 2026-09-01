import "server-only";

import { randomUUID } from "node:crypto";
import {
  scanWindowFor,
  type ScanRun,
  type ScanRunStartResult,
} from "./contracts";
import { createPostgresScanRunStore } from "./repository";
import { executeScanRun } from "./runner";
import { createSyntheticCommentProvider } from "./synthetic-provider";

export async function startChannelScanRun(input: {
  accountId: string;
  connectedChannelId: string;
  retryOf?: string | null;
}): Promise<ScanRunStartResult> {
  const store = createPostgresScanRunStore();
  const { windowStart, windowEnd } = scanWindowFor(new Date());
  return store.startRun({
    accountId: input.accountId,
    connectedChannelId: input.connectedChannelId,
    provider: "synthetic",
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
  const { windowStart, windowEnd } = scanWindowFor(new Date());
  return store.startRun({
    accountId: input.accountId,
    connectedChannelId: previous.connectedChannelId,
    provider: "synthetic",
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
  await executeScanRun(runId, {
    store,
    provider: createSyntheticCommentProvider(),
    workerId: randomUUID(),
  });
}
