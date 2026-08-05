// Assertion helpers shared by api-smoke (Node script) and the Playwright
// e2e spec. Keep free of runtime-specific imports so both environments can
// load this module without bundling surprises.

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isSmokeAccount } from "../lib/auth/smoke-account";

// Arabic block + Arabic Supplement + Arabic Extended-A + Presentation
// Forms A/B. YouTube captions have been observed to use presentation
// forms (shaped glyphs) on older content, so catching just the basic
// block risks missing a regression that happens to use a different
// codepoint range.
const ARABIC_RANGE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

// French function words without English homographs. Earlier versions
// included le/la/pour — all of which are real English words ("pour
// water", "La La Land") — so the same helper applied to UI body text
// false-positived. Current set is intentionally narrow: every token
// here is either a French grammatical word with no English meaning or
// contains a diacritic that pins it to French.
const FRENCH_ANCHORS =
  /\b(les|je|est|vous|nous|que|des|avec|sont|très|était|étaient|êtes|c'est|n'est)\b/i;

export function hasArabicChars(text: string): boolean {
  return ARABIC_RANGE.test(text);
}

export function hasFrenchAnchors(text: string): boolean {
  return FRENCH_ANCHORS.test(text);
}

export type CredSource = "env" | "file";

export type SmokeCreds = {
  email: string;
  password: string;
  source: CredSource;
};

export type AdminCreds = SmokeCreds & {
  supabaseUrl: string;
  secretKey: string;
};

export class SmokeAccountVerificationError extends Error {
  constructor() {
    super("Production smoke requires an authenticated, marked Smoke Account");
    this.name = "SmokeAccountVerificationError";
  }
}

type AuthWithGetUser = Pick<SupabaseClient["auth"], "getUser">;

/**
 * Fetch the account behind an authenticated session and require the trusted
 * service-managed marker before a destructive smoke operation can continue.
 */
export async function assertTrustedSmokeAccount(
  auth: AuthWithGetUser,
): Promise<User> {
  const { data, error } = await auth.getUser();
  const user = data?.user;
  if (error || !user || !isSmokeAccount(user)) {
    throw new SmokeAccountVerificationError();
  }
  return user;
}

export async function withTrustedSmokeAccount<T>(
  auth: AuthWithGetUser,
  mutation: (user: User) => Promise<T> | T,
): Promise<T> {
  const user = await assertTrustedSmokeAccount(auth);
  return mutation(user);
}

/**
 * Authenticate a smoke credential pair, then fetch the authenticated account
 * through Auth before returning it. The secret key is used only in this
 * server-side/CI helper; it is never sent to the application browser.
 */
export async function authenticateAndAssertSmokeAccount(
  creds: AdminCreds,
  password: string = creds.password,
): Promise<User> {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(creds.supabaseUrl, creds.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email: creds.email,
    password,
  });
  if (error) throw new SmokeAccountVerificationError();
  return assertTrustedSmokeAccount(client.auth);
}

export async function restoreSmokeAccountPassword(
  creds: AdminCreds,
  currentPassword: string,
): Promise<void> {
  const user = await authenticateAndAssertSmokeAccount(creds, currentPassword);
  const admin = await getAdminClient(creds);
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password: creds.password,
  });
  if (error) throw new Error("Smoke Account password restoration failed");
}

