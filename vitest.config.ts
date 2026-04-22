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
  },
});
