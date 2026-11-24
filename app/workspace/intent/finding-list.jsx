import { useTranslations } from "next-intl";
import { ChevronRight, Quote } from "lucide-react";

function findingExcerpt(version) {
  const text = version.document.synthesis.judgment.text;
  return text.match(/^.+?[。！？]/u)?.[0] || text;
}

export function FindingList({ versions, show }) {
  const t = useTranslations("intent");
  function row(v) {
    return (
      <button className="finding-note" key={v.id} onClick={() => show(v.id)}>
        <Quote size={15} />
        <span>{findingExcerpt(v)}</span>
        <ChevronRight size={13} />
      </button>
    );
  }
  return (
    <section className="finding-list" aria-label={t("researchFindings")}>
      <h3>
        {t("researchFindings")} <small>{versions.length}</small>
      </h3>
      {versions.length ? (
        row(versions[0])
      ) : (
        <p className="finding-empty">
          {t("openAClaimInASourceToInvestigateIt")}{" "}
        </p>
      )}
      {versions.length > 1 && (
        <details>
          <summary>
            {t("other")} {versions.length - 1} {t("findings")}
          </summary>
          {versions.slice(1).map(row)}
        </details>
      )}
    </section>
  );
}
