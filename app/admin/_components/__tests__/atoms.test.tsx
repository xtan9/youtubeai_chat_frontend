import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AreaChart, BarChart, Sparkline, Donut } from "../atoms";

const NaNRe = /NaN|undefined/i;

function svgPaths(markup: string): string[] {
  return Array.from(markup.matchAll(/d="([^"]*)"/g)).map((m) => m[1]);
}

describe("AreaChart", () => {
  it("returns null on empty data", () => {
    const out = renderToStaticMarkup(<AreaChart data={[]} />);
    expect(out).toBe("");
  });

  it("does not produce NaN coordinates on a single-point series", () => {
    const out = renderToStaticMarkup(<AreaChart data={[42]} />);
    svgPaths(out).forEach((d) => expect(d).not.toMatch(NaNRe));
  });

  it("does not produce NaN on all-equal data", () => {
    const out = renderToStaticMarkup(<AreaChart data={[5, 5, 5, 5]} />);
    svgPaths(out).forEach((d) => expect(d).not.toMatch(NaNRe));
  });

  it("does not crash on all-zero data", () => {
    const out = renderToStaticMarkup(<AreaChart data={[0, 0, 0]} />);
    svgPaths(out).forEach((d) => expect(d).not.toMatch(NaNRe));
  });
});

describe("Sparkline", () => {
  it("returns null on empty data", () => {
    const out = renderToStaticMarkup(<Sparkline data={[]} />);
    expect(out).toBe("");
  });

  it("does not produce NaN on single-point or equal-value series", () => {
    for (const data of [[42], [3, 3, 3]]) {
      const out = renderToStaticMarkup(<Sparkline data={data} />);
      svgPaths(out).forEach((d) => expect(d).not.toMatch(NaNRe));
    }
  });
});

describe("BarChart", () => {
  it("returns null on empty data", () => {
    const out = renderToStaticMarkup(<BarChart data={[]} />);
    expect(out).toBe("");
  });

  it("renders zero-height bars (not NaN-height) on all-zero data", () => {
    const out = renderToStaticMarkup(<BarChart data={[0, 0, 0]} />);
    expect(out).not.toMatch(NaNRe);
    // Each rect should still render with a height attribute (0).
    const heights = Array.from(out.matchAll(/height="([^"]*)"/g)).map(
      (m) => m[1],
    );
    heights.forEach((h) => expect(Number(h)).toBeGreaterThanOrEqual(0));
  });

  it("does not produce NaN on equal-value data", () => {
    const out = renderToStaticMarkup(<BarChart data={[5, 5, 5]} />);
    expect(out).not.toMatch(NaNRe);
  });
});

describe("Donut", () => {
  it("renders nothing for empty segments", () => {
    const out = renderToStaticMarkup(<Donut segments={[]} />);
    // Outer <svg> + center hole circle still present, but no <path>s
    expect(out).not.toContain("<path");
  });

  it("filters NaN / negative segments instead of producing NaN paths", () => {
    const out = renderToStaticMarkup(
      <Donut
        segments={[
          { label: "ok", value: 10, color: "#000" },
          { label: "bad-nan", value: Number.NaN, color: "#f00" },
          { label: "bad-negative", value: -5, color: "#0f0" },
          { label: "ok2", value: 5, color: "#00f" },
        ]}
      />,
    );
    expect(out).not.toMatch(NaNRe);
    // Two valid segments → 2 path elements, no extras for the bad ones.
    const pathCount = (out.match(/<path/g) ?? []).length;
    expect(pathCount).toBe(2);
  });

  it("renders single-segment donut without NaN", () => {
    const out = renderToStaticMarkup(
      <Donut segments={[{ label: "only", value: 1, color: "#0a0a0a" }]} />,
    );
    expect(out).not.toMatch(NaNRe);
  });
});
