import {useTranslations} from "next-intl";
import type { ResearchVersion } from "@/lib/projects/project-research-contract";

import { findingReferences } from "@/lib/video-space/claim-spaces";

export function Finding({ version }: { version: ResearchVersion }) {
  const tr = useTranslations("ui");
  const { document: d } = version,
    { judgment, assessment } = d.synthesis;
  const citations = findingReferences(d);
  return (
    <article className="vs-finding" data-translation-version={version.id}>
      <strong>{tr("judgment")}</strong>
      <p data-translation-block="0">{judgment.text}</p>
      <details>
        <summary>{tr("reviewScope")}</summary>
        {assessment && (
          <>
            <p>
              <b>{tr("assessment")}</b> · {tr(assessment.category)}
            </p>
            <p>
              <b>{tr("strength")}</b> · {tr(assessment.direction)}，
              {tr(assessment.strength)}。<span data-translation-block="0">{assessment.strengthReason}</span>
            </p>
            <p>
              <b>{tr("confidence")}</b> · {tr(assessment.confidence)}。
              <span data-translation-block="0">{assessment.confidenceReason}</span>
            </p>
          </>
        )}
        <small>
          {tr("scope", {abstracts: d.evidence.filter(e => e.kind === "publication_abstract").length, videos: d.evidence.filter(e => e.kind === "video").length})}
        </small>
        {d.warnings.map((w) => (
          <p key={w} data-translation-block="0">{w}</p>
        ))}
      </details>
      <details>
        <summary>{tr("sourcesAndFindings")}</summary>
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
