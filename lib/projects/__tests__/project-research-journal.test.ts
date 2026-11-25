import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { loadResearchVersions } from "../project-research-journal";

vi.mock("server-only", () => ({}));

it("fetches a section's latest matching finding even if newer investigations fill the recent history", async () => {
  const requests: URL[] = [];
  const client = createClient("https://fixture.example", "fixture-key", {
    global: { fetch: async input => {
      requests.push(new URL(String(input)));
      return Response.json([]);
    } },
  });
  const id = crypto.randomUUID(), revision = crypto.randomUUID();
  for (const questionRevision of [undefined, revision]) {
    await loadResearchVersions(client, "my-project", undefined, {
      id, title: "Which source, and why?", revision: questionRevision,
    });
  }
  for (const {searchParams} of requests) {
    expect(searchParams.get("project_id")).toBe("eq.my-project");
    expect(searchParams.get("state")).toBe("eq.completed");
    expect(searchParams.get("document->space->>questionId")).toBe("eq." + id);
    expect(searchParams.get("document->>question")).toBe("eq.Which source, and why?");
    expect(searchParams.get("limit")).toBe("1");
    expect(searchParams.get("order")).toBe("completed_at.desc,id.desc");
  }
  expect(requests.map(r => r.searchParams.get("document->space->>questionRevision"))).toEqual(["is.null", "eq." + revision]);
});
