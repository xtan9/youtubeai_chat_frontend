"use client";

import {projectNotice} from "@/i18n/project-notice";
import {researchWarning} from "@/i18n/saved-project-labels";
import {useLocale, useTranslations} from "next-intl";
import { useEffect, useId, useState, type FormEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ResearchVersionSchema,
  type ResearchDocument,
  type ResearchEvidence,
  type ResearchSynthesis,
  type ResearchVersion,
} from "@/lib/projects/project-research-contract";

const VersionsSchema = z.object({
  versions: z.array(ResearchVersionSchema).max(10),
  nextCursor: z.uuid().nullable().optional().default(null),
});
function Observation({
  observation,
  evidence,
}: {
  observation: ResearchSynthesis["judgment"];
  evidence: ResearchEvidence[];
}) {
  const t = useTranslations("project");
  return (
    <p className="break-words text-body-md leading-relaxed text-text-primary">
      {observation.text}{" "}
      {observation.references.map((reference) => {
        const source = evidence.find((item) => item.id === reference.id)!;
        return (
          <a
            key={reference.id}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${source.title} — ${reference.quote}`}
            className="mr-1 inline-block text-accent-brand underline"
          >
            [{evidence.indexOf(source) + 1}]
            <span className="sr-only">
              {" "}
              {source.kind === "video" ? t("video") : t("publicationAbstract")}:{" "}
              {source.title} {t("opensInANewTab")}</span>
          </a>
        );
      })}
    </p>
  );
}
function Judgment({ document }: { document: ResearchDocument }) {
  const locale = useLocale();
  const t = useTranslations("project");
  const savedLabel = useTranslations("savedProject");

  const { synthesis, evidence } = document;
  return (
    <div className="space-y-5">
      <p className="text-body-sm text-text-secondary">{t("researchQuestion")} {document.question}
      </p>
      <section
        aria-label={t("currentResearchJudgment")}
        className="space-y-2 border-l-4 border-accent-brand pl-4"
      >
        <h3 className="text-h4">{t("currentJudgment")}</h3>
        <Observation observation={synthesis.judgment} evidence={evidence} />
      </section>
      <section className="space-y-2">
        <h3 className="text-h4">{t("whatChangedAndWhy")}</h3>
        <p className="whitespace-pre-wrap break-words text-body-md">
          {synthesis.changes}
        </p>
      </section>
      <section className="space-y-2">
        <h3 className="text-h4">{t("analysis")}</h3>
        <p className="text-caption text-text-muted">{t("aiInterpretationOfTheEvidence")}</p>
        <Observation observation={synthesis.reasoning} evidence={evidence} />
      </section>
      <details className="rounded-md border border-border-subtle p-3" open>
        <summary className="cursor-pointer font-medium">{t("keyFindings")}</summary>
        <ul className="mt-3 space-y-3">
          {synthesis.findings.map((finding, index) => (
            <li key={index}>
              <Observation observation={finding} evidence={evidence} />
            </li>
          ))}
        </ul>
      </details>
      <section className="space-y-2">
        <h3 className="text-h4">{t("stillUnresolved")}</h3>
        <ul className="list-disc space-y-1 pl-5">
          {synthesis.uncertainties.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="text-h4">{t("nextResearchSteps")}</h3>
        <ul className="list-disc space-y-1 pl-5">
          {synthesis.nextSteps.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      {document.warnings.map((warning) => (
        <p
          key={researchWarning(warning, savedLabel)}
          role="status"
          className="text-body-sm text-text-secondary"
        >
          {researchWarning(warning, savedLabel)}
        </p>
      ))}
      <details className="rounded-md border border-border-subtle p-3">
        <summary className="cursor-pointer font-medium">{t("evidenceCount", {count: evidence.length})}
        </summary>
        <p className="my-3 text-body-sm text-text-secondary">{t("publicationEvidenceComesFromRetrievedAbstractsNotFull")}</p>
        <ol className="space-y-3">
          {evidence.map((source, index) => (
            <li key={source.id} className="rounded-md bg-surface-sunken p-3">
              <details>
                <summary className="cursor-pointer break-words font-medium">
                  [{index + 1}]{" "}
                  {source.kind === "video"
                    ? t("video")
                    : t("publicationAbstractLabel", {value1: source.year ?? "—"})}{" "}
                  — {source.title}
                </summary>
                <p className="my-2 text-caption text-text-muted">
                  {source.authors} {source.publicationTypes.join(" · ")} {t("retrieved")} {new Date(source.retrievedAt).toLocaleDateString(locale)}
                </p>
                <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-body-sm">
                  {source.text}
                </blockquote>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-accent-brand underline"
                >{t("openOriginalSource")}<span className="sr-only"> {t("opensInANewTab")}</span>
                </a>
              </details>
            </li>
          ))}
        </ol>
        <h4 className="mt-4 font-medium">{t("literatureSearches")}</h4>
        <ul className="mt-2 space-y-2">
          {document.searches.map((search, index) => (
            <li key={index} className="break-words text-body-sm">
              <strong>{search.query}</strong> · {search.results} {t("abstractsRetrieved")}<p>{search.purpose}</p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
export function ProjectResearchNotebook({
  projectId,
  currentSourceSetRevision,
}: {
  projectId: string;
  currentSourceSetRevision: number;
}) {
  const locale = useLocale();
  const t = useTranslations("project");
  const inputId = useId();
  const [versions, setVersions] = useState<ResearchVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const latest = versions[0];
  const selected =
    versions.find((version) => version.id === selectedId) ?? latest;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/projects/${projectId}/research`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const payload = VersionsSchema.parse(await response.json());
        setVersions(payload.versions);
        setHistoryCursor(payload.nextCursor);
        setLoadFailed(false);
        setError(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadFailed(true);
          setError("couldnTLoadResearchHistoryRetryToContinue");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, loadKey]);
  async function loadOlder() {
    if (!historyCursor || loading || loadingOlder || pending) return;
    setLoadingOlder(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/research?before=${encodeURIComponent(historyCursor)}`,
        { signal: AbortSignal.timeout(20_000) },
      );
      if (!response.ok) throw new Error("unavailable");
      const payload = VersionsSchema.parse(await response.json());
      setVersions((current) => [
        ...current,
        ...payload.versions.filter(
          (item) => !current.some((known) => known.id === item.id),
        ),
      ]);
      setHistoryCursor(payload.nextCursor);
    } catch {
      setError("couldnTLoadOlderJudgmentsPleaseRetry");
    } finally {
      setLoadingOlder(false);
    }
  }
  async function update(event: FormEvent) {
    event.preventDefault();
    if (
      pending ||
      loading ||
      loadingOlder ||
      loadFailed ||
      question.trim().length < 3
    )
      return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/research`, {
        method: "POST",
        signal: AbortSignal.timeout(285_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          baseVersionId: latest?.id ?? null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(
          typeof payload.message === "string"
            ? payload.message
            : "researchCouldNotFinishPleaseRetry",
        );
        return;
      }
      const parsed = VersionsSchema.parse(payload);
      setVersions(parsed.versions);
      setHistoryCursor(parsed.nextCursor);
      setSelectedId(null);
      setQuestion("");
    } catch {
      setError(
        "couldnTFinishTheUpdateReloadHistoryBefore",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      aria-labelledby="research-notebook-title"
      className="mb-5 space-y-5 rounded-xl border border-border-subtle bg-surface-raised p-4 sm:p-6"
    >
      <header className="space-y-2">
        <h2 id="research-notebook-title" className="text-h3">{t("projectResearch")}</h2>
        <p className="text-body-sm text-text-secondary">{t("investigateAQuestionSupplementYourVideosWithScientific")}</p>
        <p className="text-caption text-text-muted">{t("searchesEuropePmcTitlesAndAbstractsUsingRelevance")}</p>
      </header>
      {loading && <p role="status">{t("loadingResearchHistory")}</p>}
      {!loading && !loadFailed && !latest && (
        <p className="text-body-sm text-text-secondary">{t("startWithWhatYouWantToFindOut")}</p>
      )}
      {selected && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={`${inputId}-versions`}>{t("researchHistory")}</Label>
            <select
              id={`${inputId}-versions`}
              value={selected.id}
              onChange={(event) => setSelectedId(event.target.value)}
              className="min-w-0 max-w-full rounded-md border bg-surface-raised p-2 text-body-sm"
            >
              {versions.map((version, index) => (
                <option value={version.id} key={version.id}>
                  {index === 0 ? t("latest") : t("earlierJudgment")} ·{" "}
                  {new Date(version.created_at).toLocaleString(locale)}
                </option>
              ))}
            </select>
          </div>
          {historyCursor && (
            <Button
              type="button"
              variant="outline"
              disabled={loading || loadingOlder || pending}
              onClick={loadOlder}
            >
              {loadingOlder
                ? t("loadingOlderJudgments")
                : t("loadOlderJudgments")}
            </Button>
          )}
          {selected.id !== latest?.id && (
            <p role="status">{t("viewingAnEarlierJudgmentNewResearchAlwaysBuilds")}</p>
          )}
          {selected.document.sourceSetRevision !== currentSourceSetRevision && (
            <p role="status">{t("projectVideosHaveChangedSinceThisJudgmentUpdate")}</p>
          )}
          <Judgment document={selected.document} />
        </>
      )}
      <form
        onSubmit={update}
        className="space-y-3 border-t border-border-subtle pt-4"
      >
        <Label htmlFor={inputId}>
          {latest ? t("continueYourResearch") : t("researchQuestionLabel")}
        </Label>
        <Textarea
          id={inputId}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={2000}
          placeholder={t("whatDoTheVideosClaimWhatDoesOutside")}
          disabled={pending}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={
              loading ||
              loadingOlder ||
              loadFailed ||
              pending ||
              question.trim().length < 3
            }
          >
            {pending
              ? t("researchingUpdating")
              : latest
                ? t("researchUpdateJudgment")
                : t("startResearch")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || loading || loadingOlder}
            onClick={() => {
              setLoading(true);
              setLoadKey((key) => key + 1);
            }}
          >{t("reloadResearchHistory")}</Button>
        </div>
        {pending && (
          <p role="status" className="text-body-sm text-text-secondary">{t("retrievingVideoContextSearchingLiteratureAndComparingEvidence")}</p>
        )}
        {error && (
          <p role="alert" className="text-body-sm text-state-error">
            {projectNotice(t, error)}
          </p>
        )}
      </form>
    </section>
  );
}
