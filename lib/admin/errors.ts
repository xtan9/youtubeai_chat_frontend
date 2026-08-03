export class QueryError extends Error {
  constructor(scope: string, detail: string) {
    super(`[admin-queries:${scope}] ${detail}`);
    this.name = "QueryError";
  }
}
