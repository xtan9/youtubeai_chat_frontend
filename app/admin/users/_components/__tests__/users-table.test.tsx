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
import type { UserAccountsReport } from "@/lib/admin/report-types";

type UserAccountRow = UserAccountsReport["rows"][number];
type UserAuditRow = NonNullable<UserAccountsReport["expanded"]>["audit"][number];

const baseRow = (over: Partial<UserAccountRow>): UserAccountRow => ({
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

function reportFor(
  rows: UserAccountRow[],
  over: Partial<UserAccountsReport> = {},
): UserAccountsReport {
  return {
    rows,
    total: rows.length,
    truncated: false,
    page: 1,
    pageCount: 1,
    activeOnPage: rows.filter((row) => row.summaries > 0).length,
    expanded: null,
    warnings: [],
    ...over,
  };
}

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
        report={reportFor(rows)}
        activeTab="exclude_anon"
        activeSort="createdAt"
        activeDir="desc"
      />,
    );
    expect(screen.getByText("alice@x")).toBeTruthy();
    expect(screen.getByText("google")).toBeTruthy();
    expect(screen.getByText(/Last sign-in/i)).toBeTruthy();
    expect(screen.getByText(/Last activity/i)).toBeTruthy();
  });

  it("renders report completeness warnings from the cohesive result", () => {
    render(
      <UsersTable
        report={reportFor([], {
          warnings: [
            {
              code: "USER_ACCOUNT_ACTIVITY_UNAVAILABLE",
              description: "Activity data is temporarily incomplete.",
            },
          ],
        })}
        activeTab="exclude_anon"
        activeSort="createdAt"
        activeDir="desc"
      />,
    );

    expect(screen.getByText("Report completeness")).toBeTruthy();
    expect(screen.getByText("Activity data is temporarily incomplete.")).toBeTruthy();
  });

  it("clicking the active sort header flips dir asc", async () => {
    const user = userEvent.setup();
    render(
      <UsersTable
        report={reportFor([baseRow({ userId: "u1" })])}
        activeTab="exclude_anon"
        activeSort="createdAt"
        activeDir="desc"
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
        report={reportFor([baseRow({ userId: "u1" })])}
        activeTab="exclude_anon"
        activeSort="createdAt"
        activeDir="desc"
      />,
    );

    await user.click(screen.getByText(/^Summaries$/));
    expect(replace).toHaveBeenCalledWith("/admin/users?sort=summaries");
  });

  it("Anonymous tab is highlighted when activeTab is anon_only", () => {
    render(
      <UsersTable
        report={reportFor([])}
        activeTab="anon_only"
        activeSort="createdAt"
        activeDir="desc"
      />,
    );
    const anon = screen.getByText("Anonymous");
    expect(anon.className).toContain("active");
  });

  it("expanded drilldown shows audit events and raw metadata", () => {
    const audit: UserAuditRow[] = [
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
        report={reportFor(rows, {
          expanded: { accountId: "u1", summaries: [], audit },
        })}
        activeTab="exclude_anon"
        activeSort="createdAt"
        activeDir="desc"
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
        report={reportFor([
          baseRow({ userId: "u1", email: null, isAnonymous: true, status: "anonymous" }),
        ])}
        activeTab="all"
        activeSort="createdAt"
        activeDir="desc"
      />,
    );
    expect(screen.getByText("(no email)")).toBeTruthy();
  });
});
