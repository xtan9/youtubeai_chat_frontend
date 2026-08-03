import { Download, Filter, Search } from "lucide-react";
import { Btn } from "../_components/atoms";
import { requireAdminPage } from "../_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { loadUserAccountsReport } from "@/lib/admin/user-accounts-report";
import type { UserAccountsReportInput } from "@/lib/admin/report-types";
import { UsersTable } from "./_components/users-table";
import { parseTab, DEFAULT_TAB } from "./_components/filter";

const DEFAULT_SORT: UserAccountsReportInput["sort"] = "createdAt";
const DEFAULT_DIRECTION: UserAccountsReportInput["direction"] = "desc";

export const dynamic = "force-dynamic";

const KNOWN_SORT: ReadonlySet<UserAccountsReportInput["sort"]> = new Set([
  "email",
  "providers",
  "status",
  "emailVerified",
  "createdAt",
  "lastSignIn",
  "lastActivity",
  "summaries",
  "whisperPct",
]);

function parseSort(value: string | undefined): UserAccountsReportInput["sort"] {
  if (value && KNOWN_SORT.has(value as UserAccountsReportInput["sort"])) {
    return value as UserAccountsReportInput["sort"];
  }
  return DEFAULT_SORT;
}

function parseDirection(
  value: string | undefined,
): UserAccountsReportInput["direction"] {
  return value === "asc" ? "asc" : DEFAULT_DIRECTION;
}

function parsePage(value: string | undefined): number {
  const n = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

interface PageProps {
  searchParams: Promise<{
    sort?: string;
    dir?: string;
    tab?: string;
    page?: string;
    expanded?: string;
    q?: string;
  }>;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const principal = await requireAdminPage();
  const client = requireAdminClient(
    { email: principal.email },
    principal.allowlist,
  );
  const params = await searchParams;

  const sort = parseSort(params.sort);
  const direction = parseDirection(params.dir);
  const tab = parseTab(params.tab);
  const page = parsePage(params.page);
  const search = params.q?.trim() ? params.q.trim() : null;

  const result = await loadUserAccountsReport(client, {
    sort,
    direction,
    tab,
    search,
    page,
    expandedAccountId: params.expanded ?? null,
  });

  return (
    <div className="surface-anim">
      <div className="page-h">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-sub">
            {result.total.toLocaleString("en-US")} matching ·{" "}
            {result.activeOnPage} active on this page
            {result.truncated && (
              <span className="muted">
                {" "}
                · capped at 5,000 — sort/filter applied to first 5,000 only
              </span>
            )}
          </p>
        </div>
        <div className="row gap-8">
          <form
            method="get"
            className="search-input"
            action="/admin/users"
          >
            <Search size={13} />
            <input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Search email or user_id…"
            />
            {/* Preserve the active tab/sort across search submits. */}
            {tab !== DEFAULT_TAB && <input type="hidden" name="tab" value={tab} />}
            {sort !== DEFAULT_SORT && <input type="hidden" name="sort" value={sort} />}
            {direction !== DEFAULT_DIRECTION && (
              <input type="hidden" name="dir" value={direction} />
            )}
          </form>
          <Btn size="sm" kind="ghost" disabled>
            <Filter size={13} /> Filter
          </Btn>
          <Btn size="sm" disabled>
            <Download size={13} /> Export
          </Btn>
        </div>
      </div>

      <div className="page-body">
        <UsersTable
          report={result}
          activeTab={tab}
          activeSort={sort}
          activeDir={direction}
        />
      </div>
    </div>
  );
}
