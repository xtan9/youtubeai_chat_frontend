import type { AdminUserRow } from "@/lib/admin/queries";

/** Tab filter applied client-side to the current page of users.
 *
 * Note: this filter runs *after* server pagination, so the resulting
 * count is "matches on this page" — not "all matching users in the DB".
 * Surface that distinction in the UI copy. Pushing the filter to the
 * server is a future refinement; today the admin volume is small enough
 * that the page-local filter is acceptable. */
export function applyUsersFilter(
  rows: AdminUserRow[],
  filter: string,
): AdminUserRow[] {
  if (filter === "flagged") return rows.filter((r) => r.flagged);
  if (filter === "active") return rows.filter((r) => r.summaries > 0);
  return rows;
}
