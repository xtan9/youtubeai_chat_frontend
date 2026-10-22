import { resolveRequestPrincipal, type RequestPrincipal } from "@/lib/auth/request-principal";
import { checkRateLimit } from "@/lib/services/rate-limit";
import { cookies } from "next/headers";
import {
  ANON_COOKIE_NAME,
  ANON_COOKIE_MAX_AGE_SECONDS,
  signAnonId,
  verifyAnonId,
} from "@/lib/services/anon-cookie";
import { checkSummaryEntitlement } from "@/lib/services/entitlements";
import { randomUUID } from "node:crypto";
import { SummaryRequestSchema } from "@/lib/api-contracts/summary";
import type { LogStage } from "@/lib/stages";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/request-id";
import { logAppEvent, videoIdForLog } from "@/lib/observability";
import { createSummaryGenerationStream } from "./summary-generation-stream";

export type ServerSummaryRunPersistence = "deferred" | "required";

export type ServerSummaryRunOptions = Readonly<{
  persistence?: ServerSummaryRunPersistence;
  /** A principal already authenticated by another owned server capability. */
  principal?: RequestPrincipal;
}>;

function jsonError(
  status: number,
  message: string,
  extraHeaders?: Record<string, string>,
  requestId?: string,
  errorId?: string
) {
  const headers = {
    "Content-Type": "application/json",
    ...(requestId ? { [REQUEST_ID_HEADER]: requestId } : {}),
    ...(errorId ? { "X-Error-ID": errorId } : {}),
    ...extraHeaders,
  };
  return new Response(JSON.stringify({ message }), {
    status,
    headers,
  });
}

/**
 * The server Summary Run capability shared by the public stream route and
 * durable Project processing. It remains the single owner of authentication,
 * quota, cache reuse, Transcript Acquisition, generation, and wire outcomes.
 */
export async function runServerSummaryRun(
  request: Request,
  options: ServerSummaryRunOptions = {},
) {
  const persistence = options.persistence ?? "deferred";
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body", undefined, requestId, "INVALID_JSON");
  }

  const parsed = SummaryRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(
      400,
      "Invalid request body",
      undefined,
      requestId,
      "INVALID_REQUEST"
    );
  }
  const {
    youtube_url,
    include_transcript: includeTranscript,
    output_language: outputLanguageCode,
  } = parsed.data;

  const principalResult = options.principal
    ? ({ kind: "resolved", principal: options.principal } as const)
    : await resolveRequestPrincipal({
        source: "summary_stream",
        requestId,
      });
  if (principalResult.kind === "unavailable") {
    return jsonError(
      503,
      "Auth service temporarily unavailable.",
      undefined,
      requestId,
      "AUTH_SERVICE_UNAVAILABLE"
    );
  }
  if (principalResult.kind === "missing") {
    return jsonError(401, "Unauthorized", undefined, requestId, "AUTH_REQUIRED");
  }

  const { principal } = principalResult;
  const { userId, isAnonymous, smokeProEntitled } = principal;

  const rateLimit = await checkRateLimit(userId, isAnonymous);
  // Bind the user + URL to the bypass in one log line so dashboards can
  // alert without joining against rate-limit.ts's infra-cause log. Do NOT
  // surface this distinction in the HTTP response — exposing fail_open to
  // clients tells abusers exactly when our abuse wall is down.
  if (rateLimit.reason === "fail_open") {
    logAppEvent("error", "[summarize/stream] rate-limit bypassed (fail-open)", {
      stage: "unknown" satisfies LogStage,
      errorId: "RATE_LIMIT_FAIL_OPEN_REQUEST",
      userId,
      videoId: videoIdForLog(youtube_url),
      requestId,
    });
  }
  if (!rateLimit.allowed) {
    return jsonError(429, "Rate limit exceeded. Please try again later.", {
      "X-RateLimit-Remaining": String(rateLimit.remaining),
    }, requestId, "RATE_LIMITED");
  }
  const remaining = rateLimit.remaining;

  // Resolve anon-id cookie for anonymous users. Set-Cookie is applied later
  // via the response headers if we minted a new id.
  let anonId: string | null = null;
  let setAnonCookie: string | null = null;
  if (isAnonymous) {
    const jar = await cookies();
    const existing = jar.get(ANON_COOKIE_NAME)?.value ?? null;
    const verified = existing ? verifyAnonId(existing) : null;
    if (verified) {
      anonId = verified;
    } else {
      const fresh = randomUUID();
      const signed = signAnonId(fresh);
      if (signed) {
        anonId = fresh;
        setAnonCookie = signed;
      }
    }
  }

  let entitlement: Awaited<ReturnType<typeof checkSummaryEntitlement>>;
  if (isAnonymous) {
    if (anonId) {
      entitlement = await checkSummaryEntitlement({ anonId, isAnon: true });
    } else {
      // ANON_COOKIE_SECRET missing/too short — anon-cookie service already
      // logged ANON_COOKIE_SECRET_MISSING. Fail-open as anon (allow this
      // request, log the bypass) instead of debiting the signed-in monthly
      // counter, which would silently grant 10/month to anon users.
      logAppEvent("error", "[summarize/stream] anon entitlement bypassed - secret missing", {
        stage: "unknown" satisfies LogStage,
        errorId: "ENTITLEMENT_ANON_FAIL_OPEN_NO_SECRET",
        userId,
        videoId: videoIdForLog(youtube_url),
        requestId,
      });
      entitlement = {
        tier: "anon",
        allowed: true,
        remaining: 1,
        reason: "fail_open",
      };
    }
  } else {
    entitlement = await checkSummaryEntitlement({
      userId,
      isAnon: false,
      smokeProEntitled,
    });
  }

  if (entitlement.reason === "fail_open") {
    logAppEvent("error", "[summarize/stream] entitlement bypassed (fail-open)", {
      stage: "unknown" satisfies LogStage,
      errorId: "ENTITLEMENT_FAIL_OPEN_REQUEST",
      userId,
      isAnonymous,
      videoId: videoIdForLog(youtube_url),
      requestId,
    });
  }
  if (!entitlement.allowed) {
    const errorCode = entitlement.tier === "anon"
      ? "anon_quota_exceeded"
      : "free_quota_exceeded";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      [REQUEST_ID_HEADER]: requestId,
      "X-Error-ID": "QUOTA_EXCEEDED",
    };
    if (setAnonCookie) {
      headers["Set-Cookie"] = `${ANON_COOKIE_NAME}=${setAnonCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ANON_COOKIE_MAX_AGE_SECONDS}`;
    }
    return new Response(
      JSON.stringify({
        message:
          entitlement.tier === "anon"
            ? "Sign up to keep using the app — get 10 free summaries each month."
            : "You've used your 10 free summaries this month. Upgrade for unlimited.",
        errorCode,
        tier: entitlement.tier,
        upgradeUrl: "/pricing",
      }),
      { status: 402, headers }
    );
  }

  return createSummaryGenerationStream({
    request,
    requestId,
    userId,
    smokeProEntitled,
    persistence,
    youtube_url,
    includeTranscript,
    outputLanguageCode,
    remaining,
    setAnonCookie,
  });
}
