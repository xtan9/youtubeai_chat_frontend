import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  reportCompletenessWarning,
  REPORT_COMPLETENESS_WARNING_CODES,
  type ReportCompletenessWarning,
} from "./report-completeness";
import { listUserAccounts } from "./user-account-directory";

export interface AdminShellInput {
  allowlist: readonly string[];
}

export interface AdminShellResult {
  /** Null means the registered-account count could not be read. */
  usersTotal: number | null;
  warnings: ReportCompletenessWarning[];
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Load the data owned by the Admin Shell. Authorization, privileged-client
 * construction, and rendering remain in the route layout.
 */
export async function loadAdminShell(
  client: SupabaseClient,
  input: AdminShellInput,
): Promise<AdminShellResult> {
  try {
    const directory = await listUserAccounts(client);
    const allowlist = new Set(input.allowlist.map(normalizeEmail));
    const usersTotal = directory.users.reduce((count, user) => {
      if (user.isAnonymous || !user.email) return count;
      return allowlist.has(normalizeEmail(user.email)) ? count : count + 1;
    }, 0);

    return {
      usersTotal,
      warnings: directory.truncated
        ? [
            reportCompletenessWarning(
              REPORT_COMPLETENESS_WARNING_CODES.userAccountDirectoryTruncated,
            ),
          ]
        : [],
    };
  } catch (error) {
    console.error("[admin-shell] User Account total unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      usersTotal: null,
      warnings: [
        reportCompletenessWarning(
          REPORT_COMPLETENESS_WARNING_CODES.userAccountDirectoryUnavailable,
        ),
      ],
    };
  }
}
