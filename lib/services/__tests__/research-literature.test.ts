import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { searchResearchLiterature } from "../research-literature";
afterEach(() => vi.unstubAllGlobals());
const record = {
  id: "123",
  source: "MED",
  title: "Trial of dietary fats",
  pubYear: "2024",
  doi: "10.1/test",
  authorString: "A Author",
  abstractText:
    "<h4>Results</h4> No benefit &amp; no harm was established in this trial.",
  pubTypeList: { pubType: ["Randomized Controlled Trial"] },
};
describe("external literature HTTP boundary", () => {
  it("searches a fixed provider and returns traceable abstract evidence", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ resultList: { result: [record] } }));
    vi.stubGlobal("fetch", fetch);
    const result = await searchResearchLiterature(
      "dietary linoleic acid trials",
      new AbortController().signal,
    );
    expect(fetch.mock.calls[0][0].origin).toBe("https://www.ebi.ac.uk");
    expect(fetch.mock.calls[0][0].searchParams.get("resultType")).toBe("core");
    expect(result[0]).toMatchObject({
      kind: "publication_abstract",
      url: "https://europepmc.org/article/MED/123",
      text: "Results No benefit & no harm was established in this trial.",
      year: "2024",
    });
  });
  it("drops records without abstracts, preprints, and retracted records", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          resultList: {
            result: [
              { ...record, abstractText: "" },
              { ...record, source: "PPR" },
              { ...record, isRetracted: "Y" },
            ],
          },
        }),
      ),
    );
    expect(
      await searchResearchLiterature("fats", new AbortController().signal),
    ).toEqual([]);
  });
  it("does not treat provider failure as an empty search", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("private provider body", { status: 503 }),
        ),
    );
    await expect(
      searchResearchLiterature("fats", new AbortController().signal),
    ).rejects.toThrow("literature_provider_unavailable");
  });
});
