import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  admin: { userId: "admin-uuid", email: "alice@example.com" },
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

let sinkCalls: { msg: string; err: unknown }[];

beforeEach(() => {
  __resetAuditCountersForTests();
  sinkCalls = [];
  setAuditErrorSink((msg, err) => sinkCalls.push({ msg, err }));
});

afterEach(() => {
  __resetAuditCountersForTests();
});

describe("writeAudit", () => {
  it("returns ok with id on successful insert", async () => {
    const client = makeClient({ data: { id: "row-uuid" }, error: null });
    const result = await writeAudit(client, baseInput);
    expect(result).toEqual({ ok: true, id: "row-uuid" });
    expect(getAuditWriteFailureCount()).toBe(0);
    expect(sinkCalls).toHaveLength(0);
  });

  it("inserts the expected payload (admin_id, admin_email, action, resource_type, resource_id, metadata)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const insertSpy = vi.fn((_payload: Record<string, unknown>) => ({
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  it("returns ok:false on Supabase error response, never throws, increments counter, calls sink", async () => {
    const client = makeClient({
      data: null,
      error: { message: "permission denied" },
    });
    const result = await writeAudit(client, baseInput);
    expect(result).toEqual({ ok: false, reason: "permission denied" });
    expect(getAuditWriteFailureCount()).toBe(1);
    expect(sinkCalls).toHaveLength(1);
    expect(sinkCalls[0].msg).toContain("audit-log insert failed");
  });

  it("returns ok:false when insert resolves with no row, increments counter, calls sink", async () => {
    const client = makeClient({ data: null, error: null });
    const result = await writeAudit(client, baseInput);
    expect(result).toEqual({ ok: false, reason: "no row returned" });
    expect(getAuditWriteFailureCount()).toBe(1);
    expect(sinkCalls).toHaveLength(1);
    expect(sinkCalls[0].msg).toContain("audit-log insert returned no row");
  });

  it("returns ok:false when insert throws (network/runtime), never propagates, calls sink", async () => {
    const client = makeClient(new Error("ECONNRESET"));
    const result = await writeAudit(client, baseInput);
    expect(result).toEqual({ ok: false, reason: "ECONNRESET" });
    expect(getAuditWriteFailureCount()).toBe(1);
    expect(sinkCalls).toHaveLength(1);
    expect(sinkCalls[0].msg).toContain("audit-log insert threw");
  });

  it("stringifies non-Error throws (string) instead of returning undefined reason", async () => {
    // Build a client whose insert pipeline rejects with a plain string,
    // exercising the `e instanceof Error ? e.message : String(e)` branch.
    const single = vi.fn(() => Promise.reject("oops"));
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const client = {
      from: vi.fn(() => ({ insert })),
    } as unknown as SupabaseClient;

    const result = await writeAudit(client, baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("oops");
    }
    expect(getAuditWriteFailureCount()).toBe(1);
  });

  it("rejects empty admin.userId without touching the DB and without incrementing counter or sink", async () => {
    const fromSpy = vi.fn();
    const client = { from: fromSpy } as unknown as SupabaseClient;
    const result = await writeAudit(client, {
      ...baseInput,
      admin: { ...baseInput.admin, userId: "" },
    });
    expect(result).toEqual({ ok: false, reason: "missing admin.userId" });
    expect(fromSpy).not.toHaveBeenCalled();
    expect(getAuditWriteFailureCount()).toBe(0);
    expect(sinkCalls).toHaveLength(0);
  });

  it("rejects empty admin.email without touching the DB and without incrementing counter or sink", async () => {
    const fromSpy = vi.fn();
    const client = { from: fromSpy } as unknown as SupabaseClient;
    const result = await writeAudit(client, {
      ...baseInput,
      admin: { ...baseInput.admin, email: "" },
    });
    expect(result).toEqual({ ok: false, reason: "missing admin.email" });
    expect(fromSpy).not.toHaveBeenCalled();
    expect(getAuditWriteFailureCount()).toBe(0);
    expect(sinkCalls).toHaveLength(0);
  });

  it("rejects empty resourceId without touching the DB and without incrementing counter or sink", async () => {
    const fromSpy = vi.fn();
    const client = { from: fromSpy } as unknown as SupabaseClient;
    const result = await writeAudit(client, { ...baseInput, resourceId: "" });
    expect(result).toEqual({ ok: false, reason: "missing resourceId" });
    expect(fromSpy).not.toHaveBeenCalled();
    expect(getAuditWriteFailureCount()).toBe(0);
    expect(sinkCalls).toHaveLength(0);
  });
});
