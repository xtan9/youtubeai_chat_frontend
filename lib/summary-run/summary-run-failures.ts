import { SummaryStreamProtocolError } from "@/lib/api-contracts/summary";
import {
  type SummaryRunFailureKind,
  type SummaryRunFailureCode,
  type SummaryQuotaErrorCode,
  type SummaryRunQuotaInfo,
  type SummaryRunFailure,
} from "./summary-run-types";

export class SummaryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = "SummaryRequestError";
  }
}

export const SUMMARY_RUN_FAILURE_MESSAGES: Readonly<
  Record<SummaryRunFailureCode, string>
> = Object.freeze({
  AUTH_REQUIRED:
    "Authentication is required to summarize this video. Please sign in again.",
  AUTHENTICATION_FAILED: "Authentication failed. Please sign in again.",
  QUOTA_EXCEEDED: "You've reached your summary limit. Upgrade to continue.",
  RATE_LIMITED:
    "Too many summary requests. Please wait a moment and try again.",
  INVALID_REQUEST: "Please check the YouTube URL and try again.",
  REQUEST_FAILED:
    "The summary request could not be completed. Please try again.",
  NETWORK_FAILURE:
    "Couldn't connect to the summary service. Please try again.",
  PROCESSING_FAILURE:
    "Couldn't process this video. Please try again or try a different URL.",
  PROTOCOL_FAILURE: "The summary stream was invalid. Please try again.",
  malformed_json: "The summary stream was invalid. Please try again.",
  unknown_event_variant: "The summary stream was invalid. Please try again.",
  invalid_event: "The summary stream was invalid. Please try again.",
  invalid_full_transcript: "Transcript timing is unavailable.",
  PREMATURE_EOF:
    "The summary stream ended before the Summary was complete. Please try again.",
  MISSING_METADATA: "The summary stream was invalid. Please try again.",
  DUPLICATE_METADATA: "The summary stream was invalid. Please try again.",
  EMPTY_SUMMARY:
    "The summary service returned no usable Summary. Please try again.",
  EVENT_AFTER_TERMINATION: "The summary stream was invalid. Please try again.",
  MISSING_ORIGIN: "The summary stream was invalid. Please try again.",
});

const DEFAULT_FAILURE_CODE_BY_KIND: Record<
  SummaryRunFailureKind,
  SummaryRunFailureCode
> = {
  authentication: "AUTHENTICATION_FAILED",
  quota: "QUOTA_EXCEEDED",
  rate_limit: "RATE_LIMITED",
  request: "REQUEST_FAILED",
  network: "NETWORK_FAILURE",
  processing: "PROCESSING_FAILURE",
  protocol: "PROTOCOL_FAILURE",
};

/** Resolve the safe display copy even for a snapshot assembled by another adapter. */
export function getSummaryRunFailureMessage(
  failure: Pick<SummaryRunFailure, "kind" | "code">,
): string {
  return (
    SUMMARY_RUN_FAILURE_MESSAGES[failure.code] ??
    SUMMARY_RUN_FAILURE_MESSAGES[DEFAULT_FAILURE_CODE_BY_KIND[failure.kind]] ??
    SUMMARY_RUN_FAILURE_MESSAGES.PROCESSING_FAILURE
  );
}

class SummaryRunFailureError extends Error {
  constructor(readonly failure: SummaryRunFailure) {
    super(failure.message);
    this.name = "SummaryRunFailureError";
  }
}

export class SummaryRunProtocolFailure extends Error {
  constructor(
    readonly code: SummaryRunFailureCode,
    message = SUMMARY_RUN_FAILURE_MESSAGES.PROTOCOL_FAILURE,
  ) {
    super(message);
    this.name = "SummaryRunProtocolFailure";
  }
}

export class SummaryRunPrematureEofFailure extends Error {
  constructor() {
    super(SUMMARY_RUN_FAILURE_MESSAGES.PREMATURE_EOF);
    this.name = "SummaryRunPrematureEofFailure";
  }
}

export class SummaryQuotaRequestFailure extends Error {
  constructor(readonly quota: SummaryRunQuotaInfo) {
    super(SUMMARY_RUN_FAILURE_MESSAGES.QUOTA_EXCEEDED);
    this.name = "SummaryQuotaRequestFailure";
  }
}

export function requestFailureForStatus(status: number): {
  readonly kind: SummaryRunFailureKind;
  readonly code: SummaryRunFailureCode;
} {
  if (status === 401 || status === 403) {
    return { kind: "authentication", code: "AUTHENTICATION_FAILED" };
  }
  if (status === 402) {
    return { kind: "quota", code: "QUOTA_EXCEEDED" };
  }
  if (status === 429) {
    return { kind: "rate_limit", code: "RATE_LIMITED" };
  }
  if (status === 400) {
    return { kind: "request", code: "INVALID_REQUEST" };
  }
  return { kind: "request", code: "REQUEST_FAILED" };
}

function makeFailure(
  kind: SummaryRunFailureKind,
  code: SummaryRunFailureCode = DEFAULT_FAILURE_CODE_BY_KIND[kind],
  status?: number,
  quota?: SummaryRunQuotaInfo,
): SummaryRunFailureError {
  const failure: SummaryRunFailure = {
    kind,
    code,
    message: getSummaryRunFailureMessage({ kind, code }),
    ...(status !== undefined ? { status } : {}),
    ...(quota ? { quota: Object.freeze(quota) } : {}),
  };
  return new SummaryRunFailureError(Object.freeze(failure));
}

export function toFailure(error: unknown): SummaryRunFailure {
  if (error instanceof SummaryRunFailureError) return error.failure;

  if (error instanceof SummaryRunProtocolFailure) {
    return makeFailure("protocol", error.code).failure;
  }

  if (error instanceof SummaryRunPrematureEofFailure) {
    return makeFailure("protocol", "PREMATURE_EOF").failure;
  }

  if (error instanceof SummaryStreamProtocolError) {
    return makeFailure("protocol", error.code).failure;
  }

  if (error instanceof SummaryQuotaRequestFailure) {
    return makeFailure(
      "quota",
      "QUOTA_EXCEEDED",
      402,
      error.quota,
    ).failure;
  }

  if (error instanceof SummaryRequestError) {
    const classification = requestFailureForStatus(error.status);
    const code =
      error.status === 401 && error.errorCode === "AUTH_REQUIRED"
        ? "AUTH_REQUIRED"
        : classification.code;
    return {
      ...makeFailure(classification.kind, code, error.status).failure,
    };
  }

  return makeFailure("network").failure;
}

export function terminalFailure(
  kind: SummaryRunFailureKind,
  code: SummaryRunFailureCode = DEFAULT_FAILURE_CODE_BY_KIND[kind],
): SummaryRunFailureError {
  return makeFailure(kind, code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function quotaInfoFromResponse(value: unknown): SummaryRunQuotaInfo {
  const errorCode: SummaryQuotaErrorCode =
    isRecord(value) && value.errorCode === "anon_quota_exceeded"
      ? "anon_quota_exceeded"
      : "free_quota_exceeded";
  return Object.freeze({
    errorCode,
    tier: errorCode === "anon_quota_exceeded" ? "anon" : "free",
    upgradeUrl: "/pricing",
  });
}
