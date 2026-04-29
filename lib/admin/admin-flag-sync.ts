import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { listAllUsers } from "./queries";

export interface ReconcileAdminFlagsResult {
  checked: number;
  promoted: number;
  demoted: number;
  failed: number;
  /** True when no per-row update errors occurred. */
  ok: boolean;
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
  const { users } = await listAllUsers(client);

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

  console.warn("[admin-flag-sync] reconcile complete", {
    checked: users.length,
    promoted,
    demoted,
    failed,
  });

  return {
    checked: users.length,
    promoted,
    demoted,
    failed,
    ok: failed === 0,
  };
}
