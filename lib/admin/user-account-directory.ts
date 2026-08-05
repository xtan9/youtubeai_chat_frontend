import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSmokeAccount } from "@/lib/auth/smoke-account";
import { QueryError } from "./errors";

const USER_ACCOUNT_ROW_CAP_DEFAULT = 5_000;
const USER_ACCOUNT_PAGE_SIZE = 200;

/** The account data shared by Admin reports and administrator reconciliation. */
export interface UserAccount {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  bannedUntil: string | null;
  deletedAt: string | null;
  isAnonymous: boolean;
  isSsoUser: boolean;
  /** Derived only from the trusted service-managed app_metadata marker. */
  isSmokeAccount: boolean;
  providers: string[];
  appMetadata: Record<string, unknown>;
  userMetadata: Record<string, unknown>;
  /** Mirrors auth.users.app_metadata.is_admin. */
  isAdministrator: boolean;
}

export interface UserAccountDirectoryOptions {
  /** Maximum number of accounts to retain from the paginated enumeration. */
  rowCap?: number;
}

export interface UserAccountDirectoryResult {
  users: UserAccount[];
  /** Provider-reported total from the first page, when available. */
  total: number;
  /** True when the configured row cap prevented a complete enumeration. */
  truncated: boolean;
}

/**
 * Return the account IDs excluded from business-activity reports.
 *
 * Smoke Accounts are always synthetic, even when a report explicitly includes
 * administrator activity. Administrator exclusion remains opt-in so existing
 * report behavior is preserved for non-Smoke accounts.
 */
export function getExcludedBusinessActivityUserIds(
  users: readonly Pick<
    UserAccount,
    "id" | "isAdministrator" | "isSmokeAccount"
  >[],
  includeAdministrators: boolean,
): string[] {
  return users
    .filter(
      (user) =>
        user.isSmokeAccount ||
        (!includeAdministrators && user.isAdministrator),
    )
    .map((user) => user.id);
}

interface AuthUserRecord {
  id: string;
  email?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
  banned_until?: string | null;
  deleted_at?: string | null;
  is_anonymous?: boolean;
  is_sso_user?: boolean;
  identities?: Array<{ provider?: string }>;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

function effectiveRowCap(rowCap: number | undefined): number {
  if (rowCap === undefined || !Number.isFinite(rowCap)) {
    return USER_ACCOUNT_ROW_CAP_DEFAULT;
  }
  return Math.max(1, Math.floor(rowCap));
}

function mapUserAccount(user: AuthUserRecord): UserAccount {
  const appMetadata = user.app_metadata ?? {};
  const providers = Array.from(
    new Set(
      (user.identities ?? [])
        .map((identity) => identity.provider)
        .filter((provider): provider is string => Boolean(provider)),
    ),
  );

  return {
    id: user.id,
    email: user.email ?? null,
    createdAt: user.created_at ?? "",
    lastSignInAt: user.last_sign_in_at ?? null,
    emailConfirmedAt: user.email_confirmed_at ?? null,
    bannedUntil: user.banned_until ?? null,
    deletedAt: user.deleted_at ?? null,
    isAnonymous: user.is_anonymous === true,
    isSsoUser: user.is_sso_user === true,
    isSmokeAccount: isSmokeAccount({ app_metadata: appMetadata }),
    providers,
    appMetadata,
    userMetadata: user.user_metadata ?? {},
    isAdministrator: appMetadata.is_admin === true,
  };
}

async function listUserAccountsUncached(
  client: SupabaseClient,
  rowCap: number,
): Promise<UserAccountDirectoryResult> {
  const users: UserAccount[] = [];
  let total = 0;
  let truncated = false;

  for (let page = 1; ; page += 1) {
    try {
      const response = await client.auth.admin.listUsers({
        page,
        perPage: USER_ACCOUNT_PAGE_SIZE,
      });
      const data = response.data as unknown as {
        users?: AuthUserRecord[];
        total?: number;
      } | null;
      const error = response.error as { message: string } | null;
      if (error) throw new QueryError("listUserAccounts", error.message);

      const pageUsers = Array.isArray(data?.users) ? data.users : [];
      if (page === 1) total = data?.total ?? pageUsers.length;

      for (const user of pageUsers) {
        if (users.length >= rowCap) {
          truncated = true;
          break;
        }
        users.push(mapUserAccount(user));
      }

      if (truncated || pageUsers.length < USER_ACCOUNT_PAGE_SIZE) break;
    } catch (cause) {
      if (cause instanceof QueryError) throw cause;
      throw new QueryError(
        "listUserAccounts",
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }

  if (truncated) {
    console.warn("[user-account-directory] account enumeration cap reached", {
      rowCap,
      total,
    });
  }

  return { users, total, truncated };
}

/**
 * Request-scoped account enumeration. The cache key uses the effective row
 * cap rather than the options object identity, so equivalent option objects
 * share one pagination pass. React's cache is request-scoped; this module
 * deliberately keeps no process-wide account data.
 */
const listUserAccountsForRequest = cache(
  (client: SupabaseClient, rowCap: number) =>
    listUserAccountsUncached(client, rowCap),
);

/**
 * Enumerate User Accounts through the server-only auth-admin boundary.
 *
 * This is the sole Directory capability. Callers receive mapped account
 * records plus provider total/truncation metadata, not the low-level auth
 * pagination protocol.
 */
export function listUserAccounts(
  client: SupabaseClient,
  options: UserAccountDirectoryOptions = {},
): Promise<UserAccountDirectoryResult> {
  return listUserAccountsForRequest(client, effectiveRowCap(options.rowCap));
}
