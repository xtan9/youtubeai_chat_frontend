/** Machine-readable, display-safe warnings returned by Admin report loaders. */
export const REPORT_COMPLETENESS_WARNING_CODES = {
  userAccountDirectoryUnavailable: "USER_ACCOUNT_DIRECTORY_UNAVAILABLE",
  userAccountDirectoryTruncated: "USER_ACCOUNT_DIRECTORY_TRUNCATED",
  performanceSummariesTruncated: "PERFORMANCE_SUMMARIES_TRUNCATED",
  performanceActivityUnavailable: "PERFORMANCE_ACTIVITY_UNAVAILABLE",
  performanceActivityTruncated: "PERFORMANCE_ACTIVITY_TRUNCATED",
} as const;

export type ReportCompletenessWarningCode =
  (typeof REPORT_COMPLETENESS_WARNING_CODES)[keyof typeof REPORT_COMPLETENESS_WARNING_CODES];

export interface ReportCompletenessWarning {
  code: ReportCompletenessWarningCode;
  description: string;
}

export const REPORT_COMPLETENESS_DESCRIPTIONS: Readonly<
  Record<ReportCompletenessWarningCode, string>
> = {
  USER_ACCOUNT_DIRECTORY_UNAVAILABLE:
    "User Account total is unavailable because account enumeration failed.",
  USER_ACCOUNT_DIRECTORY_TRUNCATED:
    "User Account total may be incomplete because account enumeration reached its row cap.",
  PERFORMANCE_SUMMARIES_TRUNCATED:
    "Performance data may be incomplete because the summary row cap was reached.",
  PERFORMANCE_ACTIVITY_UNAVAILABLE:
    "Administrator exclusion may be incomplete because activity lookup failed.",
  PERFORMANCE_ACTIVITY_TRUNCATED:
    "Administrator exclusion may be incomplete because activity lookup reached its row cap.",
};

export function reportCompletenessWarning(
  code: ReportCompletenessWarningCode,
): ReportCompletenessWarning {
  return {
    code,
    description: REPORT_COMPLETENESS_DESCRIPTIONS[code],
  };
}
