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
      .mockImplementation(() =>
        Response.json({ resultList: { result: [record] } }),
      );
    vi.stubGlobal("fetch", fetch);
    const result = await searchResearchLiterature(
      "dietary linoleic acid trials",
      new AbortController().signal,
    );
    expect(fetch.mock.calls[0][0].origin).toBe("https://www.ebi.ac.uk");
    expect(fetch.mock.calls[0][0].searchParams.get("resultType")).toBe("core");
    expect(fetch.mock.calls[0][0].searchParams.get("query")).toMatch(
      /^TITLE_ABS:\(dietary linoleic acid trials\) AND HAS_ABSTRACT:y/u,
    );
    expect(
      fetch.mock.calls.map(([url]) => url.searchParams.get("sort")),
    ).toEqual(["score desc", "CITED desc"]);
    expect(result.evidence).toHaveLength(1);
    expect(result.partial).toBe(false);
    expect(result.evidence[0]).toMatchObject({
      kind: "publication_abstract",
      url: "https://europepmc.org/article/MED/123",
      text: "Results No benefit & no harm was established in this trial.",
      year: "2024",
    });
  });
  it("drops records without abstracts, preprints, and retracted records", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Response.json({
          resultList: {
            result: [
              { ...record, abstractText: "" },
              { ...record, source: "PPR" },
              { ...record, isRetracted: "Y" },
              { ...record, pubTypeList: { pubType: ["Published Erratum"] } },
            ],
          },
        }),
      ),
    );
    expect(
      await searchResearchLiterature("fats", new AbortController().signal),
    ).toEqual({ evidence: [], partial: false });
  });
  it("interleaves established and relevance-ranked publications without duplicate votes", async () => {
    const paper = (id: number, year: string) => ({
      ...record,
      id: String(id),
      doi: `10.1/${id}`,
      pubYear: year,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) =>
        Response.json({
          resultList: {
            result:
              url.searchParams.get("sort") === "score desc"
                ? [
                    paper(1, "2025"), paper(2, "2024"),
                    paper(3, "2023"), paper(4, "2022"),
                  ]
                : [
                    paper(10, "2013"), paper(1, "2025"),
                    paper(11, "2016"), paper(12, "2000"),
                  ],
          },
        }),
      ),
    );
    const result = await searchResearchLiterature(
      '"dietary fat" AND mortality',
      new AbortController().signal,
    );
    expect(result.evidence.map((item) => item.originId)).toEqual([
      "10.1/1", "10.1/10", "10.1/2", "10.1/3", "10.1/11",
    ]);
  });
  it("preserves healthy ranking evidence and reports partial coverage when the other fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) =>
      url.searchParams.get("sort") === "CITED desc"
        ? new Response("unavailable", { status: 503 })
        : Response.json({ resultList: { result: [record] } }),
    ));
    const result = await searchResearchLiterature("dietary fats", new AbortController().signal);
    expect(result.evidence).toHaveLength(1);
    expect(result.partial).toBe(true);
  });
  it("does not treat provider failure as an empty search", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          new Response("private provider body", { status: 503 }),
        ),
    );
    await expect(
      searchResearchLiterature("fats", new AbortController().signal),
    ).rejects.toThrow("literature_provider_unavailable");
  });
});
