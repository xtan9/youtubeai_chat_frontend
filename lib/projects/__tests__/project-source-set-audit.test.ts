import { describe, expect, it } from "vitest";

import { ProjectSourceSetEventSchema } from "../project-source-set-audit";

describe("Project Source Set audit contract", () => {
  it("accepts an immutable membership transition without content fields", () => {
    const result = ProjectSourceSetEventSchema.safeParse({
      eventId: "a0000000-0000-4000-8000-000000000001",
      projectId: "b0000000-0000-4000-8000-000000000002",
      revision: 4,
      kind: "added",
      videoId: "c0000000-0000-4000-8000-000000000003",
      videoTitle: "Research source",
      fromPosition: null,
      toPosition: 2,
      fromStatus: null,
      toStatus: "ready",
      createdAt: "2026-08-09T13:00:00.000Z",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("url");
      expect(result.data).not.toHaveProperty("query");
      expect(result.data).not.toHaveProperty("content");
    }
  });
});
