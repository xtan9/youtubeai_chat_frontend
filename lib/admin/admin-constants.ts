/**
 * Caps and tuning constants shared between server-only admin code and
 * client components. Keeping them in this standalone module prevents
 * client components from pulling server-only report implementations into
 * the client bundle.
 */

/** Hard cap on rows pulled from `summaries` for in-process aggregation. */
export const SUMMARIES_ROW_CAP = 50_000;

/** Hard cap on rows pulled from `user_video_history` for in-process aggregation. */
export const HISTORY_ROW_CAP = 100_000;

/** Cap on per-page row count returned by `loadAuditReport`. */
export const AUDIT_PAGE_SIZE_CAP = 200;

/** Cap on each page fetched by the User Accounts Directory loader. */
export const USERS_PAGE_SIZE_CAP = 100;

/** Hard cap on distinct Videos surfaced by `loadVideosReport`. */
export const VIDEOS_ROW_CAP = 25_000;

/** Cap on per-video user drilldown — read by the row-expansion banner. */
export const VIDEO_USERS_DRILLDOWN_CAP = 200;

/** Cap on per-page row count returned by `loadVideosReport`. */
export const VIDEOS_PAGE_SIZE_CAP = 50;
