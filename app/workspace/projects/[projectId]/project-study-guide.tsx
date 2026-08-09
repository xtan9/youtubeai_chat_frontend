"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  Copy,
  Download,
  ExternalLink,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  ProjectArtifactApiLoadResponseSchema,
  type ProjectArtifact,
  type ProjectArtifactLoadResolution,
} from "@/lib/projects/project-artifact-contract";
import { buildProjectStudyGuideMarkdown } from "@/lib/projects/project-study-guide";
import { parseProjectCitations } from "@/lib/projects/project-grounded-citations";

type ReadyStudyGuide = Extract<
  ProjectArtifactLoadResolution,
  { status: "ready" }
>;

type GenerationError = {
  readonly message: string;
  readonly upgradeUrl: "/pricing" | null;
};

function studyGuideFilename(projectName: string) {
  const slug = projectName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return `${slug || "project"}-study-guide.md`;
}

function generatedLabel(artifact: ProjectArtifact) {
  const timestamp = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(artifact.generationMetadata.generatedAt));
  return `${timestamp} UTC`;
}

function ArtifactProvenance({ artifact }: { artifact: ProjectArtifact }) {
  return (
    <div
      aria-label="Study Guide provenance"
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

function StudyGuideMarkdown({ artifact }: { artifact: ProjectArtifact }) {
  const markdown = useMemo(
    () =>
      buildProjectStudyGuideMarkdown(
        artifact.content,
        artifact.sourceManifest,
      ),
    [artifact.content, artifact.sourceManifest],
  );
  const allowedCitationLinks = useMemo(
    () =>
      new Set(
        parseProjectCitations(artifact.content, artifact.sourceManifest)
          .filter((part) => part.type === "citation")
          .map((part) =>
            JSON.stringify([part.href, part.raw.slice(1, -1)]),
          ),
      ),
    [artifact.content, artifact.sourceManifest],
  );

  return (
    <article className="ph-no-capture" data-ph-no-autocapture>
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
            if (
              !href ||
              !allowedCitationLinks.has(JSON.stringify([href, label]))
            ) {
              return <span>{children}</span>;
            }
            const source = artifact.sourceManifest.sources.find((candidate) =>
              href.includes(candidate.youtubeVideoId),
            );
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-sm font-medium text-accent-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-state-focus"
                aria-label={`${String(children)}, open ${source?.title ?? "source Video"} at this timestamp`}
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

function EarlierProvenance({ history }: { history: readonly ProjectArtifact[] }) {
  if (history.length === 0) return null;
  return (
    <details className="rounded-lg border border-border-subtle px-4 py-3">
      <summary className="cursor-pointer text-body-sm font-semibold text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-state-focus">
        Earlier provenance ({history.length})
      </summary>
      <ol
        aria-label="Earlier Study Guide provenance"
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

export function ProjectStudyGuide({
  projectId,
  projectName,
  currentSourceSetRevision,
  initialStudyGuide,
}: {
  readonly projectId: string;
  readonly projectName: string;
  readonly currentSourceSetRevision?: number;
  readonly initialStudyGuide: ReadyStudyGuide;
}) {
  const [studyGuide, setStudyGuide] = useState(initialStudyGuide);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<GenerationError | null>(null);
  const current = studyGuide.current;
  const effectiveSourceSetRevision = Math.max(
    currentSourceSetRevision ?? studyGuide.currentSourceSetRevision,
    studyGuide.currentSourceSetRevision,
  );
  const updateAvailable = current
    ? current.sourceSetRevision < effectiveSourceSetRevision
    : false;
  const markdown = useMemo(
    () =>
      current
        ? buildProjectStudyGuideMarkdown(
            current.content,
            current.sourceManifest,
          )
        : null,
    [current],
  );

  async function generate() {
    if (pending) return;
    setPending(true);
    setFeedback(null);
    setError(null);
    captureAnalyticsEvent("project_artifact_generation_requested", {
      kind: "study_guide",
      tier: studyGuide.tier,
      is_regeneration: current !== null,
    });
    try {
      const response = await fetch(
        `/api/projects/${projectId}/artifacts/study-guide`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptToken: crypto.randomUUID() }),
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        const body =
          typeof payload === "object" && payload !== null
            ? (payload as Record<string, unknown>)
            : {};
        const category =
          response.status === 402
            ? "quota"
            : response.status === 409
              ? "evidence"
              : "generation";
        captureAnalyticsEvent("project_artifact_generation_blocked", {
          kind: "study_guide",
          tier: studyGuide.tier,
          failure_category: category,
        });
        setError({
          message:
            typeof body.message === "string"
              ? body.message
              : "Couldn’t generate the Study Guide. Try again.",
          upgradeUrl:
            response.status === 402 && body.upgradeUrl === "/pricing"
              ? "/pricing"
              : null,
        });
        return;
      }
      const parsed = ProjectArtifactApiLoadResponseSchema.safeParse(payload);
      if (!parsed.success) {
        captureAnalyticsEvent("project_artifact_generation_blocked", {
          kind: "study_guide",
          tier: studyGuide.tier,
          failure_category: "generation",
        });
        setError({
          message: "Couldn’t load the generated Study Guide. Try again.",
          upgradeUrl: null,
        });
        return;
      }
      const next = parsed.data.studyGuide;
      setStudyGuide(next);
      setFeedback(current ? "Study Guide updated." : "Study Guide generated.");
      if (next.current) {
        captureAnalyticsEvent("project_artifact_generation_completed", {
          kind: "study_guide",
          tier: next.tier,
          source_set_revision: next.current.sourceSetRevision,
          evidence_videos: next.current.sourceCoverage.usedVideos,
          evidence_passages: next.current.evidenceSnapshot.passages.length,
          generations_used: next.generationsUsed,
        });
      }
    } catch {
      captureAnalyticsEvent("project_artifact_generation_blocked", {
        kind: "study_guide",
        tier: studyGuide.tier,
        failure_category: "network",
      });
      setError({
        message: "Couldn’t generate the Study Guide. Check your connection and try again.",
        upgradeUrl: null,
      });
    } finally {
      setPending(false);
    }
  }

  async function copyMarkdown() {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setFeedback("Markdown copied.");
      setError(null);
      captureAnalyticsEvent("project_artifact_exported", {
        kind: "study_guide",
        format: "clipboard",
      });
    } catch {
      setError({
        message: "Couldn’t copy the Study Guide. Try downloading it instead.",
        upgradeUrl: null,
      });
    }
  }

  function downloadMarkdown() {
    if (!markdown) return;
    const blob = new Blob([markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = studyGuideFilename(projectName);
    anchor.click();
    URL.revokeObjectURL(href);
    setFeedback("Markdown downloaded.");
    setError(null);
    captureAnalyticsEvent("project_artifact_exported", {
      kind: "study_guide",
      format: "markdown",
    });
  }

  return (
    <section aria-labelledby="project-study-guide-title">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border-subtle">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-accent-brand">
                <BookOpen aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    id="project-study-guide-title"
                    className="text-h4 font-semibold text-text-primary"
                  >
                    Study Guide
                  </h2>
                  {updateAvailable ? (
                    <Badge variant="outline">Update available</Badge>
                  ) : null}
                </div>
                <p className="mt-1 max-w-prose text-body-sm text-text-secondary">
                  A durable guide built only from ready Transcript passages in
                  this Project’s Evidence Snapshot.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {current ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyMarkdown()}
                  >
                    <Copy aria-hidden="true" />
                    Copy Markdown
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={downloadMarkdown}
                  >
                    <Download aria-hidden="true" />
                    Download Markdown
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {updateAvailable ? (
            <p
              role="status"
              className="rounded-lg border border-border-default bg-surface-sunken px-4 py-3 text-body-sm text-text-secondary"
            >
              <strong className="font-semibold text-text-primary">
                Update available.
              </strong>{" "}
              The Source Set is now revision {effectiveSourceSetRevision}.
              Your current guide remains unchanged until you regenerate it.
            </p>
          ) : null}

          {current ? (
            <>
              <ArtifactProvenance artifact={current} />
              <StudyGuideMarkdown artifact={current} />
              <EarlierProvenance history={studyGuide.history} />
            </>
          ) : (
            <div className="flex flex-col items-start gap-3 rounded-lg bg-surface-sunken p-5">
              <p className="font-semibold text-text-primary">
                Turn your ready sources into a reviewable guide.
              </p>
              <p className="max-w-prose text-body-sm text-text-secondary">
                The guide will organize key ideas and review questions, with
                every factual line linked back to its Transcript evidence.
              </p>
            </div>
          )}

          {error ? (
            <div
              role="alert"
              className="flex flex-col items-start gap-3 rounded-lg border border-accent-danger/40 bg-surface-sunken px-4 py-3 text-body-sm text-text-secondary"
            >
              <p>{error.message}</p>
              {error.upgradeUrl ? (
                <Button asChild size="sm">
                  <Link href={error.upgradeUrl}>View Pro plans</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
          {feedback ? (
            <p role="status" aria-live="polite" className="text-body-sm text-accent-success">
              {feedback}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-border-subtle pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-caption text-text-muted">
              {studyGuide.tier === "free" ? (
                <p>
                  Free Artifact generations: {studyGuide.generationsUsed}/1
                </p>
              ) : (
                <p>Pro Artifact generation · Technical and abuse limits apply</p>
              )}
              {current ? (
                <p>Regeneration replaces the current guide; earlier provenance stays in the audit record.</p>
              ) : null}
            </div>
            <Button
              type="button"
              onClick={() => void generate()}
              disabled={pending}
            >
              {current ? (
                <RefreshCw aria-hidden="true" />
              ) : (
                <Sparkles aria-hidden="true" />
              )}
              {pending
                ? "Generating Study Guide…"
                : current
                  ? "Regenerate Study Guide"
                  : "Generate Study Guide"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
