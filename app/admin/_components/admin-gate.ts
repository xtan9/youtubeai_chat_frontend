import "server-only";

import { redirect } from "next/navigation";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { parseAdminAllowlist } from "@/lib/supabase/admin-client";
import type { AdminPrincipal } from "@/lib/admin/types";

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
  const principalResult = await resolveRequestPrincipal({ source: "admin_gate" });
  if (principalResult.kind === "unavailable") {
    throw new AuthInfraError();
  }

  if (principalResult.kind === "missing") redirect("/auth/login");

  const { userId, email } = principalResult.principal;
  const userEmail = email?.toLowerCase();
  if (!userEmail) redirect("/auth/login");

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
