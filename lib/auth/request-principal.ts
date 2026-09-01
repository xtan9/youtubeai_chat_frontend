import "server-only";

import { logAppEvent } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";
import {
  hasSmokeProEntitlement,
  isSmokeAccount,
} from "@/lib/auth/smoke-account";

const REQUEST_PRINCIPAL_UNAVAILABLE = "REQUEST_PRINCIPAL_UNAVAILABLE";
const MISSING_SESSION_STATUSES = new Set([400, 401, 403]);
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$/;

const REQUEST_PRINCIPAL_SOURCES = [
  "summary_stream",
  "chat_stream",
  "chat_messages",
  "chat_suggestions",
  "continue_learning_reader",
  "continue_learning_feedback",
  "entitlements",
  "billing_checkout",
  "billing_portal",
  "admin_gate",
  "account",
  "channel_scan",
  "workspace_projects",
  "project",
] as const;

export type RequestPrincipalSource =
  (typeof REQUEST_PRINCIPAL_SOURCES)[number];

export type RequestPrincipal = Readonly<{
  userId: string;
  isAnonymous: boolean;
  email: string | null;
  smokeProEntitled?: boolean;
  businessAnalyticsSuppressed: boolean;
}>;

export type RequestPrincipalResult =
  | { readonly kind: "resolved"; readonly principal: RequestPrincipal }
  | { readonly kind: "missing" }
  | { readonly kind: "unavailable" };

type FailurePhase =
  | "client_creation"
  | "returned_error"
  | "lookup_thrown"
  | "invalid_user";

type ProviderError = {
  readonly status?: unknown;
};

type ProviderUser = {
  readonly id?: unknown;
  readonly is_anonymous?: unknown;
  readonly email?: unknown;
  readonly app_metadata?: Record<string, unknown>;
};

function assertRequestPrincipalSource(
  source: string,
): asserts source is RequestPrincipalSource {
  if (!(REQUEST_PRINCIPAL_SOURCES as readonly string[]).includes(source)) {
    throw new TypeError("Invalid Request Principal source");
  }
}

function providerStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as ProviderError).status;
  return typeof status === "number" && Number.isInteger(status)
    ? status
    : undefined;
}

function safeRequestId(
  requestId: string | null | undefined,
): string | undefined {
  return requestId && SAFE_REQUEST_ID_PATTERN.test(requestId)
    ? requestId
    : undefined;
}

function unavailable(
  source: RequestPrincipalSource,
  phase: FailurePhase,
  requestId: string | null | undefined,
  status: number | undefined,
): RequestPrincipalResult {
  const fields: Record<string, unknown> = { source, phase };
  if (status !== undefined) fields.status = status;
  const boundedRequestId = safeRequestId(requestId);
  if (boundedRequestId !== undefined) fields.requestId = boundedRequestId;

  logAppEvent("error", REQUEST_PRINCIPAL_UNAVAILABLE, fields);
  return { kind: "unavailable" };
}

function resolvedPrincipal(
  user: ProviderUser,
  userId: string,
): RequestPrincipal {
  return {
    userId,
    isAnonymous: user.is_anonymous === true,
    email: typeof user.email === "string" ? user.email : null,
    smokeProEntitled: hasSmokeProEntitlement({
      app_metadata: user.app_metadata ?? {},
    }),
    businessAnalyticsSuppressed: isSmokeAccount({
      app_metadata: user.app_metadata ?? {},
    }),
  };
}

export async function resolveRequestPrincipal(args: {
  source: RequestPrincipalSource;
  requestId?: string | null;
}): Promise<RequestPrincipalResult> {
  assertRequestPrincipalSource(args.source);

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch (error) {
    return unavailable(
      args.source,
      "client_creation",
      args.requestId,
      providerStatus(error),
    );
  }

  let result: {
    data?: { user?: ProviderUser | null } | null;
    error?: unknown;
  } | undefined;
  try {
    result = await supabase.auth.getUser();
  } catch (error) {
    return unavailable(
      args.source,
      "lookup_thrown",
      args.requestId,
      providerStatus(error),
    );
  }

  if (result?.error) {
    const status = providerStatus(result.error);
    if (status !== undefined && MISSING_SESSION_STATUSES.has(status)) {
      return { kind: "missing" };
    }
    return unavailable(args.source, "returned_error", args.requestId, status);
  }

  const user = result?.data?.user;
  if (!user) return { kind: "missing" };
  const userId = user.id;
  if (typeof userId !== "string" || userId.length === 0) {
    return unavailable(
      args.source,
      "invalid_user",
      args.requestId,
      undefined,
    );
  }

  return { kind: "resolved", principal: resolvedPrincipal(user, userId) };
}
