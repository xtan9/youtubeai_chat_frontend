import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  writeAudit,
  getAuditWriteFailureCount,
  __resetAuditCountersForTests,
  setAuditErrorSink,
  type WriteAuditInput,
} from "../audit";
import type { SupabaseClient } from "@supabase/supabase-js";

type ClientFactory = (
  insertResponse: { data: unknown; error: unknown } | Error,
) => SupabaseClient;

const baseInput: WriteAuditInput = {
  adminId: "admin-uuid",
  adminEmail: "alice@example.com",
  action: "view_transcript",
  resourceType: "summary",
  resourceId: "summary-uuid",
};

const makeClient: ClientFactory = (insertResponse) => {
  const single = vi.fn(() => {
    if (insertResponse instanceof Error) return Promise.reject(insertResponse);
    return Promise.resolve(insertResponse);
  });
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return { from } as unknown as SupabaseClient;
};

beforeEach(() => {
  __resetAuditCountersForTests();
  setAuditErrorSink(() => {});
});

describe("writeAudit", () => {
  it("returns ok with id on successful insert", async () => {
    const client = makeClient({ data: { id: "row-uuid" }, error: null });
    const result = await writeAudit(client, baseInput);
    expect(result).toEqual({ ok: true, id: "row-uuid" });
    expect(getAuditWriteFailureCount()).toBe(0);
  });

  it("inserts the expected payload (admin_id, admin_email, action, resource_type, resource_id, metadata)", async () => {
    const insertSpy = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: { id: "row" }, error: null }),
      }),
    }));
    const fromSpy = vi.fn(() => ({ insert: insertSpy }));
    const client = { from: fromSpy } as unknown as SupabaseClient;

    await writeAudit(client, {
      ...baseInput,
      metadata: { request_id: "req-1" },
    });

    expect(fromSpy).toHaveBeenCalledWith("admin_audit_log");
    expect(insertSpy).toHaveBeenCalledWith({
      admin_id: "admin-uuid",
      admin_email: "alice@example.com",
      action: "view_transcript",
      resource_type: "summary",
      resource_id: "summary-uuid",
      metadata: { request_id: "req-1" },
    });
  });

  it("defaults metadata to {} when omitted", async () => {
    const insertSpy = vi.fn((_payload: Record<string, unknown>) => ({
      select: () => ({
        single: () => Promise.resolve({ data: { id: "row" }, error: null }),
      }),
    }));
    const client = {
      from: vi.fn(() => ({ insert: insertSpy })),
    } as unknown as SupabaseClient;

    await writeAudit(client, baseInput);
    expect(insertSpy.mock.calls[0][0]).toMatchObject({ metadata: {} });
  });

  it("returns ok:false on Supabase error response, never throws, increments counter", async () => {
    const client = makeClient({
      data: null,
      error: { message: "permission denied" },
    });
    const result = await writeAudit(client, baseInput);
    expect(result).toEqual({ ok: false, reason: "permission denied" });
    expect(getAuditWriteFailureCount()).toBe(1);
  });

  it("returns ok:false when insert resolves with no row, increments counter", async () => {
    const client = makeClient({ data: null, error: null });
    const result = await writeAudit(client, baseInput);
    expect(result).toEqual({ ok: false, reason: "no row returned" });
    expect(getAuditWriteFailureCount()).toBe(1);
  });

  it("returns ok:false when insert throws (network/runtime), never propagates", async () => {
    const client = makeClient(new Error("ECONNRESET"));
    const result = await writeAudit(client, baseInput);
    expect(result).toEqual({ ok: false, reason: "ECONNRESET" });
    expect(getAuditWriteFailureCount()).toBe(1);
  });

  it("rejects empty adminId without touching the DB", async () => {
    const fromSpy = vi.fn();
    const client = { from: fromSpy } as unknown as SupabaseClient;
    const result = await writeAudit(client, { ...baseInput, adminId: "" });
    expect(result).toEqual({ ok: false, reason: "missing adminId" });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("rejects empty adminEmail without touching the DB", async () => {
    const fromSpy = vi.fn();
    const client = { from: fromSpy } as unknown as SupabaseClient;
    const result = await writeAudit(client, { ...baseInput, adminEmail: "" });
    expect(result).toEqual({ ok: false, reason: "missing adminEmail" });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("rejects empty resourceId without touching the DB", async () => {
    const fromSpy = vi.fn();
    const client = { from: fromSpy } as unknown as SupabaseClient;
    const result = await writeAudit(client, { ...baseInput, resourceId: "" });
    expect(result).toEqual({ ok: false, reason: "missing resourceId" });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("routes errors through the configured sink, not console", async () => {
    const sinkCalls: { msg: string; err: unknown }[] = [];
    setAuditErrorSink((msg, err) => sinkCalls.push({ msg, err }));
    const client = makeClient({
      data: null,
      error: { message: "boom" },
    });
    await writeAudit(client, baseInput);
    expect(sinkCalls).toHaveLength(1);
    expect(sinkCalls[0].msg).toContain("audit-log insert failed");
  });
});
