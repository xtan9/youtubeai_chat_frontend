// UTC-stable date formatting for blog post timestamps. Frontmatter
// dates are bare YYYY-MM-DD with no timezone; without forcing UTC,
// Node servers in non-UTC zones display the wrong day to users near
// the date boundary.

export function formatPostDate(iso: string, fmt: "short" | "long" = "short"): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: fmt === "long" ? "long" : "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
