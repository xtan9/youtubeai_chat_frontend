import type { UsersTab } from "@/lib/admin/queries";

export const DEFAULT_TAB: UsersTab = "exclude_anon";

export const TABS: ReadonlyArray<{ key: UsersTab; label: string }> = [
  { key: "exclude_anon", label: "Accounts" },
  { key: "active", label: "Active" },
  { key: "flagged", label: "Flagged" },
  { key: "anon_only", label: "Anonymous" },
  { key: "all", label: "All" },
];

const KNOWN: ReadonlySet<UsersTab> = new Set(TABS.map((t) => t.key));

export function parseTab(value: string | null | undefined): UsersTab {
  if (value && (KNOWN as Set<string>).has(value)) {
    return value as UsersTab;
  }
  return DEFAULT_TAB;
}
