import { cleanup, render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach } from "vitest";

import { ThemeProvider } from "@/lib/providers/theme-provider";

// Vitest doesn't enable global auto-cleanup unless `globals: true` is set,
// which we don't use. Wire up cleanup for any test file that imports this
// helper so the DOM is reset between cases.
afterEach(() => {
  cleanup();
});

/**
 * Wraps render() with the app's standard providers so components rendered
 * in tests match their runtime context. Currently only ThemeProvider is
 * required for the design-system surface; expand if a future cluster needs
 * QueryClient or UserContext.
 *
 * Forces a deterministic light theme by default — set `defaultTheme` to
 * "dark" to exercise dark-mode token resolution.
 */
type RenderWithProvidersOptions = RenderOptions & {
  defaultTheme?: "light" | "dark";
};

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
) {
  const { defaultTheme = "light", ...rest } = options;
  return render(ui, {
    wrapper: ({ children }) => (
      <ThemeProvider
        attribute="class"
        defaultTheme={defaultTheme}
        enableSystem={false}
        disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
    ),
    ...rest,
  });
}

export * from "@testing-library/react";
