import { timingSafeEqual } from "node:crypto";
import { runCatalogAdmissionWorker } from "@/lib/catalog/catalog-admission-worker";

export const maxDuration = 60;

function isAuthorized(request: Request, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json({ message: "Worker unavailable" }, { status: 503 });
  }
  if (!isAuthorized(request, secret)) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    return Response.json(await runCatalogAdmissionWorker());
  } catch {
    return Response.json({ message: "Worker failed" }, { status: 500 });
  }
}
