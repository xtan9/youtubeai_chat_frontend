// Assertion helpers shared by api-smoke (Node script) and the Playwright
// e2e spec. Keep free of runtime-specific imports so both environments can
// load this module without bundling surprises.

// Range covers Arabic + Arabic Supplement. If the fix regresses and a
// French video yields Arabic transcripts again, even one character here
// fails the test loudly.
const ARABIC_RANGE = /[\u0600-\u06FF]/;

// Common French function words. Chosen to be short and unambiguous — these
// are too frequent to be absent from a real French transcript, and they
// all share the Latin script so a false positive on accidental Arabic is
// structurally impossible.
const FRENCH_ANCHORS = /\b(le|la|les|je|est|pour|vous|nous|que|des)\b/i;

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
