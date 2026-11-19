import "server-only";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { getCachedSummary } from "@/lib/services/summarize-cache";
import { getCachedTranscript } from "@/lib/services/transcript-cache";
import type { ProjectVideo } from "@/lib/projects/project-source-set-contract";
import { textReferences } from "./source-references";
import type { Resource } from "./contract";

export async function readVideo(video: ProjectVideo): Promise<Resource> {
  const [cached, transcript] = await Promise.all([
    getCachedSummary(video.youtubeUrl),
    getCachedTranscript(video.youtubeUrl),
  ]);
  // A project video can have a translated cached summary without a native one.
  // Only read by the video id resolved from the registered owner's source set.
  const translation = !cached
    ? await getServiceRoleClient()
        ?.from("summaries")
        .select("summary,transcript")
        .eq("video_id", video.videoId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : null;
  const summary = cached ?? translation?.data;
  const segments = transcript?.segments ?? [];
  const pages: Resource["pages"] = [];
  let size = 0;
  for (const segment of segments) {
    if (size >= 60000 || pages.length >= 200) break;
    const seconds = Math.floor(segment.start),
      previous = pages.at(-1);
    const text = segment.text.slice(0, Math.min(16000, 60000 - size));
    if (
      previous &&
      previous.text.length + text.length < 700 &&
      seconds - (previous.seconds ?? 0) < 45
    )
      previous.text += " " + text;
    else
      pages.push({
        label:
          segment.duration > 0
            ? Math.floor(seconds / 60) +
              ":" +
              String(seconds % 60).padStart(2, "0")
            : "字幕摘录",
        text,
        seconds: segment.duration > 0 ? seconds : undefined,
      });
    size += text.length;
  }
  if (!pages.length && summary?.transcript)
    pages.push({ label: "字幕摘录", text: summary.transcript.slice(0, 16000) });
  const resource: Resource = {
    id: video.videoId,
    title: video.title || video.youtubeUrl,
    kind: "video",
    url: video.youtubeUrl,
    pages,
    coverage: pages.length ? "项目视频字幕摘录" : "字幕暂不可用",
    digest: summary?.summary
      ? { summary: summary.summary.slice(0, 60000), claims: [] }
      : undefined,
  };
  textReferences(resource, summary?.summary ?? "", "视频摘要");
  return resource;
}
