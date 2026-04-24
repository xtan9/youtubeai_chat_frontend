// Show the timer while streaming, and keep showing it after completion as
// long as at least one tick fired — so the final frozen value stays visible
// for real runs but cached/instant-complete responses (no tick ever fires)
// don't flash a "0.0s elapsed".
export function shouldShowElapsed(
  isComplete: boolean,
  elapsed: number
): boolean {
  return !isComplete || elapsed > 0;
}