// Resolve the dedicated non-administrator Smoke Account credentials with a
// strict precedence:
//   1. TEST_NON_ADMIN_EMAIL / TEST_NON_ADMIN_PASSWORD (production CI path)
//   2. TEST_USER_EMAIL / TEST_USER_PASSWORD (legacy/local compatibility path)
//   3. ~/.config/claude-test-creds/youtubeai.env (local dev path)
// Returns null when neither source is usable — callers decide whether to
// skip or hard-fail.
export async function loadSmokeCreds(): Promise<SmokeCreds | null> {
  const smokeEmail = process.env.TEST_NON_ADMIN_EMAIL?.trim();
  const smokePassword = process.env.TEST_NON_ADMIN_PASSWORD?.trim();
  if (smokeEmail || smokePassword) {
    if (!smokeEmail || !smokePassword) return null;
    return { email: smokeEmail, password: smokePassword, source: "env" };
  }

  const legacyEmail = process.env.TEST_USER_EMAIL?.trim();
  const legacyPassword = process.env.TEST_USER_PASSWORD?.trim();
  if (legacyEmail && legacyPassword) {
    return { email: legacyEmail, password: legacyPassword, source: "env" };
  }

  const { readFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const credPath = path.join(
    os.homedir(),
    ".config/claude-test-creds/youtubeai.env"
  );
  let raw: string;
  try {
    raw = await readFile(credPath, "utf8");
  } catch {
    return null;
  }
  const parsed = parseEnvFile(raw);
  const email = parsed.TEST_USER_EMAIL?.trim();
  const password = parsed.TEST_USER_PASSWORD?.trim();
  if (!email || !password) return null;
  return { email, password, source: "file" };
}

// Minimal dotenv-style parser. Strips `export` prefix, surrounding quotes,
// and inline `#` comments. Good enough for the one credential file we own;
// not intended as a general .env replacement.
export function parseEnvFile(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.startsWith("export ") ? line.slice(7) : line;
    const eq = stripped.indexOf("=");
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    let value = stripped.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// --- Admin helpers (E2E auth specs) -----------------------------------

/**
 * Same as `loadSmokeCreds` but additionally requires SUPABASE_URL +
 * SUPABASE_SECRET_KEY (Supabase's new API key system; the legacy
 * SUPABASE_SERVICE_ROLE_KEY is being deprecated). Returns null if
 * either is missing — auth E2E specs should `test.skip` in that case.
 */
export async function loadAdminCreds(): Promise<AdminCreds | null> {
  const base = await loadSmokeCreds();
  if (!base) return null;

  const fromEnv = (k: string) => process.env[k]?.trim();
  let supabaseUrl = fromEnv("SUPABASE_URL");
  let secretKey = fromEnv("SUPABASE_SECRET_KEY");

  if (!supabaseUrl || !secretKey) {
    const { readFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const credPath = path.join(
      os.homedir(),
      ".config/claude-test-creds/youtubeai.env"
    );
    let raw: string;
    try {
      raw = await readFile(credPath, "utf8");
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      // ENOENT (file genuinely absent) is the silent-skip path. Anything
      // else (EACCES, EISDIR, ...) deserves a warning so devs know why
      // their auth tests are skipping — without surfacing the path users
      // are configuring permissions wrong on, debugging is hopeless.
      if (code !== "ENOENT") {
        console.warn(
          `[loadAdminCreds] could not read ${credPath}: ${
            code ?? "unknown"
          } — ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return null;
    }
    // parseEnvFile is synchronous and pure; intentionally outside the
    // catch above so a parser bug surfaces as an exception instead of
    // being swallowed as "file absent".
    const parsed = parseEnvFile(raw);
    supabaseUrl = supabaseUrl || parsed.SUPABASE_URL?.trim();
    secretKey = secretKey || parsed.SUPABASE_SECRET_KEY?.trim();
  }

  if (!supabaseUrl || !secretKey) return null;
  return { ...base, supabaseUrl, secretKey };
}

/**
 * Resolve the dedicated administrator Smoke Account for the serial session
 * policy journey. This intentionally requires the explicit admin pair and
 * never falls back to the non-admin or legacy credential names.
 */
export async function loadAdminSmokeCreds(): Promise<AdminCreds | null> {
  const email = process.env.TEST_ADMIN_EMAIL?.trim();
  const password = process.env.TEST_ADMIN_PASSWORD?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!email || !password || !supabaseUrl || !secretKey) return null;
  return {
    email,
    password,
    source: "env",
    supabaseUrl,
    secretKey,
  };
}

// Cached admin client. Built lazily so test files that don't need it
// never construct it.
let cachedAdmin: SupabaseClient | null = null;

export async function getAdminClient(creds: AdminCreds): Promise<SupabaseClient> {
  if (cachedAdmin) return cachedAdmin;
  const { createClient } = await import("@supabase/supabase-js");
  cachedAdmin = createClient(creds.supabaseUrl, creds.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedAdmin;
}

/**
 * Generate a recovery (password-reset) confirm URL for an existing user.
 * Bypasses real email — instead of following the Supabase action_link (which
 * uses the implicit hash flow and can lose the token on www↔non-www redirects),
 * we extract the hashed_token and build a direct link to the app's
 * /auth/confirm route. That route uses verifyOtp (PKCE-compatible) and
 * redirects to `next`.
 *
 * @param creds    Admin credentials (includes supabaseUrl + secretKey)
 * @param email    The account to generate a recovery token for
 * @param appRoot  The app origin (e.g. "https://www.youtubeai.chat")
 * @param next     Path to redirect to after token exchange (default "/auth/update-password")
 */
export async function generateRecoveryLink(
  creds: AdminCreds,
  email: string,
  appRoot?: string,
  next: string = "/auth/update-password"
): Promise<string> {
  const admin = await getAdminClient(creds);
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  if (error) throw error;
  const hashedToken = data?.properties?.hashed_token;
  if (!hashedToken) throw new Error("admin.generateLink returned no hashed_token");
  const root = appRoot?.replace(/\/$/, "") ?? "https://www.youtubeai.chat";
  return `${root}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=recovery&next=${encodeURIComponent(next)}`;
}

/**
 * Generate the actual Supabase verify URL the recovery email would contain.
 * Unlike `generateRecoveryLink` (which builds a synthetic /auth/confirm
 * URL using the hashed_token + token_hash verifyOtp path), this returns
 * `data.properties.action_link` — the same `<supabase>/auth/v1/verify?token=...&type=recovery&redirect_to=<...>`
 * URL Supabase embeds in the production email. Following it exercises the
 * real implicit-grant flow: Supabase verify → 303 to <redirectTo> with
 * `#access_token=...` in the fragment → page mount → browser SDK detects
 * fragment → session active. The redirectTo is what we'd produce in code:
 * apex origin + /auth/update-password.
 *
 * Calling this consumes a real recovery token for the user. Wrap the test
 * in try/finally with an admin password restore.
 */
export async function getProductionRecoveryActionLink(
  creds: AdminCreds,
  email: string,
  redirectTo: string
): Promise<string> {
  const admin = await getAdminClient(creds);
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });
  if (error) throw error;
  const actionLink = data?.properties?.action_link;
  if (!actionLink) throw new Error("admin.generateLink returned no action_link");
  return actionLink;
}

/**
 * Delete a user by email. Used in test teardown to keep randomized
 * signup users from accumulating. Paginates listUsers since admin
 * doesn't expose getUserByEmail. No-op if the user does not exist
 * after exhausting all pages.
 */
export async function deleteUserByEmail(
  creds: AdminCreds,
  email: string
): Promise<void> {
  const admin = await getAdminClient(creds);
  for (let pg = 1; ; pg++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page: pg,
      perPage: 1000,
    });
    if (error) throw error;
    const match = data.users.find((u) => u.email === email);
    if (match) {
      const { error: delErr } = await admin.auth.admin.deleteUser(match.id);
      if (delErr) throw delErr;
      return;
    }
    if (data.users.length < 1000) return; // exhausted all pages
  }
}
