import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { AUDIT_PAGE_SIZE_CAP } from "./admin-constants";
import { mapAuditRow } from "./audit-row";
import { QueryError } from "./errors";
import type { AuditReport, AuditReportInput } from "./report-types";

const DEFAULT_PAGE_SIZE = 50;

interface KeysetCursor {
  created_at: string;
  id: string;
}

export async function loadAuditReport(
  client: SupabaseClient,
  input: AuditReportInput = {},
): Promise<AuditReport> {
  const pageSize = Math.min(
    Math.max(input.pageSize ?? DEFAULT_PAGE_SIZE, 1),
    AUDIT_PAGE_SIZE_CAP,
  );
  let query = client
    .from("admin_audit_log")
    .select(
      "id, created_at, admin_id, admin_email, action, resource_type, resource_id, metadata",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);

  const decoded = decodeCursor(input.cursor);
  if (decoded) {
    query = query.or(
      `created_at.lt.${decoded.created_at},and(created_at.eq.${decoded.created_at},id.lt.${decoded.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw new QueryError("loadAuditReport", error.message);

  const rows = (data ?? []).slice(0, pageSize).map(mapAuditRow);
  const nextCursor =
    (data?.length ?? 0) > pageSize
      ? encodeCursor({
          created_at: rows[rows.length - 1].createdAt,
          id: rows[rows.length - 1].id,
        })
      : null;

  return { rows, nextCursor };
}

function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(raw: string | null | undefined): KeysetCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.created_at === "string" &&
      typeof parsed.id === "string"
    ) {
      return parsed;
    }
    console.warn(
      "[audit-report] invalid cursor shape — falling back to first page",
      { cursorPrefix: raw.slice(0, 16) },
    );
  } catch (error) {
    console.warn(
      "[audit-report] cursor base64/json decode failed — falling back to first page",
      {
        cursorPrefix: raw.slice(0, 16),
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
  return null;
}
