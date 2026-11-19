import type { ResearchVersion } from "@/lib/projects/project-research-contract";

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
  const citations = [
    judgment,
    ...d.synthesis.findings,
    d.synthesis.reasoning,
  ].flatMap((o) => o.references);
  return (
    <article className="vs-finding">
      <strong>目前的判断</strong>
      <p>{judgment.text}</p>
      <details>
        <summary>核查范围与判断依据</summary>
        {assessment && (
          <>
            <p>
              <b>观点判断</b> · {labels[assessment.category]}
            </p>
            <p>
              <b>证据强度</b> · {labels[assessment.direction]}，
              {labels[assessment.strength]}。{assessment.strengthReason}
            </p>
            <p>
              <b>判断把握</b> · {labels[assessment.confidence]}。
              {assessment.confidenceReason}
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
          <p key={w}>{w}</p>
        ))}
      </details>
      <details>
        <summary>调查发现与出处</summary>
        {d.synthesis.findings.map((f, i) => (
          <p key={i}>{f.text}</p>
        ))}
        <p>{d.synthesis.reasoning.text}</p>
        {d.synthesis.uncertainties.map((u) => (
          <p key={u}>{u}</p>
        ))}
        {d.evidence.map((e) => (
          <div key={e.id}>
            <a href={e.url} target="_blank" rel="noreferrer">
              {e.title} ↗
            </a>
            {[
              ...new Set(
                citations.filter((r) => r.id === e.id).map((r) => r.quote),
              ),
            ].map((q) => (
              <blockquote key={q}>{q}</blockquote>
            ))}
          </div>
        ))}
      </details>
    </article>
  );
}
