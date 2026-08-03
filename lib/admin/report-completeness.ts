/** Machine-readable, display-safe warnings returned by Admin report loaders. */
export const REPORT_COMPLETENESS_WARNING_CODES = {
  userAccountDirectoryUnavailable: "USER_ACCOUNT_DIRECTORY_UNAVAILABLE",
  userAccountDirectoryTruncated: "USER_ACCOUNT_DIRECTORY_TRUNCATED",
  topUserAccountLookupUnavailable: "TOP_USER_ACCOUNT_LOOKUP_UNAVAILABLE",
  dashboardSummariesTruncated: "DASHBOARD_SUMMARIES_TRUNCATED",
  dashboardActivityTruncated: "DASHBOARD_ACTIVITY_TRUNCATED",
  dashboardCacheHitUnavailable: "DASHBOARD_CACHE_HIT_UNAVAILABLE",
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
  TOP_USER_ACCOUNT_LOOKUP_UNAVAILABLE:
    "Top User-Account email data may be incomplete because an account lookup failed.",
  DASHBOARD_SUMMARIES_TRUNCATED:
    "Dashboard summary data may be incomplete because the summary row cap was reached.",
  DASHBOARD_ACTIVITY_TRUNCATED:
    "Dashboard activity data may be incomplete because the activity row cap was reached.",
  DASHBOARD_CACHE_HIT_UNAVAILABLE:
    "Cache-hit metrics are unavailable because summary enrichment failed.",
};

export function reportCompletenessWarning(
  code: ReportCompletenessWarningCode,
): ReportCompletenessWarning {
  return {
    code,
    description: REPORT_COMPLETENESS_DESCRIPTIONS[code],
  };
}
