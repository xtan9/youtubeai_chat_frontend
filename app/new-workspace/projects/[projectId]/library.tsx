"use client";
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

import type { ClaimSpace } from "@/lib/video-space/claim-spaces";

type Props = {
  claimRooms?: Map<string, ClaimSpace>;
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
  claimRooms,
  openClaim,
  show,
}: {
  initial: Resource;
  first: boolean;
  video?: ProjectVideo;
  save: (r: Resource) => void;
} & Pick<Props, "api" | "versions" | "claimRooms" | "openClaim" | "show">) {
  const [open, setOpen] = useState(false),
    [more, setMore] = useState(false);
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
      if (error || !data) throw Error("原 PDF 暂不可用。");
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
      setError("无法下载原 PDF，请重试。");
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
        if (active) setError("读取字幕失败，请重试。");
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
    <div className="vs-source">
      <small>
        {video ? "YouTube" : resource.kind === "pdf" ? "PDF" : "网页"}
      </small>
      <div className="vs-row">
        <h3>{resource.title}</h3>
        <button aria-expanded={open} onClick={() => setOpen(!open)}>
          摘要 {open ? "−" : "+"}
        </button>
      </div>
      {open && (
        <div className="vs-digest">
          <strong>素材摘要</strong>
          <p>{resource.digest?.summary || resource.coverage}</p>
          {initial.originalPdf && (
            <button onClick={downloadPdf}>下载原 PDF</button>
          )}
          {resource.url && (
            <a target="_blank" rel="noreferrer" href={resource.url}>
              打开原文 <ExternalLink size={12} />
            </a>
          )}
          {!!resource.references?.length && (
            <details>
              <summary>素材引用 · {resource.references.length}</summary>
              {resource.references.map((r) => (
                <p key={r.url}>
                  <a href={r.url} target="_blank" rel="noreferrer">
                    {r.label} ↗
                  </a>{" "}
                  <small>{r.location}</small>
                </p>
              ))}
            </details>
          )}
          {resource.pages.length > 0 && (
            <details>
              <summary>原文摘录</summary>
              {resource.pages.map((p, i) => (
                <blockquote key={i}>
                  <b>{p.label}</b> {p.text}
                </blockquote>
              ))}
            </details>
          )}
          {referenced.length > 0 && (
            <details>
              <summary>相关调查 · {referenced.length}</summary>
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
              {busy ? "正在整理…" : "整理摘要与观点"}
            </button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {claims.length > 0 && (
        <details open={first}>
          <summary>关键观点 · {claims.length}</summary>
          {(more ? claims : claims.slice(0, 4)).map((claim) => (
            <button
              key={claim.id}
              className="vs-claim-link"
              aria-label={claim.text}
              aria-describedby={
                claim.id &&
                claimRooms &&
                !claimRooms.get(claim.id)?.versions.length
                  ? "vs-claim-status-" + claim.id
                  : undefined
              }
              onClick={() => claim.id && openClaim(claim.id)}
            >
              <span>{claim.text}</span>
              {claim.id &&
                claimRooms &&
                !claimRooms.get(claim.id)?.versions.length && (
                  <small id={"vs-claim-status-" + claim.id}>待核查</small>
                )}
              <span aria-hidden="true">›</span>
            </button>
          ))}
          {claims.length > 4 && (
            <button onClick={() => setMore(!more)}>
              {more ? "收起其余观点" : "查看全部 " + claims.length + " 条"}
            </button>
          )}
        </details>
      )}
    </div>
  );
}
export function Library({
  adding,
  setAdding,
  api,
  space,
  update,
  attachPdf,
  versions,
  claimRooms,
  openClaim,
  show,
}: Props) {
  const [sources, setSources] = useState<ProjectSourceSet | null>(null),
    [url, setUrl] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = sources?.videos.some((v) => v.status === "processing");
  useEffect(() => {
    let active = true;
    const load = () =>
      requestJson<{ sourceSet: ProjectSourceSet }>(api + "/source-set")
        .then((r) => {
          if (active) setSources(r.sourceSet);
        })
        .catch(() => {
          if (active) setError("无法读取视频素材。");
        });
    void load();
    const id = pending ? setInterval(load, 4000) : undefined;
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
    if (!added) throw Error("此素材超过 Space 容量上限。");
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
          reader.onerror = () => reject(Error("无法读取 PDF"));
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.readAsDataURL(file);
        });
        attachPdf(r, contents);
      } else if (normalizeYouTubeVideoInput(url)) {
        if (!sources) throw Error("视频列表未就绪。");
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
          ? "视频处理中"
          : video.status === "failed"
            ? "视频处理失败"
            : "读取视频摘要…",
    },
  }));
  const items: Array<{ video?: ProjectVideo; resource: Resource }> = [
    ...cards,
    ...space.resources
      .filter((r) => r.kind !== "video")
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
            YouTube 或网页链接
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={!!file}
              required={!file}
            />
          </label>
          <label>
            或选择 PDF
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button disabled={busy}>{busy ? "正在导入…" : "添加到 Space"}</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {!items.length && (
        <p className="vs-hint">
          {sources ? "添加本期视频的第一份素材。" : "正在读取素材…"}
        </p>
      )}
      {items.map(({ resource, video }, i) => (
        <SourceCard
          key={resource.id}
          initial={resource}
          video={video}
          first={!i}
          {...{ api, save, versions, claimRooms, openClaim, show }}
        />
      ))}
    </>
  );
}
