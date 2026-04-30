/**
 * Caps and tuning constants shared between server-only admin code and
 * client components. Lives outside `queries.ts` so client components can
 * import the runtime values without pulling in the `import "server-only"`
 * side-effect (which intentionally fails the build for any client
 * component that transitively touches `queries.ts`).
 *
 * Server code re-exports these from `queries.ts` so existing import
 * paths keep working — the canonical numeric source is here.
 */

/** Hard cap on rows pulled from `summaries` for in-process aggregation. */
export const SUMMARIES_ROW_CAP = 50_000;

/** Hard cap on rows pulled from `user_video_history` for in-process aggregation. */
export const HISTORY_ROW_CAP = 100_000;

/** Cap on per-page row count returned by `listAuditLog`. */
export const AUDIT_PAGE_SIZE_CAP = 200;

/** Cap on per-page row count returned by `listUsersWithStatsAndSort`. */
export const USERS_PAGE_SIZE_CAP = 100;

/** Hard cap on distinct videos surfaced by `listVideosWithStats`. */
export const VIDEOS_ROW_CAP = 25_000;

/** Cap on per-video user drilldown — read by the row-expansion banner. */
export const VIDEO_USERS_DRILLDOWN_CAP = 200;

/** Cap on per-page row count returned by `listVideosWithStats`. */
export const VIDEOS_PAGE_SIZE_CAP = 50;
