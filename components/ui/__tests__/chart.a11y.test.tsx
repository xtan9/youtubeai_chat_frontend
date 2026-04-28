// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartLegendContent,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

const config: ChartConfig = {
  desktop: { label: "Desktop", color: "#6366f1" },
  mobile: { label: "Mobile", color: "#06b6d4" },
};

const data = [
  { month: "Jan", desktop: 186, mobile: 80 },
  { month: "Feb", desktop: 305, mobile: 200 },
  { month: "Mar", desktop: 237, mobile: 120 },
];

describe("Chart a11y", () => {
  it("BarChart with config + tooltip has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        {/* Recharts inserts an SVG with internal aria semantics; chart
            wrappers themselves are decorative containers. The
            ResponsiveContainer needs a sized parent in happy-dom. */}
        <div style={{ width: 400, height: 300 }}>
          <ChartContainer
            config={config}
            role="img"
            aria-label="Visitors per month, desktop and mobile"
          >
            <BarChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip content={<ChartTooltipContent />} />
              <Legend content={<ChartLegendContent />} />
              <Bar dataKey="desktop" fill="var(--color-desktop)" />
              <Bar dataKey="mobile" fill="var(--color-mobile)" />
            </BarChart>
          </ChartContainer>
        </div>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("LineChart with config + legend has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <div style={{ width: 400, height: 300 }}>
          <ChartContainer
            config={config}
            role="img"
            aria-label="Visitors trend, desktop and mobile"
          >
            <LineChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" />
              <YAxis />
              <Legend content={<ChartLegendContent />} />
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
        </div>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("chart paired with a heading + caption has no axe violations", async () => {
    // Real-world usage: the chart is part of a section; the chart itself
    // is decorative and the caption / heading carry the semantics.
    const { container } = renderWithProviders(
      <main>
        <section aria-labelledby="chart-heading">
          <h2 id="chart-heading">Monthly visitors</h2>
          <p id="chart-summary">
            Desktop traffic peaked in February at 305 sessions; mobile
            doubled to 200.
          </p>
          <div style={{ width: 400, height: 300 }} aria-hidden="true">
            <ChartContainer config={config}>
              <BarChart data={data}>
                <XAxis dataKey="month" />
                <Bar dataKey="desktop" fill="var(--color-desktop)" />
              </BarChart>
            </ChartContainer>
          </div>
        </section>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
