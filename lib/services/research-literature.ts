import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ResearchEvidenceSchema,
  type ResearchEvidence,
} from "@/lib/projects/project-research-contract";

export function researchEvidenceId(kind: "V" | "E", identity: string) {
  return (
    kind + createHash("sha256").update(identity).digest("hex").slice(0, 16)
  );
}
function plainText(value: string) {
  return value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/giu, (_, code: string) => {
      const point =
        code[0].toLowerCase() === "x"
          ? parseInt(code.slice(1), 16)
          : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    })
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/gu,
      (entity) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&nbsp;": " ",
        })[entity]!,
    )
    .replace(/\s+/gu, " ")
    .trim();
}
const RecordSchema = z.object({
  id: z.string().regex(/^(?:[0-9]+|PMC[0-9]+)$/u),
  source: z.enum(["MED", "PMC"]),
  title: z.string(),
  abstractText: z.string().min(12),
  pubYear: z.string().regex(/^\d{4}$/u),
  doi: z.string().optional(),
  authorString: z.string().optional(),
  isRetracted: z.string().optional(),
  pubTypeList: z.object({ pubType: z.array(z.string()) }).optional(),
});

/** Fixed public endpoint: never fetch arbitrary model- or user-provided URLs. */
export async function searchResearchLiterature(
  query: string,
  callerSignal: AbortSignal,
): Promise<ResearchEvidence[]> {
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(15_000)]);
  // Relevance in Europe PMC favors recent records. Also discover established
  // work by citation count; neither ranking is a measure of study quality.
  const rankings = await Promise.all(
    ["score desc", "CITED desc"].map((sort) =>
      searchRankedLiterature(query, sort, signal),
    ),
  );
  const selected = new Map<string, ResearchEvidence>();
  for (let index = 0; index < 5; index++)
    for (const ranking of rankings) {
      const item = ranking[index];
      if (item && selected.size < 5) selected.set(item.originId, item);
    }
  return [...selected.values()];
}

async function searchRankedLiterature(
  query: string,
  sort: string,
  signal: AbortSignal,
): Promise<ResearchEvidence[]> {
  const url = new URL(
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
  );
  const today = new Date().toISOString().slice(0, 10);
  url.search = new URLSearchParams({
    query: `TITLE_ABS:(${query}) AND HAS_ABSTRACT:y AND FIRST_PDATE:[1900-01-01 TO ${today}]`,
    resultType: "core",
    format: "json",
    pageSize: "5",
    sort,
  }).toString();
  const response = await fetch(url, {
    signal,
    redirect: "error",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("literature_provider_unavailable");
  }
  // Bound provider data before parsing. A malformed/oversized response is a failed search.
  if (!response.body) throw new Error("literature_provider_unavailable");
  let raw = "";
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    raw += decoder.decode(chunk, { stream: true });
    if (raw.length > 500_000) {
      throw new Error("literature_response_too_large");
    }
  }
  const payload = z
    .object({ resultList: z.object({ result: z.array(z.unknown()) }) })
    .parse(JSON.parse(raw));
  const retrievedAt = new Date().toISOString();
  const seen = new Set<string>();
  return payload.resultList.result.flatMap((candidate) => {
    const parsed = RecordSchema.safeParse(candidate);
    if (!parsed.success) return [];
    const row = parsed.data;
    if (
      row.isRetracted === "Y" ||
      row.pubTypeList?.pubType.some((type) =>
        /retract|preprint|erratum|correction/iu.test(type),
      ) ||
      Number(row.pubYear) > new Date().getUTCFullYear()
    )
      return [];
    const originId = row.doi?.toLowerCase() ?? `${row.source}:${row.id}`;
    if (seen.has(originId)) return [];
    seen.add(originId);
    const text = plainText(row.abstractText);
    // Keep complete abstracts. Skip oversized records instead of silently cutting qualifications.
    const evidence = ResearchEvidenceSchema.safeParse({
      id: researchEvidenceId("E", originId),
      kind: "publication_abstract",
      originId,
      title: plainText(row.title),
      url: `https://europepmc.org/article/${row.source}/${row.id}`,
      text,
      retrievedAt,
      year: row.pubYear,
      authors: row.authorString ?? null,
      publicationTypes: row.pubTypeList?.pubType ?? [],
    });
    return evidence.success ? [evidence.data] : [];
  });
}
