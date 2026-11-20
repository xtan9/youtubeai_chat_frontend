"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  spaceSchema,
  type Space,
  type Resource,
} from "@/lib/video-space/contract";

export class SpaceRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function requestJson<T>(
  url: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const json = await response.json();
  if (!response.ok)
    throw new SpaceRequestError(
      response.status,
      json.message || "请求失败，请重试。",
    );
  return json;
}

async function writePdf(
  url: string,
  revision: number,
  document: Space,
  file: { id: string; contents: string },
) {
  const { data, error } = await createClient().rpc("save_video_space_pdf", {
    p_project: url.split("/").at(-2),
    p_revision: revision,
    p_document: document,
    p_id: file.id,
    p_contents: file.contents,
  });
  if (error)
    throw Error(
      error.code === "40001"
        ? "其他窗口已更新此 Space，请先复制本地草稿。"
        : "PDF 保存失败，请重试。",
    );
  return { revision: Number(data) };
}

// One writer per mounted project. A receipt advances the revision only for
// the exact snapshot sent, then any newer local edits are saved in order.
export function useSpace(url: string) {
  const [space, setSpace] = useState<Space | null>(null);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState("正在读取…");
  const live = useRef<Space | null>(null),
    saved = useRef<Space | null>(null),
    revision = useRef(0);
  const saving = useRef<Promise<boolean> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPdf = useRef<{ id: string; contents: string } | null>(null);
  const flush = useCallback(async () => {
    if (saving.current) return saving.current;
    if (!live.current || live.current === saved.current) return true;
    saving.current = (async () => {
      try {
        while (live.current !== saved.current) {
          const document: Space = live.current!;
          const file = pendingPdf.current;
          const receipt = file
            ? await writePdf(url, revision.current, document, file)
            : await requestJson<{ revision: number }>(url, "PUT", {
                revision: revision.current,
                document,
              });
          if (file) pendingPdf.current = null;
          revision.current = receipt.revision;
          saved.current = document;
        }
        setStatus("已保存");
        return true;
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "保存失败");
        return false;
      } finally {
        saving.current = null;
      }
    })();
    return saving.current;
  }, [url]);
  const ensureReadingSaved = useCallback(async () => {
    const current = live.current, previous = saved.current;
    if (!current || !previous) return false;
    if (current.resources === previous.resources && current.customClaims === previous.customClaims &&
        current.researchAttempts === previous.researchAttempts && current.claimDiscussion === previous.claimDiscussion) return true;
    return flush();
  }, [flush]);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void requestJson<{ document: Space; revision: number }>(
      url,
      "GET",
      undefined,
      signal,
    )
      .then((row) => {
        if (signal.aborted) return;
        live.current = saved.current = spaceSchema.parse(row.document);
        revision.current = row.revision;
        setSpace(live.current);
        setStatus("已保存");
      })
      .catch(() => {
        if (!signal.aborted) setLoadError("无法读取脚本，请重新加载。");
      });
    const guard = (e: BeforeUnloadEvent) => {
      if (live.current !== saved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      controller.abort();
      window.removeEventListener("beforeunload", guard);
      if (timer.current) clearTimeout(timer.current);
      void flush();
    };
  }, [url, flush]);
  const update = useCallback(
    (change: (s: Space) => Space) => {
      if (!live.current) return false;
      const prev = live.current;
      const next = change(prev);
      // Refuse an overflowing import/turn before it can poison subsequent saves.
      const metadataChanged =
        next.resources !== prev.resources ||
        next.messages !== prev.messages ||
        next.drafts.length !== prev.drafts.length;
      if (
        next.drafts.length > 50 ||
        next.messages.length > 2000 ||
        next.resources.length > 80 ||
        new Blob([JSON.stringify(next)]).size >
          (metadataChanged ? 2_200_000 : 2_750_000)
      ) {
        setStatus("已达到 Space 容量上限，本次更改未加入。");
        return false;
      }
      live.current = next;
      setSpace(next);
      setStatus("正在保存…");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 300);
      return true;
    },
    [flush],
  );
  function attachPdf(resource: Resource, contents: string) {
    if (pendingPdf.current) throw Error("请等待上一份 PDF 保存完成。");
    if (
      !update((s) => ({
        ...s,
        resources: [...s.resources, { ...resource, originalPdf: true }],
      }))
    )
      throw Error("素材超过 Space 保存上限。");
    pendingPdf.current = { id: resource.id, contents };
    void flush();
  }
  return { space, live, status, loadError, update, flush, ensureReadingSaved, attachPdf };
}
