import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// TODO: replace with `requireAdminClient()` once `lib/supabase/admin-client.ts` lands.

const AUTH_CLIENT_ERROR_STATUSES = new Set([400, 401, 403]);

function parseAllowlist(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

let warnedEmptyAllowlist = false;

export async function requireAdminPage(): Promise<{ email: string }> {
  const supabase = await createClient();

  let userEmail: string | undefined;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error && !AUTH_CLIENT_ERROR_STATUSES.has(error.status ?? -1)) {
      console.error("[admin-gate] auth failed", {
        stage: "auth",
        status: error.status ?? null,
        message: error.message,
      });
      throw new Error("Auth service temporarily unavailable");
    }
    userEmail = data.user?.email?.toLowerCase();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Auth service")) throw err;
    console.error("[admin-gate] auth threw", { stage: "auth", err });
    throw new Error("Auth service temporarily unavailable");
  }

  if (!userEmail) redirect("/auth/login");

  const allowlist = parseAllowlist();
  if (allowlist.size === 0) {
    if (!warnedEmptyAllowlist) {
      console.warn(
        "[admin-gate] ADMIN_EMAILS is empty/unset — all admin requests will be denied",
      );
      warnedEmptyAllowlist = true;
    }
    redirect("/");
  }

  if (!allowlist.has(userEmail)) {
    console.warn("[admin-gate] non-admin denied", { email: userEmail });
    redirect("/");
  }

  return { email: userEmail };
}
