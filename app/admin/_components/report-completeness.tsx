import type { ReportCompletenessWarning } from "@/lib/admin/report-completeness";

export function ReportCompletenessNotice({
  warnings,
}: {
  warnings: readonly ReportCompletenessWarning[];
}) {
  if (warnings.length === 0) return null;

  return (
    <div className="report-completeness" role="status" aria-live="polite">
      <span className="report-completeness-title">Report completeness</span>
      {warnings.map((warning) => (
        <span key={warning.code}>{warning.description}</span>
      ))}
    </div>
  );
}
