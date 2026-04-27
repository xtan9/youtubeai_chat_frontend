# Contributing to youtubeai_chat_frontend

## Testing

We use a Testing Trophy: heavy E2E + integration, thin unit layer for pure logic.

### What test goes where

| Change you're making | Required test | Where |
|---|---|---|
| New API route under `app/api/**` | Integration test (real handler + real Zod; mock the service modules it composes via `vi.mock()`) | `app/api/<route>/__tests__/route.test.ts` |
| New `lib/services/*` HTTP-calling module | Integration test (real composition; mock `globalThis.fetch` via `vi.stubGlobal("fetch", vi.fn())`) | `lib/services/__tests__/<name>.test.ts` |
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

CI enforces coverage floors defined in `vitest.config.ts`. The floor is a *regression alarm*, not a target. If it fires on a PR that legitimately should not be raising coverage, lower the floor or expand exclusions in `vitest.config.ts` — do not write filler tests.

### Mocking altitude

- **E2E** (Playwright): real Supabase auth, real VPS, real LLM on the happy path. Use `page.route()` only for conditions the real stack cannot reliably reproduce (network errors, rate-limit responses, malformed upstream payloads).
- **Integration** (Vitest): real route handlers, real Zod schemas, real composition. Mock at the `fetch` boundary using `vi.stubGlobal("fetch", vi.fn())`. Mock the Supabase admin client when used.
- **Unit** (Vitest): pure logic only. Mock everything else.

### Activating happy-dom for hook tests

Vitest defaults to a Node environment. Hook tests (`renderHook`) need a DOM. Activate happy-dom per-test by adding the pragma at the top of the test file:

```ts
// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
// ...
```

This keeps all other tests on the faster Node environment.
