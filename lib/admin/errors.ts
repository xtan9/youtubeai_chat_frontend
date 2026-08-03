import "server-only";

export class QueryError extends Error {
  constructor(scope: string, detail: string) {
    super(`[admin-report:${scope}] ${detail}`);
    this.name = "QueryError";
  }
}
