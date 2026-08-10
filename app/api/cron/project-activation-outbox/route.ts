import "server-only";

import { drainProjectActivationOutbox } from "@/lib/analytics/project-server";

export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (
    !cronSecret ||
    cronSecret.length < 16 ||
    request.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return Response.json({ outcome: "unauthorized" }, { status: 401 });
  }

  const result = await drainProjectActivationOutbox(100);
  if (result.unavailable) {
    return Response.json(
      { claimed: 0, sent: 0, pending: 0 },
      { status: 503 },
    );
  }
  return Response.json({
    claimed: result.claimed,
    sent: result.sent,
    pending: result.pending,
  });
}
