import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    // Playwright owns `smoke-tests/*.spec.ts`. Vitest still runs unit
    // tests nested in `smoke-tests/__tests__/*.test.ts` (helpers).
    exclude: [...configDefaults.exclude, "smoke-tests/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      // Floors are regression alarms, NOT targets. If they fire on an
      // unrelated PR, lower the floor or expand exclusions; do not write
      // filler tests to clear the gate.
      thresholds: {
        lines: 50,
        branches: 40,
        functions: 50,
        statements: 50,
      },
      exclude: [
        ...(configDefaults.coverage.exclude ?? []),
        "components/ui/**",
        "app/**/page.tsx",
        "app/**/layout.tsx",
        "app/auth/**/route.ts",
        "app/sitemap.ts",
        "smoke-tests/**",
        ".next/**",
      ],
    },
  },
});
