import { findingReferences } from "@/lib/video-space/claim-spaces";

export function getFormats(t) {
  return {
    research: {
      label: t("understandItForMyself"),
      kind: t("researchNotes"),
      style: "question",
      icon: "notes",
    },
    video: {
      label: t("makeAYouTubeVideo"),
      kind: t("videoScript"),
      style: "script",
      icon: "play",
    },
    blog: {
      label: t("writeABlogPost"),
      kind: t("blogArticle"),
      style: "blog",
      icon: "page",
    },
    book: {
      label: t("writeABook"),
      kind: t("bookPlan"),
      style: "book",
      icon: "book",
    },
    explore: {
      label: t("iHavenTDecided"),
      kind: t("topicExploration"),
      style: "explore",
      icon: "compass",
    },
  };
}
export function answerId(question) {
  return question.versionId || question.id;
}
export function questionPassages(question) {
  return question.passages || [];
}

// The manuscript carries the immutable research version ID, even after a question is renamed or deleted.
export function researchRecords(versions, t) {
  const runs = {};
  const sources = new Map();
  for (const version of versions) {
    const { document, id } = version;
    const context = document.space;
    const refs = context?.questionId
      ? document.synthesis.judgment.references
      : findingReferences(document);
    const seen = new Map();
    const passages = [];
    for (const ref of refs) {
      const evidence = document.evidence.find((item) => item.id === ref.id);
      if (!evidence) continue;
      const source = sources.get(evidence.url) || {
        id: evidence.id,
        title: evidence.title,
        url: evidence.url,
        credit: [evidence.authors, evidence.year].filter(Boolean).join(" · "),
        passages: [],
      };
      sources.set(evidence.url, source);
      const quotes = seen.get(ref.id) || new Set();
      if (quotes.has(ref.quote)) continue;
      const passageId =
        id + "-" + ref.id + (quotes.size ? "-" + quotes.size : "");
      quotes.add(ref.quote);
      seen.set(ref.id, quotes);
      const passage = {
        id: passageId,
        label:
          evidence.kind === "video"
            ? t("videoTranscript")
            : t("researchAbstract"),
        quote: ref.quote,
        anchor:
          evidence.kind === "video"
            ? ""
            : "#:~:text=" +
              encodeURIComponent(ref.quote.trim().slice(0, 160)).replace(
                /-/g,
                "%2D",
              ),
        uses: [{ id, title: document.question }],
      };
      source.passages.push(passage);
      passages.push({ source, passage });
    }
    if (context?.questionId)
      runs[id] = {
        context: context.background || [],
        question: {
          id: context.questionId,
          title: document.question,
          versionId: id,
          answer: document.synthesis.judgment.text,
          references: passages.map((p) => p.passage.id),
          passages,
        },
      };
  }
  return { runs, sources: [...sources.values()] };
}
