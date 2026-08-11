type ReadinessEnvironment = Readonly<Record<string, string | undefined>>;

export type DisposableReadinessDatabase = Readonly<{
  databaseUrl: string;
  databaseName: string;
  hostname: string;
}>;

const DISPOSABLE_DATABASE_NAME = /^project_readiness_[a-z0-9_]{1,48}$/u;
const SAFE_CHILD_ENVIRONMENT_KEYS = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
] as const;

/**
 * Fail closed before any mutating psql fixture can spawn. A boolean alone is
 * intentionally insufficient: URL, decoded database name, host allowlist,
 * name allowlist, and disposable naming convention must all agree exactly.
 */
export function resolveDisposableReadinessDatabase(
  environment: ReadinessEnvironment,
): DisposableReadinessDatabase {
  if (environment.PROJECT_READINESS_ALLOW_DATABASE_FIXTURES !== "true") {
    invalidDisposableTarget();
  }

  const databaseUrl = environment.PROJECT_READINESS_DATABASE_URL?.trim();
  const databaseName = environment.PROJECT_READINESS_DATABASE_NAME?.trim();
  const allowedHosts = commaSeparatedSet(
    environment.PROJECT_READINESS_DATABASE_HOST_ALLOWLIST,
  );
  const allowedNames = commaSeparatedSet(
    environment.PROJECT_READINESS_DATABASE_NAME_ALLOWLIST,
  );
  if (!databaseUrl) invalidDisposableTarget();
  if (!databaseName) invalidDisposableTarget();
  if (!DISPOSABLE_DATABASE_NAME.test(databaseName)) invalidDisposableTarget();

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    invalidDisposableTarget();
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    invalidDisposableTarget();
  }
  // libpq treats URI query parameters as connection settings. Even when the
  // visible host/path are allowlisted, `host`, `hostaddr`, `dbname`, or
  // `service` can redirect psql. A readiness fixture needs no query options,
  // so reject the entire override surface rather than maintaining a fragile
  // parameter denylist.
  if (parsed.search || parsed.hash) invalidDisposableTarget();
  const urlDatabaseName = decodeURIComponent(parsed.pathname.replace(/^\/+|\/+$/gu, ""));
  if (
    !parsed.hostname ||
    urlDatabaseName !== databaseName ||
    !allowedHosts.has(parsed.hostname.toLocaleLowerCase()) ||
    !allowedNames.has(databaseName)
  ) {
    invalidDisposableTarget();
  }

  return { databaseUrl, databaseName, hostname: parsed.hostname };
}

/**
 * Build the complete environment for a mutating psql child. Starting from an
 * allowlist is intentional: libpq has many target and service environment
 * variables, so attempting to delete known names can fail open when one is
 * missed (for example PGHOSTADDR).
 */
export function buildDisposableReadinessPsqlEnvironment(
  environment: ReadinessEnvironment,
  target: DisposableReadinessDatabase,
): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {
    NODE_ENV: environment.NODE_ENV === "development" ? "development" : "production",
  };
  for (const key of SAFE_CHILD_ENVIRONMENT_KEYS) {
    const value = environment[key];
    if (value !== undefined) childEnvironment[key] = value;
  }
  childEnvironment.PGDATABASE = target.databaseUrl;
  return childEnvironment;
}

function invalidDisposableTarget(): never {
  throw new Error(
    "A positively allowlisted disposable Project readiness database is required",
  );
}

function commaSeparatedSet(raw: string | undefined) {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim().toLocaleLowerCase())
      .filter(Boolean),
  );
}
