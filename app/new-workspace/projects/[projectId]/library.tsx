"use client";
import {sourceLabel} from "@/i18n/saved-project-labels";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { Resource, Space } from "@/lib/video-space/contract";
import type {
  ProjectSourceSet,
  ProjectVideo,
} from "@/lib/projects/project-source-set-contract";
import type { ResearchVersion } from "@/lib/projects/project-research-contract";
import { normalizeYouTubeVideoInput } from "@/lib/services/youtube-url";
import { createClient } from "@/lib/supabase/client";
import { investigationsForSource } from "@/lib/video-space/source-investigations";
import { requestJson } from "./use-space";

import { SourceClaims } from "./source-claims";
import type { ClaimSpace } from "@/lib/video-space/claim-spaces";

type Props = {
  initialSources: ProjectSourceSet | null;
  bySource: Map<string, ClaimSpace[]>;
  selected?: string;
  activeSource?: string;
  ready: boolean;
  adding: boolean;
  setAdding: (value: boolean) => void;
  api: string;
  space: Space;
  update: (change: (s: Space) => Space) => boolean;
  attachPdf: (resource: Resource, contents: string) => void;
  versions: ResearchVersion[];
  openClaim: (id: string) => void;
  show: (id: string) => void;
};
function SourceCard({
  initial,
  first,
  video,
  api,
  save,
  versions,
  rooms,
  selected,
  activeSource,
  ready,
  openClaim,
  show,
}: {
  initial: Resource;
  first: boolean;
  rooms: ClaimSpace[];
  video?: ProjectVideo;
  save: (r: Resource) => void;
} & Pick<
  Props,
  | "api"
  | "versions"
  | "ready"
  | "selected"
  | "activeSource"
  | "openClaim"
  | "show"
>) {
  const tr = useTranslations("ui");
  const savedLabel = useTranslations("savedProject");

  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Resource | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const resource =
    initial.analyzed || initial.digest?.claims.length || !loaded
      ? initial
      : loaded;
  async function downloadPdf() {
    try {
      const { data, error } = await createClient()
        .from("video_space_pdfs")
        .select("contents")
        .eq("project_id", api.split("/").at(-1)!)
        .eq("id", initial.id)
        .single();
      if (error || !data) throw Error("originalPdfUnavailable");
      const url = URL.createObjectURL(
        new Blob(
          [Uint8Array.from(atob(data.contents), (c) => c.charCodeAt(0))],
          { type: "application/pdf" },
        ),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = initial.title;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setError("couldNotDownloadThePdfTryAgain");
    }
  }
  useEffect(() => {
    if (
      (!open && !first) ||
      !video ||
      video.status !== "ready" ||
      initial.digest ||
      loaded
    )
      return;
    let active = true;
    requestJson<Resource>(api + "/space", "POST", {
      action: "video",
      videoId: video.videoId,
    })
      .then((r) => {
        if (active) setLoaded(r);
      })
      .catch(() => {
        if (active) setError("couldNotLoadCaptionsTryAgain");
      });
    return () => {
      active = false;
    };
  }, [first, open, api, video, initial.digest, loaded]);
  async function prepare() {
    setError("");
    setBusy(true);
    try {
      const r =
        video && !resource.pages.length
          ? await requestJson<Resource>(api + "/space", "POST", {
              action: "video",
              videoId: video.videoId,
            })
          : resource;
      if (!r.pages.length) throw Error(r.coverage);
      const digest = await requestJson<Resource["digest"]>(
        api + "/space",
        "POST",
        { action: "summary", resource: r },
      );
      const complete = { ...r, digest, analyzed: true };
      save(complete);
      setLoaded(complete);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const started = useRef(false);
  useEffect(() => {
    if (
      (!open && !first) ||
      resource.analyzed ||
      resource.digest?.claims.length ||
      !resource.pages.length ||
      started.current
    )
      return;
    started.current = true;
    void prepare();
  });
  const claims = resource.digest?.claims ?? [];
  const source = {
    id: resource.id,
    title: resource.title,
    youtubeVideoId: video?.youtubeVideoId,
  };
  const referenced = open ? investigationsForSource(versions, source) : [];
  return (
    <SourceClaims
      {...{ rooms, first, selected, ready, openClaim }}
      activeSource={activeSource === resource.id}
      title={resource.title}
      kind={{ video: "YouTube", pdf: "PDF", web: tr("webPage") }[resource.kind]}
      summaryToggle={
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          {tr("summary")} {open ? "−" : "+"}
        </button>
      }
    >
      {open && (
        <div className="vs-digest">
          <strong>{tr("sourceSummary")}</strong>
          <p>{resource.digest?.summary || sourceLabel(resource.coverage, savedLabel)}</p>
          {initial.originalPdf && (
            <button onClick={downloadPdf}>{tr("downloadOriginalPdf")}</button>
          )}
          {resource.url && (
            <a target="_blank" rel="noreferrer" href={resource.url}>
              {tr("openOriginal")} <ExternalLink size={12} />
            </a>
          )}
          {!!resource.references?.length && (
            <details>
              <summary>{tr("sourceReferences")} {resource.references.length}</summary>
              {resource.references.map((r) => (
                <p key={r.url}>
                  <a href={r.url} target="_blank" rel="noreferrer">
                    {r.label} ↗
                  </a>{" "}
                  <small>{sourceLabel(r.location, savedLabel)}</small>
                </p>
              ))}
            </details>
          )}
          {resource.pages.length > 0 && (
            <details>
              <summary>{tr("excerpts")}</summary>
              {resource.pages.map((p, i) => (
                <blockquote key={i}>
                  <b>{sourceLabel(p.label, savedLabel)}</b> {p.text}
                </blockquote>
              ))}
            </details>
          )}
          {referenced.length > 0 && (
            <details>
              <summary>{tr("relatedResearch")} {referenced.length}</summary>
              {referenced.map((v) => (
                <p key={v.id}>
                  <button onClick={() => show(v.id)}>
                    {v.document.question}
                  </button>
                </p>
              ))}
            </details>
          )}
          {!claims.length && !resource.analyzed && (
            <button
              disabled={busy || video?.status === "processing"}
              onClick={prepare}
            >
              {busy ? tr("preparing") : tr("extractSummaryAndClaims")}
            </button>
          )}
        </div>
      )}
      {error && <p role="alert">{tr.has(error) ? tr(error) : sourceLabel(error, savedLabel)}</p>}
    </SourceClaims>
  );
}
export function Library({
  initialSources,
  adding,
  setAdding,
  api,
  space,
  update,
  attachPdf,
  versions,
  bySource,
  selected,
  activeSource,
  ready,
  openClaim,
  show,
}: Props) {
  const tr = useTranslations("ui");
  const [sources, setSources] = useState(initialSources),
    [url, setUrl] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = sources?.videos.some((v) => v.status === "processing");
  useEffect(() => {
    if (!pending) return;
    let active = true;
    const load = () =>
      requestJson<{ sourceSet: ProjectSourceSet }>(api + "/source-set")
        .then((r) => {
          if (active) setSources(r.sourceSet);
        })
        .catch(() => {
          if (active) setError("couldNotLoadVideoSources");
        });
    const id = setInterval(load, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [api, pending]);
  function save(r: Resource) {
    const added = update((s) => ({
      ...s,
      resources: s.resources.some((x) => x.id === r.id)
        ? s.resources.map((x) => (x.id === r.id ? r : x))
        : [...s.resources, r],
    }));
    if (!added) throw Error("sourceExceedsProjectCapacity");
  }
  async function add() {
    setBusy(true);
    setError("");
    try {
      if (file) {
        const { readPdf } = await import("@/lib/video-space/pdf");
        const r = await readPdf(file);
        const contents = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(Error("unableToReadPdf"));
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.readAsDataURL(file);
        });
        attachPdf(r, contents);
      } else if (normalizeYouTubeVideoInput(url)) {
        if (!sources) throw Error("videoListIsNotReady");
        await requestJson(api + "/source-set/process", "POST", {
          youtubeUrl: normalizeYouTubeVideoInput(url),
          expectedRevision: sources.revision,
        });
        setSources(
          (
            await requestJson<{ sourceSet: ProjectSourceSet }>(
              api + "/source-set",
            )
          ).sourceSet,
        );
      } else
        save(
          await requestJson<Resource>(api + "/space", "POST", {
            action: "web",
            url,
          }),
        );
      setUrl("");
      setFile(null);
      setAdding(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const cards = (sources?.videos ?? []).map((video) => ({
    video,
    resource: space.resources.find((r) => r.id === video.videoId) ?? {
      id: video.videoId,
      title: video.title || video.youtubeUrl,
      url: video.youtubeUrl,
      kind: "video" as const,
      pages: [],
      coverage:
        video.status === "processing"
          ? tr("videoProcessing")
          : video.status === "failed"
            ? tr("videoProcessingFailed")
            : tr("loadingVideoSummary"),
    },
  }));
  const items: Array<{ video?: ProjectVideo; resource: Resource }> = [
    ...cards,
    ...space.resources
      .filter((r) => !cards.some(({ resource }) => resource.id === r.id))
      .map((resource) => ({ resource })),
  ];
  return (
    <>
      {adding && (
        <form
          className="vs-import"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label>
            {tr("youtubeOrWebLink")}
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={!!file}
              required={!file}
            />
          </label>
          <label>
            {tr("orSelectAPdf")}
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button disabled={busy}>{busy ? tr("importing") : tr("importSource")}</button>
        </form>
      )}
      {error && <p role="alert">{tr.has(error) ? tr(error) : error}</p>}
      {!sources && <p role="alert">{tr("couldNotLoadVideoSources")}</p>}
      {sources && !items.length && (
        <p className="vs-hint">{tr("addTheFirstSourceForThisVideo")}</p>
      )}
      {items.map(({ resource, video }, i) => (
        <SourceCard
          key={resource.id}
          initial={resource}
          video={video}
          first={!i}
          rooms={bySource.get(resource.id) ?? []}
          {...{
            api,
            save,
            versions,
            ready,
            selected,
            activeSource,
            openClaim,
            show,
          }}
        />
      ))}
      {[...bySource]
        .filter(([id]) => !items.some(({ resource }) => resource.id === id))
        .map(([id, rooms]) => (
          <SourceClaims
            key={id}
            title={rooms[0].origin?.title ?? tr("projectClaims")}
            {...{ rooms, selected, ready, openClaim }}
            activeSource={activeSource === id}
          />
        ))}
    </>
  );
}
