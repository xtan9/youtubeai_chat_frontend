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
    const refs = document.synthesis.judgment.references;
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
      const passageId = id + "-" + ref.id;
      const passage = {
        id: passageId,
        label:
          evidence.kind === "video"
            ? t("videoTranscript")
            : t("researchAbstract"),
        quote: ref.quote,
        anchor: "",
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
