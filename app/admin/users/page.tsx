import { Download, Filter, Search } from "lucide-react";
import { Btn } from "../_components/atoms";
import { requireAdminPage } from "../_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import {
  listUsersWithStats,
  getUserSummaries,
  lastNDays,
} from "@/lib/admin/queries";
import { UsersTable } from "./_components/users-table";

const PAGE_SIZE = 25;

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    cursor?: string;
    expanded?: string;
    q?: string;
    filter?: string;
  }>;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const principal = await requireAdminPage();
  const client = requireAdminClient(
    { email: principal.email },
    principal.allowlist,
  );
  const params = await searchParams;

  const window = lastNDays(30);
  const { rows, nextCursor, totalApprox } = await listUsersWithStats(client, {
    pageSize: PAGE_SIZE,
    cursor: params.cursor ?? null,
    search: params.q ?? null,
    window,
  });

  const expandedUserId =
    params.expanded && rows.some((r) => r.userId === params.expanded)
      ? params.expanded
      : null;

  const expandedSummaries = expandedUserId
    ? await getUserSummaries(client, expandedUserId, 5)
    : [];

  return (
    <div className="surface-anim">
      <div className="page-h">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-sub">
            {totalApprox.toLocaleString("en-US")} total ·{" "}
            {rows.filter((r) => r.summaries > 0).length} active in last 30 days
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
          </form>
          <Btn size="sm" kind="ghost">
            <Filter size={13} /> Filter
          </Btn>
          <Btn size="sm">
            <Download size={13} /> Export
          </Btn>
        </div>
      </div>

      <div className="page-body">
        <UsersTable
          rows={rows}
          nextCursor={nextCursor}
          totalApprox={totalApprox}
          expandedUserId={expandedUserId}
          expandedSummaries={expandedSummaries}
        />
      </div>
    </div>
  );
}
