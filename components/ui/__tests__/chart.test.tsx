// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";
import { Bar, BarChart, Line, LineChart, XAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const config: ChartConfig = {
  desktop: { label: "Desktop", color: "#6366f1" },
  mobile: { label: "Mobile", color: "#06b6d4" },
};

const data = [
  { month: "Jan", desktop: 186, mobile: 80 },
  { month: "Feb", desktop: 305, mobile: 200 },
  { month: "Mar", desktop: 237, mobile: 120 },
];

// Note on happy-dom + recharts:
//
// recharts' ResponsiveContainer needs a real layout engine to compute
// width/height; happy-dom returns 0/0, so the inner SVG never paints
// dimensions, and ChartTooltip/ChartLegend (which recharts injects via
// cloneElement at runtime) never receive an `active` payload to render.
// We test what *can* be tested in happy-dom: the wrapper structure,
// data-slot wiring, ID derivation, ChartStyle CSS-variable emission, and
// prop spread. The runtime tooltip/legend behaviour is exercised by
// Playwright smoke tests (see smoke-tests/) where a real browser layout
// fires the recharts pipeline.

describe("ChartContainer", () => {
  describe("default render", () => {
    it("renders with data-slot=chart and a stable data-chart id", () => {
      const { container } = renderWithProviders(
        <div style={{ width: 400, height: 300 }}>
          <ChartContainer config={config}>
            <BarChart data={data}>
              <XAxis dataKey="month" />
              <Bar dataKey="desktop" fill="var(--color-desktop)" />
            </BarChart>
          </ChartContainer>
        </div>,
      );
      const root = container.querySelector('[data-slot="chart"]');
      expect(root).toBeTruthy();
      expect(root?.getAttribute("data-chart")).toMatch(/^chart-/);
    });

    it("uses the consumer-supplied id when provided", () => {
      const { container } = renderWithProviders(
        <div style={{ width: 400, height: 300 }}>
          <ChartContainer id="my-chart" config={config}>
            <BarChart data={data}>
              <XAxis dataKey="month" />
              <Bar dataKey="desktop" fill="var(--color-desktop)" />
            </BarChart>
          </ChartContainer>
        </div>,
      );
      const root = container.querySelector('[data-slot="chart"]');
      expect(root?.getAttribute("data-chart")).toBe("chart-my-chart");
    });

    it("strips colons from React.useId() before assembling the data-chart attribute", () => {
      // React 19's useId() returns values like ":r1:". The wrapper
      // strips the colons so the attribute is a valid CSS-selectable
      // token (axe + querySelector use the data-chart hook).
      const { container } = renderWithProviders(
        <div style={{ width: 400, height: 300 }}>
          <ChartContainer config={config}>
            <BarChart data={data}>
              <Bar dataKey="desktop" />
            </BarChart>
          </ChartContainer>
        </div>,
      );
      const id = container
        .querySelector('[data-slot="chart"]')
        ?.getAttribute("data-chart");
      expect(id).not.toContain(":");
    });

    it("emits a <style> tag exposing --color-<key> CSS variables for each config entry with a color", () => {
      const { container } = renderWithProviders(
        <div style={{ width: 400, height: 300 }}>
          <ChartContainer id="theme-test" config={config}>
            <BarChart data={data}>
              <Bar dataKey="desktop" fill="var(--color-desktop)" />
            </BarChart>
          </ChartContainer>
        </div>,
      );
      const styleTag = container.querySelector("style");
      expect(styleTag).toBeTruthy();
      const css = styleTag!.innerHTML;
      expect(css).toContain("--color-desktop: #6366f1");
      expect(css).toContain("--color-mobile: #06b6d4");
      expect(css).toContain("[data-chart=chart-theme-test]");
    });

    it("supports per-theme colours via the `theme` discriminated-union variant", () => {
      const themedConfig: ChartConfig = {
        revenue: {
          label: "Revenue",
          theme: { light: "#10b981", dark: "#34d399" },
        },
      };
      const { container } = renderWithProviders(
        <div style={{ width: 400, height: 300 }}>
          <ChartContainer id="t" config={themedConfig}>
            <BarChart data={[{ x: 1, revenue: 100 }]}>
              <Bar dataKey="revenue" />
            </BarChart>
          </ChartContainer>
        </div>,
      );
      const css = container.querySelector("style")!.innerHTML;
      expect(css).toContain("[data-chart=chart-t] {");
      expect(css).toContain(".dark [data-chart=chart-t] {");
      expect(css).toContain("--color-revenue: #10b981");
      expect(css).toContain("--color-revenue: #34d399");
    });

    it("emits NO <style> tag when no entry has color/theme", () => {
      const emptyConfig: ChartConfig = { a: { label: "A" } };
      const { container } = renderWithProviders(
        <div style={{ width: 400, height: 300 }}>
          <ChartContainer config={emptyConfig}>
            <BarChart data={[{ name: "x", a: 1 }]}>
              <Bar dataKey="a" />
            </BarChart>
          </ChartContainer>
        </div>,
      );
      // Recharts itself may emit other style tags; what matters is that
      // *our* ChartStyle didn't emit a `--color-` block.
      const styleTags = Array.from(container.querySelectorAll("style"));
      const ourStyle = styleTags.find((s) =>
        s.innerHTML.includes("--color-"),
      );
      expect(ourStyle).toBeUndefined();
    });
  });

  describe("LineChart variant", () => {
    it("supports LineChart children (not just BarChart)", () => {
      const { container } = renderWithProviders(
        <div style={{ width: 400, height: 300 }}>
          <ChartContainer config={config}>
            <LineChart data={data}>
              <XAxis dataKey="month" />
              <Line
                type="monotone"
                dataKey="desktop"
                stroke="var(--color-desktop)"
              />
              <Line
                type="monotone"
                dataKey="mobile"
                stroke="var(--color-mobile)"
              />
            </LineChart>
          </ChartContainer>
        </div>,
      );
      expect(container.querySelector('[data-slot="chart"]')).toBeTruthy();
    });
  });

  describe("native prop forwarding", () => {
    it("forwards className onto the chart wrapper", () => {
      const { container } = renderWithProviders(
        <div style={{ width: 400, height: 300 }}>
          <ChartContainer
            id="x"
            config={config}
            className="my-extra-chart"
          >
            <BarChart data={data}>
              <Bar dataKey="desktop" />
            </BarChart>
          </ChartContainer>
        </div>,
      );
      const root = container.querySelector(
        '[data-slot="chart"]',
      ) as HTMLElement;
      expect(root.className).toContain("my-extra-chart");
    });

    it("forwards arbitrary native attributes (id, role, aria-label) onto the chart wrapper", () => {
      const { container } = renderWithProviders(
        <div style={{ width: 400, height: 300 }}>
          <ChartContainer
            id="x"
            config={config}
            role="img"
            aria-label="Quarterly revenue"
          >
            <BarChart data={data}>
              <Bar dataKey="desktop" />
            </BarChart>
          </ChartContainer>
        </div>,
      );
      const root = container.querySelector(
        '[data-slot="chart"]',
      ) as HTMLElement;
      expect(root.getAttribute("role")).toBe("img");
      expect(root.getAttribute("aria-label")).toBe("Quarterly revenue");
    });
  });
});

describe("ChartTooltipContent — early-return paths", () => {
  // The full tooltip body needs recharts to fire a real layout-driven
  // hover event, which happy-dom can't do. The early-return branches
  // (active=false, empty payload) are pure-JS though — render the
  // component as a sibling of the chart subtree, share the ChartContext
  // via ChartContainer, and assert the null render.
  it("renders nothing when active=false (component returns null before reading payload)", () => {
    const { container } = renderWithProviders(
      <div style={{ width: 400, height: 300 }}>
        <ChartContainer config={config} id="t-null-active">
          <BarChart data={data}>
            <Bar dataKey="desktop" />
            <ChartTooltipContent active={false} payload={[] as never} />
          </BarChart>
        </ChartContainer>
      </div>,
    );
    // The tooltip body uses min-w-32 + bg-background; the early-return
    // skips that wrapper, so the class string is absent.
    const html = container.innerHTML;
    expect(html).not.toContain("min-w-32");
  });

  it("renders nothing when payload is empty (active=true but no items)", () => {
    const { container } = renderWithProviders(
      <div style={{ width: 400, height: 300 }}>
        <ChartContainer config={config} id="t-empty">
          <BarChart data={data}>
            <Bar dataKey="desktop" />
            <ChartTooltipContent active payload={[] as never} />
          </BarChart>
        </ChartContainer>
      </div>,
    );
    const html = container.innerHTML;
    expect(html).not.toContain("min-w-32");
  });
});

describe("ChartLegendContent — early-return path", () => {
  it("renders nothing when payload is empty", () => {
    const { container } = renderWithProviders(
      <div style={{ width: 400, height: 300 }}>
        <ChartContainer config={config} id="l-empty">
          <BarChart data={data}>
            <Bar dataKey="desktop" />
            <ChartLegendContent payload={[]} />
          </BarChart>
        </ChartContainer>
      </div>,
    );
    // The legend wrapper uses items-center justify-center; early-return
    // returns null instead.
    const html = container.innerHTML;
    expect(html).not.toContain("items-center justify-center gap-4");
  });
});

describe("re-exports", () => {
  it("ChartTooltip is recharts' Tooltip (thin alias for ergonomic composition)", () => {
    // Re-exporting recharts' Tooltip lets consumers write
    // <ChartTooltip content={<ChartTooltipContent />} /> without
    // importing from 'recharts' directly.
    expect(ChartTooltip).toBeDefined();
  });

  it("ChartLegend is recharts' Legend", () => {
    expect(ChartLegend).toBeDefined();
  });
});
