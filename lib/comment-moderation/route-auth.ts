import "server-only";

import { resolveRequestPrincipal } from "@/lib/auth/request-principal";

export type ModerationAuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

export async function requireModerationUser(): Promise<ModerationAuthResult> {
  const result = await resolveRequestPrincipal({
    source: "comment_moderation",
  });
  if (result.kind === "unavailable") {
    return {
      ok: false,
      response: Response.json(
        { message: "Account verification is temporarily unavailable." },
        { status: 503 },
      ),
    };
  }
  if (result.kind === "missing" || result.principal.isAnonymous) {
    return {
      ok: false,
      response: Response.json(
        { message: "Sign in to manage YouTube comments." },
        { status: 401 },
      ),
    };
  }
  return { ok: true, userId: result.principal.userId };
}
