import { createHash } from "node:crypto";
import { z } from "zod";
import { logAppEvent } from "@/lib/observability";
import { ChatGatewayError } from "@/lib/services/llm-chat-error";
import { requireRegisteredResearcher } from "@/lib/projects/registered-researcher";
import { createClient } from "@/lib/supabase/server";
import { resolveProjectSubject } from "@/lib/projects/project-subject";
import { projectOutcomeResponse } from "@/lib/projects/api-outcomes";
import { loadProjectSourceSet } from "@/lib/projects/project-source-set";
import {
  spaceSchema,
  emptySpace,
  publicLink,
  resourceSchema,
  type Resource,
} from "@/lib/video-space/contract";
import { readVideo } from "@/lib/video-space/video-material";
import { readWebPage } from "@/lib/video-space/read-web";
import {
  summarize,
  writerRequest,
  writeScript,
  discussionRequest,
  discussClaim,
} from "@/lib/video-space/assistant";
import { checkRateLimit } from "@/lib/services/rate-limit";

export const maxDuration = 90;
type Context = { params: Promise<{ projectId: string }> };
const fail = (status: number, message: string) =>
  Response.json({ message }, { status });
async function authorize(context: Context) {
  const auth = await requireRegisteredResearcher("project");
  if (auth.kind === "error") return { response: auth.response } as const;
  const { projectId } = await context.params,
    client = await createClient();
  const subject = await resolveProjectSubject(
    client,
    auth.principal.userId,
    projectId,
  );
  if (subject.kind !== "resolved")
    return { response: projectOutcomeResponse(subject) } as const;
  return { client, subject: subject.value, projectId } as const;
}
// The same saved source passage gets the same link on every read, including
// digests created before individual claims had an identifier.
function identifyClaims(
  resourceId: string,
  digest: NonNullable<Resource["digest"]>,
) {
  return {
    ...digest,
    claims: digest.claims.map((claim) => ({
      ...claim,
      id:
        "c-" +
        createHash("sha256")
          .update(
            JSON.stringify([
              resourceId,
              claim.location,
              claim.quote,
              claim.text,
            ]),
          )
          .digest("hex")
          .slice(0, 32),
    })),
  };
}

export async function GET(_request: Request, context: Context) {
  const auth = await authorize(context);
  if (auth.response) return auth.response;
  const row = await auth.client
    .from("video_spaces")
    .select("revision,document")
    .eq("project_id", auth.projectId)
    .maybeSingle();
  if (row.error) return fail(503, "无法读取已保存的脚本，请重试。");
  const document = row.data
    ? spaceSchema.parse(row.data.document)
    : emptySpace();
  for (const resource of document.resources) {
    if (resource.digest)
      resource.digest = identifyClaims(resource.id, resource.digest);
  }
  return Response.json({ revision: row.data?.revision ?? 0, document });
}
export async function PUT(request: Request, context: Context) {
  const auth = await authorize(context);
  if (auth.response) return auth.response;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 2_900_000)
    return fail(413, "Space 已达到保存大小上限。");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail(400, "无效的保存内容。");
  }
  const parsed = z
    .object({ revision: z.number().int().nonnegative(), document: spaceSchema })
    .safeParse(json);
  if (!parsed.success) return fail(400, "内容超出保存限制。请缩短文本后重试。");
  const { document, revision } = parsed.data,
    table = auth.client.from("video_spaces");
  const write =
    revision === 0
      ? table.insert({ project_id: auth.projectId, revision: 1, document })
      : table
          .update({ revision: revision + 1, document })
          .eq("project_id", auth.projectId)
          .eq("revision", revision);
  const row = await write.select("revision").maybeSingle();
  if (row.error && row.error.code !== "23505")
    return fail(503, "保存失败，请重试。");
  if (!row.data)
    return fail(
      409,
      "其他窗口已更新此 Space。请复制未保存的内容，再重新打开。",
    );
  return Response.json(row.data);
}
const action = z.discriminatedUnion("action", [
  writerRequest,
  discussionRequest,
  z.object({ action: z.literal("web"), url: publicLink }),
  z.object({ action: z.literal("video"), videoId: z.uuid() }),
  z.object({ action: z.literal("summary"), resource: resourceSchema }),
]);
export async function POST(request: Request, context: Context) {
  const auth = await authorize(context);
  if (auth.response) return auth.response;
  const parsed = action.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "请求内容无效。");
  const body = parsed.data;
  try {
    if (body.action === "video") {
      const set = await loadProjectSourceSet(auth.client, auth.subject);
      if (set.kind !== "resolved") return projectOutcomeResponse(set);
      const video = set.value.videos.find((v) => v.videoId === body.videoId);
      return video
        ? Response.json(await readVideo(video))
        : fail(404, "未找到项目素材。");
    }
    const limit = await checkRateLimit(auth.subject.ownerId, false);
    if (!limit.allowed) return fail(429, "请求过于频繁，请稍后重试。");
    if (body.action === "web")
      return Response.json(await readWebPage(body.url, request.signal));
    if (body.action === "summary")
      return Response.json(
        identifyClaims(
          body.resource.id,
          await summarize(body.resource, request.signal),
        ),
      );
    if (body.action === "discussClaim")
      return Response.json(await discussClaim(body, request.signal));
    return Response.json(await writeScript(body, request.signal));
  } catch (error) {
    let reason = error instanceof Error ? error.name : "unknown";
    if (error instanceof ChatGatewayError) reason = error.failureCode;
    if (
      error instanceof Error &&
      ["missing_source_summary", "unknown_source_excerpt"].includes(
        error.message,
      )
    ) {
      reason = error.message;
    }
    logAppEvent("warn", "[video-space] request failed", {
      stage: body.action,
      errorCode: reason,
      ...(error instanceof ChatGatewayError && { status: error.httpStatus }),
    });
    return fail(
      503,
      body.action === "summary"
        ? "暂时无法整理这份素材的摘要与出处，请重试。"
        : "暂时无法完成请求，请重试。",
    );
  }
}
