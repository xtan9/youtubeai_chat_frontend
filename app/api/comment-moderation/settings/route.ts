import { moderationSettingsSchema } from "@/lib/comment-moderation/contracts";
import { updateModerationSettings } from "@/lib/comment-moderation/repository";
import { requireModerationUser } from "@/lib/comment-moderation/route-auth";

export async function PATCH(request: Request) {
  const auth = await requireModerationUser();
  if (!auth.ok) return auth.response;
  const parsed = moderationSettingsSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      {
        message:
          parsed.error.issues[0]?.message ?? "Check the moderation settings.",
      },
      { status: 400 },
    );
  }
  try {
    const connection = await updateModerationSettings(
      auth.userId,
      parsed.data,
    );
    return Response.json({ connection });
  } catch (error) {
    console.error("[comment-moderation] settings update failed", {
      errorId: "COMMENT_MODERATION_SETTINGS_FAILED",
      userId: auth.userId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return Response.json(
      { message: "Settings could not be saved right now." },
      { status: 503 },
    );
  }
}
