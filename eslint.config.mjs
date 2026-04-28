import { defineConfig, globalIgnores } from "eslint/config";
import { fixupConfigRules } from "@eslint/compat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import pluginQuery from "@tanstack/eslint-plugin-query";

// ESLint 10 removed legacy rule-context APIs (context.getFilename(),
// context.getSourceCode(), etc.). eslint-config-next@16.2.x still pulls in
// eslint-plugin-react@7.37.5, which calls those removed methods. Until the
// upstream fix in jsx-eslint/eslint-plugin-react#3979 ships in a release that
// eslint-config-next picks up, we wrap the Next configs with @eslint/compat's
// fixupConfigRules() — the ESLint-team-published shim that retrofits the
// removed APIs onto legacy plugins. Tracking issue: vercel/next.js#89764.
const eslintConfig = defineConfig([
  ...fixupConfigRules(nextVitals),
  ...fixupConfigRules(nextTs),
  ...pluginQuery.configs["flat/recommended"],
  {
    // eslint-config-next 16 ships eslint-plugin-react-hooks rules that
    // were disabled in A1 PR 1 to keep the dependency-upgrade PR clean.
    // B PR 6 (composites cluster) re-enables them: every offending
    // file in the components/ui/ cluster + hooks/use-mobile.ts has been
    // refactored to satisfy the rule (typically by moving from
    // setState-in-effect to useSyncExternalStore, or from useMemo to
    // useState's lazy initializer for pure-state). A handful of
    // app/-level offenders carry narrow per-line suppressions with
    // TODOs pending their own refactor — see
    // docs/design-system/components/composites/index.mdx for the
    // catalogue.
    rules: {
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/set-state-in-render": "error",
      "react-hooks/purity": "error",
    },
  },
  {
    // tailwind.config.ts uses `require()` for legacy plugins
    // (tailwindcss-animate, tailwind-scrollbar). Tailwind 4's new flat
    // config object expects these as CommonJS callables — converting to
    // ESM imports would surface ESM-interop issues with these CJS-only
    // plugins. Allowing require() in the Tailwind config file only.
    files: ["tailwind.config.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The examples/ directory is documentation: deliberately-bad and
    // deliberately-good patterns side by side. Linting it produces noise
    // about unused vars (the bad example *must* exist as code) without
    // surfacing real bugs. `next lint` excluded this folder implicitly;
    // preserving that behavior under the ESLint CLI.
    "examples/**",
  ]),
]);

export default eslintConfig;
