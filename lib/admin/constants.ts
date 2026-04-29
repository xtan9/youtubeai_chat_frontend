/** Whisper share above this percent flips a user/account to "flagged".
 *
 * The threshold is an organizational policy lever (whisper is the cost
 * lever), not a domain truth — single source so server queries and client
 * UI components never drift on the same value. */
export const WHISPER_FLAG_THRESHOLD = 30;
