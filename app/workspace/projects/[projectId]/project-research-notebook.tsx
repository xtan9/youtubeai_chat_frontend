"use client";

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
              {source.kind === "video" ? "Video" : "Publication abstract"}:{" "}
              {source.title} (opens in a new tab)
            </span>
          </a>
        );
      })}
    </p>
  );
}
function Judgment({ document }: { document: ResearchDocument }) {
  const { synthesis, evidence } = document;
  return (
    <div className="space-y-5">
      <p className="text-body-sm text-text-secondary">
        Research question: {document.question}
      </p>
      <section
        aria-label="Current research judgment"
        className="space-y-2 border-l-4 border-accent-brand pl-4"
      >
        <h3 className="text-h4">Current judgment</h3>
        <Observation observation={synthesis.judgment} evidence={evidence} />
      </section>
      <section className="space-y-2">
        <h3 className="text-h4">What changed and why</h3>
        <p className="whitespace-pre-wrap break-words text-body-md">
          {synthesis.changes}
        </p>
      </section>
      <section className="space-y-2">
        <h3 className="text-h4">Analysis</h3>
        <p className="text-caption text-text-muted">
          AI interpretation of the evidence
        </p>
        <Observation observation={synthesis.reasoning} evidence={evidence} />
      </section>
      <details className="rounded-md border border-border-subtle p-3" open>
        <summary className="cursor-pointer font-medium">Key findings</summary>
        <ul className="mt-3 space-y-3">
          {synthesis.findings.map((finding, index) => (
            <li key={index}>
              <Observation observation={finding} evidence={evidence} />
            </li>
          ))}
        </ul>
      </details>
      <section className="space-y-2">
        <h3 className="text-h4">Still unresolved</h3>
        <ul className="list-disc space-y-1 pl-5">
          {synthesis.uncertainties.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="text-h4">Next research steps</h3>
        <ul className="list-disc space-y-1 pl-5">
          {synthesis.nextSteps.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      {document.warnings.map((warning) => (
        <p
          key={warning}
          role="status"
          className="text-body-sm text-text-secondary"
        >
          {warning}
        </p>
      ))}
      <details className="rounded-md border border-border-subtle p-3">
        <summary className="cursor-pointer font-medium">
          Evidence & searches ({evidence.length}{" "}
          {evidence.length === 1 ? "item" : "items"})
        </summary>
        <p className="my-3 text-body-sm text-text-secondary">
          Publication evidence comes from retrieved abstracts, not full papers.
          Video passages describe speaker claims. This is a provisional AI
          synthesis of selected evidence.
        </p>
        <ol className="space-y-3">
          {evidence.map((source, index) => (
            <li key={source.id} className="rounded-md bg-surface-sunken p-3">
              <details>
                <summary className="cursor-pointer break-words font-medium">
                  [{index + 1}]{" "}
                  {source.kind === "video"
                    ? "Video"
                    : `Publication abstract · ${source.year}`}{" "}
                  — {source.title}
                </summary>
                <p className="my-2 text-caption text-text-muted">
                  {source.authors} {source.publicationTypes.join(" · ")} ·
                  Retrieved {new Date(source.retrievedAt).toLocaleDateString()}
                </p>
                <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-body-sm">
                  {source.text}
                </blockquote>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-accent-brand underline"
                >
                  Open original source
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </details>
            </li>
          ))}
        </ol>
        <h4 className="mt-4 font-medium">Literature searches</h4>
        <ul className="mt-2 space-y-2">
          {document.searches.map((search, index) => (
            <li key={index} className="break-words text-body-sm">
              <strong>{search.query}</strong> · {search.results} abstracts
              retrieved<p>{search.purpose}</p>
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
          setError("Couldn’t load research history. Retry to continue safely.");
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
      setError("Couldn’t load older judgments. Please retry.");
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
            : "Research could not finish. Please retry.",
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
        "Couldn’t finish the update. Reload history before retrying to check whether it was saved.",
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
        <h2 id="research-notebook-title" className="text-h3">
          Project research
        </h2>
        <p className="text-body-sm text-text-secondary">
          Investigate a question, supplement your videos with scientific
          literature, and build a judgment that evolves with the evidence.
        </p>
        <p className="text-caption text-text-muted">
          Searches Europe PMC publication abstracts. Free includes one research
          update; Pro supports continued research.
        </p>
      </header>
      {loading && <p role="status">Loading research history…</p>}
      {!loading && !loadFailed && !latest && (
        <p className="text-body-sm text-text-secondary">
          Start with what you want to find out. We’ll compare your videos with
          external research and identify what still needs checking.
        </p>
      )}
      {selected && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={`${inputId}-versions`}>Research history</Label>
            <select
              id={`${inputId}-versions`}
              value={selected.id}
              onChange={(event) => setSelectedId(event.target.value)}
              className="min-w-0 max-w-full rounded-md border bg-surface-raised p-2 text-body-sm"
            >
              {versions.map((version, index) => (
                <option value={version.id} key={version.id}>
                  {index === 0 ? "Latest" : "Earlier judgment"} ·{" "}
                  {new Date(version.created_at).toLocaleString()}
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
                ? "Loading older judgments…"
                : "Load older judgments"}
            </Button>
          )}
          {selected.id !== latest?.id && (
            <p role="status">
              Viewing an earlier judgment. New research always builds on the
              latest version.
            </p>
          )}
          {selected.document.sourceSetRevision !== currentSourceSetRevision && (
            <p role="status">
              Project videos have changed since this judgment. Update the
              research to include the current sources.
            </p>
          )}
          <Judgment document={selected.document} />
        </>
      )}
      <form
        onSubmit={update}
        className="space-y-3 border-t border-border-subtle pt-4"
      >
        <Label htmlFor={inputId}>
          {latest ? "Continue your research" : "Research question"}
        </Label>
        <Textarea
          id={inputId}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={2000}
          placeholder="What do the videos claim, what does outside research show, and what should I conclude?"
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
              ? "Researching & updating…"
              : latest
                ? "Research & update judgment"
                : "Start research"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || loading || loadingOlder}
            onClick={() => {
              setLoading(true);
              setLoadKey((key) => key + 1);
            }}
          >
            Reload research history
          </Button>
        </div>
        {pending && (
          <p role="status" className="text-body-sm text-text-secondary">
            Retrieving video context, searching literature, and comparing
            evidence. This can take a few minutes. Your previous judgment stays
            available.
          </p>
        )}
        {error && (
          <p role="alert" className="text-body-sm text-state-error">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
