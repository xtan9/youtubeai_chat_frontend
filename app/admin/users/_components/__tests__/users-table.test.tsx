// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/admin/users",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/admin/users/_actions/view-transcript", () => ({
  viewTranscriptAction: vi.fn(),
}));

vi.mock("../../../_components/admin-context", () => ({
  useAdmin: () => ({ email: "alice@x" }),
}));

import { UsersTable } from "../users-table";
import type { AdminUserRow, AuditRow } from "@/lib/admin/queries";

const baseRow = (over: Partial<AdminUserRow>): AdminUserRow => ({
  userId: "u",
  email: "u@x",
  emailVerified: true,
  providers: ["email"],
  status: "active",
  createdAt: "2026-04-01T00:00:00Z",
  lastSignIn: "2026-04-20T00:00:00Z",
  lastActivity: "2026-04-25T00:00:00Z",
  summaries: 5,
  whisper: 1,
  whisperPct: 20,
  flagged: false,
  isAnonymous: false,
  isSsoUser: false,
  bannedUntil: null,
  deletedAt: null,
  appMetadata: { provider: "email" },
  userMetadata: { name: "u" },
  ...over,
});

beforeEach(() => {
  replace.mockClear();
});
afterEach(() => {
  cleanup();
});

describe("UsersTable", () => {
  it("renders rows with the new column set", () => {
    const rows = [
      baseRow({ userId: "u1", email: "alice@x", providers: ["google"] }),
    ];
    render(
      <UsersTable
        rows={rows}
        total={1}
        page={1}
        pageCount={1}
        truncated={false}
        activeTab="exclude_anon"
        activeSort="createdAt"
        activeDir="desc"
        expandedUserId={null}
        expandedSummaries={[]}
        expandedAudit={[]}
      />,
    );
    expect(screen.getByText("alice@x")).toBeTruthy();
    expect(screen.getByText("google")).toBeTruthy();
    expect(screen.getByText(/Last sign-in/i)).toBeTruthy();
    expect(screen.getByText(/Last activity/i)).toBeTruthy();
  });

  it("clicking the active sort header flips dir asc", async () => {
    const user = userEvent.setup();
    render(
      <UsersTable
        rows={[baseRow({ userId: "u1" })]}
        total={1}
        page={1}
        pageCount={1}
        truncated={false}
        activeTab="exclude_anon"
        activeSort="createdAt"
        activeDir="desc"
        expandedUserId={null}
        expandedSummaries={[]}
        expandedAudit={[]}
      />,
    );

    await user.click(screen.getByText(/^Joined$/));
    // first click on the active column flips dir asc → URL gains dir=asc
    expect(replace).toHaveBeenCalledWith("/admin/users?dir=asc");
  });

  it("clicking a different sortable header sets sort=key with default desc", async () => {
    const user = userEvent.setup();
    render(
      <UsersTable
        rows={[baseRow({ userId: "u1" })]}
        total={1}
        page={1}
        pageCount={1}
        truncated={false}
        activeTab="exclude_anon"
        activeSort="createdAt"
        activeDir="desc"
        expandedUserId={null}
        expandedSummaries={[]}
        expandedAudit={[]}
      />,
    );

    await user.click(screen.getByText(/^Summaries$/));
    expect(replace).toHaveBeenCalledWith("/admin/users?sort=summaries");
  });

  it("Anonymous tab is highlighted when activeTab is anon_only", () => {
    render(
      <UsersTable
        rows={[]}
        total={0}
        page={1}
        pageCount={1}
        truncated={false}
        activeTab="anon_only"
        activeSort="createdAt"
        activeDir="desc"
        expandedUserId={null}
        expandedSummaries={[]}
        expandedAudit={[]}
      />,
    );
    const anon = screen.getByText("Anonymous");
    expect(anon.className).toContain("active");
  });

  it("expanded drilldown shows audit events and raw metadata", () => {
    const audit: AuditRow[] = [
      {
        id: "a1",
        createdAt: "2026-04-29T00:00:00Z",
        adminId: "admin-1",
        adminEmail: "alice@x",
        action: "view_transcript",
        resourceType: "user",
        resourceId: "u1",
        metadata: {},
      },
    ];
    const rows = [baseRow({ userId: "u1", appMetadata: { foo: "bar" } })];
    render(
      <UsersTable
        rows={rows}
        total={1}
        page={1}
        pageCount={1}
        truncated={false}
        activeTab="exclude_anon"
        activeSort="createdAt"
        activeDir="desc"
        expandedUserId="u1"
        expandedSummaries={[]}
        expandedAudit={audit}
      />,
    );
    expect(screen.getByText(/RECENT AUDIT EVENTS/)).toBeTruthy();
    expect(screen.getByText("view_transcript")).toBeTruthy();
    expect(screen.getByText(/RAW METADATA/)).toBeTruthy();
    // The JSON must appear in a <pre>
    const appMeta = screen.getByText(/"foo": "bar"/);
    expect(appMeta.tagName).toBe("PRE");
  });

  it("renders '(no email)' for anonymous-style rows", () => {
    render(
      <UsersTable
        rows={[baseRow({ userId: "u1", email: null, isAnonymous: true, status: "anonymous" })]}
        total={1}
        page={1}
        pageCount={1}
        truncated={false}
        activeTab="all"
        activeSort="createdAt"
        activeDir="desc"
        expandedUserId={null}
        expandedSummaries={[]}
        expandedAudit={[]}
      />,
    );
    expect(screen.getByText("(no email)")).toBeTruthy();
  });
});
