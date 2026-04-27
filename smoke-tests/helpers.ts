// Assertion helpers shared by api-smoke (Node script) and the Playwright
// e2e spec. Keep free of runtime-specific imports so both environments can
// load this module without bundling surprises.

import type { SupabaseClient } from "@supabase/supabase-js";

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

// Resolve test account credentials with a strict precedence:
//   1. TEST_USER_EMAIL / TEST_USER_PASSWORD env vars (CI path)
//   2. ~/.config/claude-test-creds/youtubeai.env (local dev path, matches
//      the path documented in user memory)
// Returns null when neither source is usable — callers decide whether to
// skip or hard-fail.
export async function loadSmokeCreds(): Promise<SmokeCreds | null> {
  const envEmail = process.env.TEST_USER_EMAIL?.trim();
  const envPassword = process.env.TEST_USER_PASSWORD?.trim();
  if (envEmail && envPassword) {
    return { email: envEmail, password: envPassword, source: "env" };
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

export type AdminCreds = SmokeCreds & {
  supabaseUrl: string;
  secretKey: string;
};

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
