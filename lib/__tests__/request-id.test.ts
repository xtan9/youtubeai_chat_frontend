import { describe, expect, it } from "vitest";
import { REQUEST_ID_HEADER, resolveRequestId } from "../request-id";
import { redactLogFields } from "../observability";

describe("request IDs and log redaction", () => {
  it("accepts bounded opaque IDs and replaces malformed values", () => {
    expect(REQUEST_ID_HEADER).toBe("X-Request-ID");
    expect(resolveRequestId("req-148-example")).toBe("req-148-example");

    const generated = resolveRequestId("bad id");
    expect(generated).not.toBe("bad id");
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("drops secrets, URLs, and generated content from structured logs", () => {
    const fields = redactLogFields({
      requestId: "req-148-example",
      videoId: "dQw4w9WgXcQ",
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      Authorization: "Bearer current-secret",
      transcript: "Transcript content must never be logged",
      summary: "Summary content must never be logged",
      chat: "Video Chat content must never be logged",
    });

    expect(fields).toEqual({
      requestId: "req-148-example",
      videoId: "dQw4w9WgXcQ",
    });
  });
});
