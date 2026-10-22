"use client";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { type ProjectArtifact } from "@/lib/projects/project-artifact-contract";
import { parseProjectCitations } from "@/lib/projects/project-grounded-citations";
import { type ProjectArtifactPanelDefinition } from "./project-artifact-panel";

function generatedLabel(artifact: ProjectArtifact) {
  const timestamp = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(artifact.generationMetadata.generatedAt));
  return `${timestamp} UTC`;
}

export function ArtifactProvenance({
  artifact,
  title,
}: {
  artifact: ProjectArtifact;
  title: ProjectArtifactPanelDefinition["title"];
}) {
  return (
    <div
      aria-label={`${title} provenance`}
      className="border-l-4 border-accent-brand bg-surface-sunken px-4 py-3"
    >
      <dl className="grid grid-cols-1 gap-3 text-body-sm sm:grid-cols-3">
        <div>
          <dt className="text-caption text-text-muted">Evidence boundary</dt>
          <dd className="font-semibold text-text-primary">
            Source Set revision {artifact.sourceSetRevision}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">Evidence Snapshot</dt>
          <dd className="font-semibold text-text-primary">
            {artifact.evidenceSnapshot.passages.length}{" "}
            {artifact.evidenceSnapshot.passages.length === 1
              ? "passage"
              : "passages"}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-muted">Generated</dt>
          <dd className="font-semibold text-text-primary">
            {generatedLabel(artifact)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function ArtifactMarkdown({
  artifact,
  buildMarkdown,
}: {
  artifact: ProjectArtifact;
  buildMarkdown: ProjectArtifactPanelDefinition["buildMarkdown"];
}) {
  const markdown = useMemo(
    () => buildMarkdown(artifact.content, artifact.sourceManifest),
    [artifact.content, artifact.sourceManifest, buildMarkdown],
  );
  const citationLinks = useMemo(
    () => {
      let citationOrdinal = 0;
      const links = new Map<
        string,
        Array<{
          citationOrdinal: number;
          sourceOrdinal: number;
          timestampSeconds: number;
        }>
      >();
      for (const part of parseProjectCitations(
        artifact.content,
        artifact.sourceManifest,
      )) {
        if (part.type !== "citation") continue;
        citationOrdinal += 1;
        const key = JSON.stringify([part.href, part.raw.slice(1, -1)]);
        const entries = links.get(key) ?? [];
        entries.push({
          citationOrdinal,
          sourceOrdinal: Number.parseInt(part.sourceId.slice(1), 10),
          timestampSeconds: part.seconds,
        });
        links.set(key, entries);
      }
      return links;
    },
    [artifact.content, artifact.sourceManifest],
  );
  const renderedOccurrences = new Map<string, number>();

  return (
    <article
      className="ph-no-capture min-w-0 [overflow-wrap:anywhere]"
      data-ph-no-autocapture
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="mt-8 text-h3 font-semibold text-text-primary first:mt-0">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h4 className="mt-8 text-h5 font-semibold text-text-primary">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="mt-3 max-w-prose text-body-md leading-relaxed text-text-secondary">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="mt-3 flex max-w-prose list-disc flex-col gap-2 pl-6 text-body-md text-text-secondary">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mt-3 flex max-w-prose list-decimal flex-col gap-2 pl-6 text-body-md text-text-secondary">
              {children}
            </ol>
          ),
          a: ({ href, children }) => {
            const label = String(children);
            const key = JSON.stringify([href, label]);
            const matchingCitations = href ? citationLinks.get(key) : undefined;
            if (!href || !matchingCitations) {
              return <span>{children}</span>;
            }
            const occurrence = renderedOccurrences.get(key) ?? 0;
            renderedOccurrences.set(key, occurrence + 1);
            const citation = matchingCitations[occurrence];
            const source = artifact.sourceManifest.sources.find((candidate) =>
              href.includes(candidate.youtubeVideoId),
            );
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-sm font-medium text-accent-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-state-focus"
                aria-label={`${label}, open ${source?.title ?? "source Video"} at this timestamp`}
                onClick={() => {
                  if (!citation || citation.citationOrdinal > 100) {
                    return;
                  }
                  captureAnalyticsEvent("project_citation_clicked", {
                    project_id: artifact.projectId,
                    citation_context: "artifact",
                    artifact_id: artifact.artifactId,
                    artifact_kind: artifact.kind,
                    citation_ordinal: citation.citationOrdinal,
                    source_ordinal: citation.sourceOrdinal,
                    timestamp_seconds: citation.timestampSeconds,
                  });
                }}
              >
                {children}
                <ExternalLink aria-hidden="true" className="size-3" />
              </a>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}

export function EarlierProvenance({
  history,
  title,
}: {
  history: readonly ProjectArtifact[];
  title: ProjectArtifactPanelDefinition["title"];
}) {
  if (history.length === 0) return null;
  return (
    <details className="rounded-lg border border-border-subtle px-4 py-3">
      <summary className="cursor-pointer text-body-sm font-semibold text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-state-focus">
        Earlier provenance ({history.length})
      </summary>
      <ol
        aria-label={`Earlier ${title} provenance`}
        className="mt-3 flex flex-col gap-2"
      >
        {history.map((artifact) => (
          <li
            key={artifact.artifactId}
            className="flex flex-col gap-1 border-t border-border-subtle pt-3 text-body-sm text-text-secondary first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="font-medium text-text-primary">
              Source Set revision {artifact.sourceSetRevision}
            </span>
            <span>
              {artifact.evidenceSnapshot.passages.length}{" "}
              {artifact.evidenceSnapshot.passages.length === 1
                ? "passage"
                : "passages"}{" "}
              · {generatedLabel(artifact)}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
