import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "X-Request-ID";

// Caller-provided IDs are accepted only when they are short, opaque, and
// header-safe. Anything else is replaced so a request ID cannot carry a user
// ID, Video URL, Transcript, or other content into logs.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$/;

export function resolveRequestId(candidate: string | null | undefined): string {
  return candidate && REQUEST_ID_PATTERN.test(candidate)
    ? candidate
    : randomUUID();
}
