import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import pluginQuery from "@tanstack/eslint-plugin-query";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...pluginQuery.configs["flat/recommended"],
  {
    // eslint-config-next 16 ships eslint-plugin-react-hooks rules that flag
    // existing patterns in our React 19 codebase (setState-in-effect,
    // purity, setState-in-render). These rules are correct as guidance for
    // new code, but addressing them is a refactor, not a dependency upgrade
    // — out of scope for A1 PR 1 per the design spec ("Only existing deps
    // get bumped. No architecture changes."). They will be revisited when
    // the design-system rebuild (B) lands. Demoting to off keeps the
    // upgrade clean while leaving the rules ready to re-enable.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/set-state-in-render": "off",
      "react-hooks/purity": "off",
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
