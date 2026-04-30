import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminPrincipal } from "@/lib/admin/types";

// Every audited action is named explicitly. The DB column is TEXT with a
// length>0 CHECK (no Postgres ENUMs); this list is the wire-level
// contract callers must satisfy. Derived as a `const` literal array so
// the runtime constant and the type live in one place — drift between
// `AUDIT_ACTIONS` (used for runtime `isAuditAction` validation in
// queries.ts) and `AuditAction` (the writer type) is now non-typeable.
export const AUDIT_ACTIONS = [
  "view_transcript",
  "view_summary_text",
  "view_user_email_list",
  "view_video_users",
  "reset_rate_limit",
  "suspend_user",
  "restore_user",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditResourceType = "summary" | "user" | "video" | "rate_limit";

export interface WriteAuditInput {
  /** The gate-verified admin identity. Only `requireAdminPage()` /
   *  `requireAdmin()` produce this — callers cannot construct it by hand,
   *  which is what makes "wrong email written" non-typeable. */
  admin: AdminPrincipal;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  metadata?: Record<string, unknown>;
}

// Per-invocation only. On Vercel each cold start resets this and concurrent
// invocations across instances each have their own. Useful as a
// "did *this* request's audit fail" hint, not as a fleet-wide health
// metric — that signal must come from the error sink (PR-3+ wires it to
// PostHog / equivalent).
let writeFailureCount = 0;
export function getAuditWriteFailureCount(): number {
  return writeFailureCount;
}

const defaultErrorSink: (msg: string, err: unknown) => void = (msg, err) => {
  console.error(msg, err);
};
let errorSink = defaultErrorSink;

export function setAuditErrorSink(fn: (msg: string, err: unknown) => void): void {
  errorSink = fn;
}

export function __resetAuditCountersForTests(): void {
  writeFailureCount = 0;
  errorSink = defaultErrorSink;
}

/**
 * Append an admin audit row. Fail-open: never throws. The read this audits
 * succeeds even if the audit insert fails (logged + counted instead).
 *
 * The failure counter tracks DB-write failures only — caller-input
 * validation rejections return `ok: false` without incrementing it, so a
 * counter spike points at infra, not buggy callers.
 *
 * Returns { ok: true, id } on success; { ok: false, reason } on failure.
 */
export async function writeAudit(
  client: SupabaseClient,
  input: WriteAuditInput,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (!input.admin.userId) return { ok: false, reason: "missing admin.userId" };
  if (!input.admin.email) return { ok: false, reason: "missing admin.email" };
  if (!input.resourceId) return { ok: false, reason: "missing resourceId" };

  try {
    const { data, error } = await client
      .from("admin_audit_log")
      .insert({
        admin_id: input.admin.userId,
        admin_email: input.admin.email,
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
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
