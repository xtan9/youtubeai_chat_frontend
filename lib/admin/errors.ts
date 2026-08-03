/**
 * Recognized data-source failure for server-side Admin reads.
 *
 * The admin error boundary already recognizes the historical `QueryError`
 * name. Keep that stable while allowing narrow capabilities to share the
 * error type without importing the retired query module.
 */
export class QueryError extends Error {
  readonly scope: string;

  constructor(scope: string, detail: string) {
    super(`[admin-queries:${scope}] ${detail}`);
    this.name = "QueryError";
    this.scope = scope;
  }
}
