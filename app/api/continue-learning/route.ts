import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  readContinueLearningRecommendations,
  registerContinueLearningTokenBindings,
  recordContinueLearningReadyReads,
} from "@/lib/services/continue-learning-reader";
import {
  signContinueLearningSetToken,
  signContinueLearningToken,
} from "@/lib/services/continue-learning-token";
import { extractYouTubeId } from "@/lib/youtube-url";

function jsonError(status: number, message: string): Response {
  return Response.json({ message }, { status });
}
function enabled(): boolean {
  return process.env.CONTINUE_LEARNING_READER_ENABLED?.trim().toLowerCase() === "true";
}

function validYouTubeUrl(value: string | null): value is string {
  if (!value) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }
  return (
    (parsed.hostname === "youtube.com" ||
      parsed.hostname.endsWith(".youtube.com") ||
      parsed.hostname === "youtu.be") &&
    extractYouTubeId(value) !== null
  );
}

export async function GET(request: Request): Promise<Response> {
  const sourceUrl = new URL(request.url).searchParams.get("youtube_url");
  if (!validYouTubeUrl(sourceUrl)) {
    return jsonError(400, "Invalid query");
  }

  const principalResult = await resolveRequestPrincipal({
    source: "continue_learning_reader",
  });
  if (principalResult.kind === "unavailable") {
    return jsonError(503, "Auth service temporarily unavailable.");
  }
  if (
    principalResult.kind === "missing" ||
    principalResult.principal.isAnonymous
  ) {
    return jsonError(401, "Unauthorized");
  }

  if (!enabled()) {
    return Response.json({
      outcome: "unavailable",
      reason: "feature_disabled",
    });
  }

  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    return jsonError(503, "Recommendation reader unavailable.");
  }

  const sourceYoutubeVideoId = extractYouTubeId(sourceUrl);
  if (!sourceYoutubeVideoId) {
    return jsonError(400, "Invalid query");
  }

  const result = await readContinueLearningRecommendations(serviceClient, {
    learnerId: principalResult.principal.userId,
    sourceYoutubeVideoId,
    limit: 4,
  });
  if (!result) {
    return jsonError(503, "Recommendation reader unavailable.");
  }
  if (result.outcome === "pending") {
    return Response.json({ outcome: "pending" });
  }
  if (result.outcome === "unavailable") {
    return Response.json({
      outcome: "unavailable",
      reason: result.reason,
    });
  }
  if (result.items.length === 0) {
    return Response.json({
      outcome: "unavailable",
      reason: "no_recommendations",
    });
  }

  const setId = result.items[0].setId;
  if (result.items.some((item) => item.setId !== setId)) {
    return jsonError(503, "Recommendation reader unavailable.");
  }
  const setVersionToken = signContinueLearningSetToken({
    learnerId: principalResult.principal.userId,
    setId,
  });
  const items = result.items.map((item) => ({
    token: signContinueLearningToken({
      learnerId: principalResult.principal.userId,
      setId: item.setId,
      ordinal: item.ordinal,
    }),
    ordinal: item.ordinal,
    canonicalUrl: item.canonicalUrl,
    title: item.title,
    channelName: item.channelName,
    thumbnailUrl: item.thumbnailUrl,
    relationship: item.relationship,
    explanation: item.explanation,
  }));
  if (!setVersionToken || items.some((item) => item.token === null)) {
    return jsonError(503, "Recommendation reader unavailable.");
  }

  const signedItems = items.map((item) => ({
    ...item,
    token: item.token as string,
  }));
  await registerContinueLearningTokenBindings(
    serviceClient,
    principalResult.principal.userId,
    signedItems.map((item, index) => ({
      token: item.token,
      setId: result.items[index].setId,
      ordinal: result.items[index].ordinal,
    })),
  );
  await recordContinueLearningReadyReads(serviceClient, result.items);

  return Response.json({
    outcome: "ready",
    setVersionToken,
    items: signedItems,
  });
}
