import type { BrowserContext } from "@playwright/test";

type FetchLike = typeof fetch;

interface ProbeIdentityOptions {
  readonly accessToken: string;
  readonly supabaseUrl: string;
  readonly serviceRoleKey: string;
  readonly fetchImpl?: FetchLike;
}

interface AuthSession {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly [key: string]: unknown;
}

function authHeaders(apiKey: string, bearer: string) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
  };
}

export async function markAnonymousProductionProbe({
  accessToken,
  supabaseUrl,
  serviceRoleKey,
  fetchImpl = fetch,
}: ProbeIdentityOptions): Promise<string> {
  const userResponse = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
    headers: authHeaders(serviceRoleKey, accessToken),
  });
  const user = (await userResponse.json().catch(() => null)) as {
    id?: string;
    is_anonymous?: boolean;
    app_metadata?: Record<string, unknown>;
  } | null;
  if (!userResponse.ok || !user?.id || user.is_anonymous !== true) {
    throw new Error("Production probe identity is not an anonymous user");
  }

  const updateResponse = await fetchImpl(
    `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
    {
      method: "PUT",
      headers: authHeaders(serviceRoleKey, serviceRoleKey),
      body: JSON.stringify({
        app_metadata: {
          ...user.app_metadata,
          is_smoke_account: true,
        },
      }),
    },
  );
  const updated = (await updateResponse.json().catch(() => null)) as {
    id?: string;
    is_anonymous?: boolean;
    app_metadata?: Record<string, unknown>;
  } | null;
  if (
    !updateResponse.ok ||
    updated?.id !== user.id ||
    updated.is_anonymous !== true ||
    updated.app_metadata?.is_smoke_account !== true
  ) {
    throw new Error("Production probe identity could not be marked synthetic");
  }
  return user.id;
}

export async function deleteAnonymousProductionProbe(
  userId: string,
  supabaseUrl: string,
  serviceRoleKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const response = await fetchImpl(
    `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: authHeaders(serviceRoleKey, serviceRoleKey),
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error("Production probe identity cleanup failed");
  }
}

export async function refreshAnonymousProductionProbeSession(
  expectedUserId: string,
  refreshToken: string,
  supabaseUrl: string,
  serviceRoleKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<AuthSession> {
  const response = await fetchImpl(
    `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: authHeaders(serviceRoleKey, serviceRoleKey),
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
  );
  const session = (await response.json().catch(() => null)) as
    | (AuthSession & {
        user?: {
          id?: string;
          is_anonymous?: boolean;
          app_metadata?: Record<string, unknown>;
        };
      })
    | null;
  if (
    !response.ok ||
    !session?.access_token ||
    !session.refresh_token ||
    session.user?.id !== expectedUserId ||
    session.user?.is_anonymous !== true ||
    session.user.app_metadata?.is_smoke_account !== true
  ) {
    throw new Error("Production probe session could not be refreshed as synthetic");
  }
  return session;
}

export async function anonymousSessionFromCookies(
  context: BrowserContext,
): Promise<AuthSession> {
  const cookies = (await context.cookies())
    .filter((cookie) => /^sb-.*-auth-token(?:\.\d+)?$/u.test(cookie.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (cookies.length === 0) throw new Error("Anonymous auth cookie is missing");
  const encoded = decodeURIComponent(cookies.map((cookie) => cookie.value).join(""));
  const raw = encoded.startsWith("base64-")
    ? Buffer.from(encoded.slice("base64-".length), "base64url").toString("utf8")
    : encoded;
  const session = JSON.parse(raw) as {
    access_token?: unknown;
    refresh_token?: unknown;
  };
  if (
    typeof session.access_token !== "string" ||
    session.access_token.length === 0 ||
    typeof session.refresh_token !== "string" ||
    session.refresh_token.length === 0
  ) {
    throw new Error("Anonymous auth cookie has no complete session");
  }
  return session as AuthSession;
}

export async function installAnonymousProductionProbeSession(
  context: BrowserContext,
  session: AuthSession,
): Promise<void> {
  const cookies = (await context.cookies()).filter((cookie) =>
    /^sb-.*-auth-token(?:\.\d+)?$/u.test(cookie.name),
  );
  if (cookies.length === 0) throw new Error("Anonymous auth cookie is missing");
  const template = cookies[0]!;
  const name = template.name.replace(/\.\d+$/u, "");
  await context.clearCookies({ name: /^sb-.*-auth-token(?:\.\d+)?$/u });
  await context.addCookies([
    {
      name,
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
      domain: template.domain,
      path: template.path,
      httpOnly: template.httpOnly,
      secure: template.secure,
      sameSite: template.sameSite,
      expires: template.expires,
    },
  ]);
}
