# Contributing to youtubeai_chat_frontend

## Testing

We use a Testing Trophy: heavy E2E + integration, thin unit layer for pure logic.

### What test goes where

| Change you're making | Required test | Where |
|---|---|---|
| New API route under `app/api/**` | Integration test (real handler, real Zod, mocked `globalThis.fetch` via `vi.fn()`) | `app/api/<route>/__tests__/route.test.ts` |
| New `lib/services/*` module | Integration test if it composes other modules; unit test if pure | `lib/services/__tests__/<name>.test.ts` |
| New `lib/hooks/*` with state or side-effects | Unit test (renderHook, happy-dom env) | `lib/hooks/__tests__/<name>.test.ts` |
| New user-visible flow (anything routable a user reaches) | E2E spec | `smoke-tests/e2e-<name>.spec.ts` |
| New `components/*` (non-`ui/`) component with non-trivial logic | Optional unit test; rely on E2E for the flow | colocated `__tests__/` |
| Bug fix | Regression test at the lowest tier that exercises the fix | as above |

### Running tests

```bash
pnpm test               # vitest unit + integration
pnpm test --coverage    # with coverage gate (matches CI)
pnpm test:watch         # interactive
pnpm smoke:api          # production API smoke (Node script)
pnpm smoke:e2e          # Playwright E2E
```

### Coverage policy

CI enforces a floor (currently 50% lines / 40% branches / 50% functions / 50% statements). The floor is a *regression alarm*, not a target. If it fires on a PR that legitimately should not be raising coverage, lower the floor or expand exclusions in `vitest.config.ts` — do not write filler tests.

### Mocking altitude

- **E2E** (Playwright): real Supabase auth, real VPS, real LLM on the happy path. Use `page.route()` only to simulate network failures the real stack cannot reliably reproduce.
- **Integration** (Vitest): real route handlers, real Zod schemas, real composition. Mock at the `fetch` boundary using `vi.stubGlobal("fetch", vi.fn())`. Mock the Supabase admin client when used.
- **Unit** (Vitest): pure logic only. Mock everything else.
