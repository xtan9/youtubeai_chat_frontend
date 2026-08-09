import { runServerSummaryRun } from "@/lib/summary-run/server-summary-run";

export const maxDuration = 300;

export function POST(request: Request) {
  return runServerSummaryRun(request);
}
