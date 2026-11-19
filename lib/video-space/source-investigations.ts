import type { ResearchVersion } from "@/lib/projects/project-research-contract";

export type InvestigationSource = {
  id: string;
  title: string;
  youtubeVideoId?: string | null;
};

export function investigationsForSource(
  versions: ResearchVersion[],
  source: InvestigationSource,
) {
  return versions.filter(({ document }) => {
    if (document.space?.origin?.id === source.id) return true;
    if (!source.youtubeVideoId) return false;

    const { judgment, findings, reasoning } = document.synthesis;
    const citedIds = new Set(
      [judgment, ...findings, reasoning].flatMap((item) =>
        item.references.map((ref) => ref.id),
      ),
    );
    return document.evidence.some(
      (item) =>
        item.kind === "video" &&
        citedIds.has(item.id) &&
        new URL(item.url).searchParams.get("v") === source.youtubeVideoId,
    );
  });
}
