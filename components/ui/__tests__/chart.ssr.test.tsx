import { renderToStaticMarkup } from "react-dom/server";
import { Bar, BarChart } from "recharts";
import { describe, expect, it, vi } from "vitest";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

const config: ChartConfig = {
  value: { label: "Value", color: "#6366f1" },
};

describe("ChartContainer SSR", () => {
  it("does not render its responsive chart with negative dimensions", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderToStaticMarkup(
      <ChartContainer config={config}>
        <BarChart data={[{ value: 1 }]}>
          <Bar dataKey="value" />
        </BarChart>
      </ChartContainer>,
    );

    expect(warning).not.toHaveBeenCalled();

    warning.mockRestore();
  });
});
