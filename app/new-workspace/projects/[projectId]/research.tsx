import type { ResearchVersion } from "@/lib/projects/project-research-contract";

import { findingReferences } from "@/lib/video-space/claim-spaces";

const labels: Record<string, string> = {
  supported: "有支持",
  problematic: "有问题",
  open: "待研究",
  supports: "支持",
  challenges: "质疑",
  mixed: "结果不一致",
  unclear: "方向未定",
  strong: "强",
  moderate: "中等",
  weak: "弱",
  unassessed: "未评估",
  insufficient: "不足",
  high: "高",
  medium: "中",
  low: "低",
};
export function Finding({ version }: { version: ResearchVersion }) {
  const { document: d } = version,
    { judgment, assessment } = d.synthesis;
  const citations = findingReferences(d);
  return (
    <article className="vs-finding" data-translation-version={version.id}>
      <strong>目前的判断</strong>
      <p data-translation-block="0">{judgment.text}</p>
      <details>
        <summary>核查范围与判断依据</summary>
        {assessment && (
          <>
            <p>
              <b>观点判断</b> · {labels[assessment.category]}
            </p>
            <p>
              <b>证据强度</b> · {labels[assessment.direction]}，
              {labels[assessment.strength]}。<span data-translation-block="0">{assessment.strengthReason}</span>
            </p>
            <p>
              <b>判断把握</b> · {labels[assessment.confidence]}。
              <span data-translation-block="0">{assessment.confidenceReason}</span>
            </p>
          </>
        )}
        <small>
          核查范围 ·{" "}
          {d.evidence.filter((e) => e.kind === "publication_abstract").length}{" "}
          份文献摘要，{d.evidence.filter((e) => e.kind === "video").length}{" "}
          段视频原文
        </small>
        {d.warnings.map((w) => (
          <p key={w} data-translation-block="0">{w}</p>
        ))}
      </details>
      <details>
        <summary>调查发现与出处</summary>
        {d.synthesis.findings.map((f, i) => (
          <p key={i} data-translation-block="0">{f.text}</p>
        ))}
        <p data-translation-block="0">{d.synthesis.reasoning.text}</p>
        {d.synthesis.uncertainties.map((u) => (
          <p key={u} data-translation-block="0">{u}</p>
        ))}
        {d.evidence.map((e) => (
          <div key={e.id}>
            <a href={e.url} target="_blank" rel="noreferrer">
              <span data-translation-block="0">{e.title}</span> ↗
            </a>
            {[
              ...new Set(
                citations.filter((r) => r.id === e.id).map((r) => r.quote),
              ),
            ].map((q) => (
              <blockquote key={q} data-translation-block="0">{q}</blockquote>
            ))}
          </div>
        ))}
      </details>
    </article>
  );
}
