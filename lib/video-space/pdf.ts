import { addReference, textReferences } from "./source-references";
import type { Resource } from "./contract";

export async function readPdf(file: File): Promise<Resource> {
  if (file.size > 25_000_000) throw Error("请选择小于 25 MB 的 PDF。");
  const resource: Resource = {
    id: crypto.randomUUID(),
    kind: "pdf",
    title: file.name,
    pages: [],
    coverage: "无法提取文字，文件可能加密或只有扫描图像。",
  };
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const task = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    disableFontFace: true,
    useWorkerFetch: false,
  });
  try {
    const doc = await task.promise;
    let budget = 60000;
    for (let i = 1; i <= Math.min(200, doc.numPages) && budget > 0; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((x) => ("str" in x ? x.str : ""))
        .join(" ")
        .trim()
        .slice(0, Math.min(16000, budget));
      for (const annotation of await page.getAnnotations()) {
        if (typeof annotation.url === "string")
          addReference(
            resource,
            annotation.url,
            annotation.titleObj?.str ?? annotation.url,
            "第 " + i + " 页",
          );
      }
      textReferences(resource, text, "第 " + i + " 页");
      if (text) resource.pages.push({ label: "第 " + i + " 页", text });
      budget -= text.length;
      page.cleanup();
    }
    if (resource.pages.length)
      resource.coverage =
        "已提取 " +
        resource.pages.length +
        " 页文字摘录 · 原文共 " +
        doc.numPages +
        " 页";
  } catch {
    /* A scanned or encrypted source remains in the library. */
  } finally {
    await task.destroy();
  }
  return resource;
}
