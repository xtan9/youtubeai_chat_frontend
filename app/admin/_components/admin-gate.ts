import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseAdminAllowlist } from "@/lib/supabase/admin-client";
import type { AdminPrincipal } from "@/lib/admin/types";

const AUTH_CLIENT_ERROR_STATUSES = new Set([400, 401, 403]);

let warnedEmptyAllowlist = false;

class AuthInfraError extends Error {
  constructor(cause?: unknown) {
    super("Auth service temporarily unavailable", { cause });
    this.name = "AuthInfraError";
  }
}

export interface AdminPageContext extends AdminPrincipal {
  allowlist: Set<string>;
}

export async function requireAdminPage(): Promise<AdminPageContext> {
  const supabase = await createClient();

  let userEmail: string | undefined;
  let userId: string | undefined;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error && !AUTH_CLIENT_ERROR_STATUSES.has(error.status ?? -1)) {
      console.error("[admin-gate] auth failed", {
        stage: "auth",
        status: error.status ?? null,
        message: error.message,
      });
      throw new AuthInfraError(error);
    }
    userEmail = data.user?.email?.toLowerCase();
    userId = data.user?.id;
  } catch (err) {
    if (err instanceof AuthInfraError) throw err;
    console.error("[admin-gate] auth threw", { stage: "auth", err });
    throw new AuthInfraError(err);
  }

  if (!userEmail || !userId) redirect("/auth/login");

  const allowlist = parseAdminAllowlist(process.env.ADMIN_EMAILS);
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

  return { userId, email: userEmail, allowlist };
}
