import type {useTranslations} from "next-intl";

type Translate = ReturnType<typeof useTranslations<"savedProject">>;

// Match only formats written by the web, PDF and transcript importers. Keep
// the stored locator for matching quotes, resolving links and reopening claims.
export function sourceLabel(value: string, t: Translate): string {
  switch (value) {
    case "网页正文": return t("webBody");
    case "视频摘要": return t("videoSummary");
    case "字幕摘录": return t("captions");
    case "项目视频字幕摘录": return t("projectCaptions");
    case "字幕暂不可用": return t("noCaptions");
    case "无法读取网页正文": return t("noWebText");
    case "无法提取文字，文件可能加密或只有扫描图像。": return t("noPdfText");
  }
  const paragraph = /^段落 (\d+)$/.exec(value);
  if (paragraph) return t("paragraph", {n: paragraph[1]});
  const page = /^第 (\d+) 页$/.exec(value);
  if (page) return t("page", {n: page[1]});
  const web = /^已读取网页摘录 · (\d+) 段$/.exec(value);
  if (web) return t("webCoverage", {count: Number(web[1])});
  const pdf = /^已提取 (\d+) 页文字摘录 · 原文共 (\d+) 页$/.exec(value);
  if (pdf) return t("pdfCoverage", {count: pdf[1], total: pdf[2]});
  return value;
}

export function researchWarning(value: string, t: Translate): string {
  if (value === "No relevant project video passages were retrieved. This judgment uses external literature and does not establish what the project videos say.") return t("noVideoEvidence");
  const ready = /^(\d+) of (\d+) project videos had ready transcripts; unavailable videos were not assessed\.$/.exec(value);
  if (ready) return t("videoCoverage", {ready: ready[1], total: ready[2]});
  const search = /^Literature search (\d+) was unavailable; this update has partial search coverage\.$/.exec(value);
  if (search) return t("partialSearch", {n: search[1]});
  const ranking = /^Literature search (\d+) has partial ranking coverage; one discovery ranking was unavailable\.$/.exec(value);
  return ranking ? t("partialRanking", {n: ranking[1]}) : value;
}
