import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { searchResearchLiterature, searchReferenceArticles } from "../research-literature";
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
  it("preserves statistical inequalities and all results between HTML headings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ resultList: { result: [{
      ...record,
      abstractText: '<h4>Results</h4>Cholesterol changed -13.8% vs -1.0%; P<0.001. Mortality hazard ratio 1.22, 95% confidence interval 1.14 to 1.32; P<0.001. Five trials (n=10,808): coronary death 1.13 (0.83 to 1.54), all-cause death 1.07 (0.90 to 1.27).<h4>Conclusions</h4>No evidence of mortality benefit; not proof of equivalence.',
    }] } })));
    const result = await searchResearchLiterature('"dietary fat" AND mortality', new AbortController().signal);
    expect(result.evidence[0].text).toBe(
      'Results Cholesterol changed -13.8% vs -1.0%; P<0.001. Mortality hazard ratio 1.22, 95% confidence interval 1.14 to 1.32; P<0.001. Five trials (n=10,808): coronary death 1.13 (0.83 to 1.54), all-cause death 1.07 (0.90 to 1.27). Conclusions No evidence of mortality benefit; not proof of equivalence.',
    );
  });
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
  it("keeps a publisher's original abstract when medical discovery is unavailable", async () => {
    const work = {
      DOI: "10.1234/household-oils", title: ["Household cooking in the twentieth century"],
      type: "book-chapter", issued: { "date-parts": [[2001]] },
      abstract: "<jats:p>The historical survey counted household purchases in two cities.</jats:p>",
    };
    vi.stubGlobal("fetch", vi.fn(async (url: URL) =>
      url.origin === "https://api.crossref.org"
        ? Response.json({ message: { items: [
            work, { ...work, DOI: "not-a-doi" }, { ...work, type: "posted-content" },
            { ...work, title: ["Retraction of another chapter"], DOI: "10.1234/retraction" },
          ] } })
        : new Response(null, { status: 503 })
    ));
    const result = await searchResearchLiterature("historical cooking oil", new AbortController().signal, true);
    expect(result.partial).toBe(true);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      url: "https://doi.org/10.1234/household-oils", year: "2001",
      text: "The historical survey counted household purchases in two cities.",
    });
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

it("binds discovered reference text to a specific revision and excludes disambiguation pages", async()=>{
  const excerpt="The instrument was invented in the seventeenth century.";
  vi.stubGlobal("fetch",vi.fn(async(url:URL)=>{
    expect(url.origin).toBe("https://en.wikipedia.org");
    expect(url.searchParams.get("gsrsearch")).toBe("instrument");
    return Response.json({query:{pages:[
      {pageid:2,revisions:[{revid:91}],title:"Ambiguous entry",index:1,extract:"Instrument may refer to:"},
      {pageid:3,revisions:[{revid:92}],title:"Instrument",index:2,extract:excerpt},
    ]}});
  }));
  const entries=await searchReferenceArticles("instrument",new AbortController().signal);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({url:"https://en.wikipedia.org/w/index.php?oldid=92",kind:"reference_article",text:excerpt});
});
