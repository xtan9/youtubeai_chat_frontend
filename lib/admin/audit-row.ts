import { AUDIT_ACTIONS } from "./audit";
import type { AuditAction, AuditResourceType } from "./audit";

export interface AuditRow {
  id: string;
  createdAt: string;
  adminId: string;
  adminEmail: string;
  /** Unknown values remain strings so persisted vocabulary stays visible. */
  action: AuditAction | string;
  /** Unknown values remain strings so persisted vocabulary stays visible. */
  resourceType: AuditResourceType | string;
  resourceId: string;
  metadata: Record<string, unknown>;
}

const AUDIT_RESOURCE_TYPES: readonly AuditResourceType[] = [
  "summary",
  "user",
  "video",
  "rate_limit",
] as const;

function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

function isAuditResourceType(value: string): value is AuditResourceType {
  return (AUDIT_RESOURCE_TYPES as readonly string[]).includes(value);
}

export function mapAuditRow(row: Record<string, unknown>): AuditRow {
  const action = String(row.action);
  const resourceType = String(row.resource_type);
  if (!isAuditAction(action)) {
    console.error("[audit-report] unknown persisted audit action", { action });
  }
  if (!isAuditResourceType(resourceType)) {
    console.error("[audit-report] unknown persisted audit resource_type", {
      resourceType,
    });
  }
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    adminId: String(row.admin_id),
    adminEmail: String(row.admin_email),
    action,
    resourceType,
    resourceId: String(row.resource_id),
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {},
  };
}
