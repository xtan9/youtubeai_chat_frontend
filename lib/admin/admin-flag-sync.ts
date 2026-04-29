import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { listAllUsers } from "./queries";

export interface ReconcileAdminFlagsResult {
  checked: number;
  promoted: number;
  demoted: number;
  failed: number;
  /** True when listAllUsers hit its row cap; reconcile is incomplete past it. */
  truncated: boolean;
  /** True when the run was short-circuited by the module-level cooldown. */
  skipped: boolean;
  /** True when no per-row update errors occurred AND the run examined all users.
   * When `skipped` is true the run did not examine anything — `ok` is a no-op
   * "no new errors" signal in that case, NOT a state-verified-consistent signal.
   * Callers gating telemetry on `!ok` should also check `skipped` first. */
  ok: boolean;
}

/** Module-level timestamp of last reconcile completion. Lives only on
 * a single Node/Lambda instance — cold starts reset it (acceptable;
 * the function is idempotent). */
let lastReconcileAt = 0;

/** Skip the reconcile if it ran within the last RECONCILE_COOLDOWN_MS.
 * Each admin nav triggers reconcile; without this guard a busy admin
 * session re-paginates auth.users on every page change. */
const RECONCILE_COOLDOWN_MS = 60_000;

/** Test-only: reset the cooldown so independent tests aren't affected
 * by one another. Do not use in production code. */
export function __resetReconcileCooldownForTests() {
  lastReconcileAt = 0;
}

/**
 * Reconcile auth.users.app_metadata.is_admin against the ADMIN_EMAILS
 * allowlist. For each user:
 *   - If email is in the allowlist (case-insensitive) AND flag != true → promote.
 *   - If email is NOT in the allowlist AND flag == true → demote.
 *   - Otherwise → no-op.
 *
 * Idempotent: only writes when the actual flag differs from expected.
 * Updates merge into existing app_metadata so other properties are preserved.
 *
 * Designed to be called fire-and-forget from the admin layout. Per-row
 * errors are logged and counted but never thrown — eventual consistency
 * is acceptable for flag state.
 */
export async function reconcileAdminFlags(
  client: SupabaseClient,
  allowlist: Set<string>,
): Promise<ReconcileAdminFlagsResult> {
  const now = Date.now();
  if (now - lastReconcileAt < RECONCILE_COOLDOWN_MS) {
    console.log("[admin-flag-sync] reconcile skipped (cooldown active)", {
      elapsedMs: now - lastReconcileAt,
      cooldownMs: RECONCILE_COOLDOWN_MS,
    });
    return {
      checked: 0,
      promoted: 0,
      demoted: 0,
      failed: 0,
      truncated: false,
      skipped: true,
      ok: true,
    };
  }
  lastReconcileAt = now;

  const { users, truncated } = await listAllUsers(client);

  let promoted = 0;
  let demoted = 0;
  let failed = 0;

  for (const user of users) {
    if (!user.email) continue;
    const expected = allowlist.has(user.email.toLowerCase());
    const actual = user.app_metadata?.is_admin === true;
    if (expected === actual) continue;

    const mergedMetadata = {
      ...(user.app_metadata ?? {}),
      is_admin: expected,
    };
    const { error } = await client.auth.admin.updateUserById(user.id, {
      app_metadata: mergedMetadata,
    });
    if (error) {
      failed += 1;
      console.error(
        "[admin-flag-sync] reconcileAdminFlags: updateUserById failed",
        { userId: user.id, message: error.message },
      );
      continue;
    }
    if (expected) promoted += 1;
    else demoted += 1;
  }

  // Only warn when there's something operationally meaningful to report.
  // Steady-state runs (no promotions/demotions/failures, full coverage)
  // would otherwise flood the warn channel on every admin layout render.
  // Truncated runs always warn because they indicate an incomplete pass.
  const noisy = promoted + demoted + failed > 0 || truncated;
  if (noisy) {
    console.warn("[admin-flag-sync] reconcile complete", {
      checked: users.length,
      promoted,
      demoted,
      failed,
      truncated,
    });
  }

  return {
    checked: users.length,
    promoted,
    demoted,
    failed,
    truncated,
    skipped: false,
    ok: failed === 0 && !truncated,
  };
}
