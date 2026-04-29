import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Every audited action is named explicitly. The DB column is TEXT with a
// length>0 CHECK (no Postgres ENUMs); the union below is the wire-level
// contract callers must satisfy. Adding a new action is a code change in
// this file plus a grep-verifiable update to the audit-log feed UI.

export type AuditAction =
  | "view_transcript"
  | "view_summary_text"
  | "view_user_email_list"
  | "reset_rate_limit"
  | "suspend_user"
  | "restore_user";

export type AuditResourceType = "summary" | "user" | "video" | "rate_limit";

export interface WriteAuditInput {
  adminId: string;
  adminEmail: string;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  metadata?: Record<string, unknown>;
}

let writeFailureCount = 0;
export function getAuditWriteFailureCount(): number {
  return writeFailureCount;
}
export function __resetAuditCountersForTests(): void {
  writeFailureCount = 0;
}

let errorSink: (msg: string, err: unknown) => void = (msg, err) => {
  console.error(msg, err);
};
export function setAuditErrorSink(fn: (msg: string, err: unknown) => void): void {
  errorSink = fn;
}

/**
 * Append an admin audit row. Fail-open: never throws. The read this audits
 * succeeds even if the audit insert fails (logged + counted instead).
 *
 * Returns { ok: true, id } on success; { ok: false, reason } on failure.
 */
export async function writeAudit(
  client: SupabaseClient,
  input: WriteAuditInput,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (!input.adminId) return { ok: false, reason: "missing adminId" };
  if (!input.adminEmail) return { ok: false, reason: "missing adminEmail" };
  if (!input.resourceId) return { ok: false, reason: "missing resourceId" };

  try {
    const { data, error } = await client
      .from("admin_audit_log")
      .insert({
        admin_id: input.adminId,
        admin_email: input.adminEmail,
        action: input.action,
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        metadata: input.metadata ?? {},
      })
      .select("id")
      .single();

    if (error) {
      writeFailureCount++;
      errorSink("audit-log insert failed", error);
      return { ok: false, reason: error.message };
    }
    if (!data?.id) {
      writeFailureCount++;
      errorSink("audit-log insert returned no row", { data });
      return { ok: false, reason: "no row returned" };
    }
    return { ok: true, id: data.id };
  } catch (e) {
    writeFailureCount++;
    errorSink("audit-log insert threw", e);
    return { ok: false, reason: (e as Error).message };
  }
}
