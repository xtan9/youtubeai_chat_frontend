import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-side admin gate.
 *
 * Stub today — wires fully when the spike-validated `requireAdminClient()`
 * primitive lands at `lib/supabase/admin-client.ts` (see
 * `.claude/skills/spike-findings-youtubeai-chat/references/admin-gating.md`).
 *
 * Current behaviour: requires a signed-in user and an email present in
 * the `ADMIN_EMAILS` env allowlist. Empty / unset allowlist denies
 * everyone (fail-closed).
 *
 * TODO(admin-gate): replace with `requireAdminClient(user, ADMIN_EMAILS)`
 * once `lib/supabase/admin-client.ts` is ported from the spike. That
 * module also returns the service-role client used to query admin data.
 */

let cachedAllowlist: Set<string> | null = null;

function parseAllowlist(): Set<string> {
  if (cachedAllowlist) return cachedAllowlist;
  cachedAllowlist = new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
  return cachedAllowlist;
}

export async function requireAdminPage(): Promise<{ email: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");
  const email = user.email?.toLowerCase();
  if (!email) redirect("/auth/login");

  const allowlist = parseAllowlist();
  if (!allowlist.has(email)) redirect("/");

  return { email };
}
