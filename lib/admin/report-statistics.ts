/** Nearest-rank percentile over finite measurements; missing values are omitted. */
export function measurementPercentile(
  values: readonly (number | null | undefined)[],
  percentile: number,
): number | null {
  const sorted = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentile) - 1),
  );
  return sorted[index];
}
