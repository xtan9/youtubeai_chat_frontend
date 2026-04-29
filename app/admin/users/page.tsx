import { Download, Filter, Search } from "lucide-react";
import { Btn } from "../_components/atoms";
import { requireAdminPage } from "../_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import {
  listUsersWithStatsAndSort,
  getUserSummaries,
  getUserAuditEvents,
  lastNDays,
  type SortKey,
  type SortDir,
} from "@/lib/admin/queries";
import { UsersTable } from "./_components/users-table";
import { parseTab, DEFAULT_TAB } from "./_components/filter";

const PAGE_SIZE = 25;
const DEFAULT_SORT: SortKey = "createdAt";
const DEFAULT_DIR: SortDir = "desc";
const DRILLDOWN_SUMMARY_LIMIT = 25;
const DRILLDOWN_AUDIT_LIMIT = 10;

export const dynamic = "force-dynamic";

const KNOWN_SORT: ReadonlySet<SortKey> = new Set([
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

function parseSort(value: string | undefined): SortKey {
  if (value && (KNOWN_SORT as Set<string>).has(value)) return value as SortKey;
  return DEFAULT_SORT;
}

function parseDir(value: string | undefined): SortDir {
  return value === "asc" ? "asc" : DEFAULT_DIR;
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
  const dir = parseDir(params.dir);
  const tab = parseTab(params.tab);
  const page = parsePage(params.page);
  const search = params.q?.trim() ? params.q.trim() : null;

  const window = lastNDays(30);
  const result = await listUsersWithStatsAndSort(client, {
    sort,
    dir,
    tab,
    search,
    page,
    pageSize: PAGE_SIZE,
    window,
  });

  const expandedUserId =
    params.expanded && result.rows.some((r) => r.userId === params.expanded)
      ? params.expanded
      : null;

  const [expandedSummaries, expandedAudit] = expandedUserId
    ? await Promise.all([
        getUserSummaries(client, expandedUserId, DRILLDOWN_SUMMARY_LIMIT),
        getUserAuditEvents(client, expandedUserId, DRILLDOWN_AUDIT_LIMIT),
      ])
    : [[], []];

  const activeOnPage = result.rows.filter((r) => r.summaries > 0).length;

  return (
    <div className="surface-anim">
      <div className="page-h">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-sub">
            {result.total.toLocaleString("en-US")} matching ·{" "}
            {activeOnPage} active on this page
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
            {dir !== DEFAULT_DIR && <input type="hidden" name="dir" value={dir} />}
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
          rows={result.rows}
          total={result.total}
          page={result.page}
          pageCount={result.pageCount}
          truncated={result.truncated}
          activeTab={tab}
          activeSort={sort}
          activeDir={dir}
          expandedUserId={expandedUserId}
          expandedSummaries={expandedSummaries}
          expandedAudit={expandedAudit}
        />
      </div>
    </div>
  );
}
