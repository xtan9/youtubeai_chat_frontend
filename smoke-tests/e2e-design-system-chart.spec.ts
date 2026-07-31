import { expect, test } from "@playwright/test";

const BASE_URL = (
  process.env.BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`design-system chart has positive dimensions on ${viewport.name}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.setViewportSize(viewport);
    const response = await page.goto(`${BASE_URL}/design-system/data-display`);
    expect(response?.status()).toBe(200);

    const chart = page.locator('[data-slot="chart"]').first();
    await expect(chart).toBeVisible();
    await expect(chart.locator("svg.recharts-surface")).toBeVisible();

    const dimensions = await chart.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const svg = element.querySelector("svg.recharts-surface");
      const svgBounds = svg?.getBoundingClientRect();
      return {
        containerWidth: bounds.width,
        containerHeight: bounds.height,
        svgWidth: svgBounds?.width ?? 0,
        svgHeight: svgBounds?.height ?? 0,
      };
    });

    expect(dimensions.containerWidth).toBeGreaterThan(0);
    expect(dimensions.containerHeight).toBeGreaterThan(0);
    expect(dimensions.svgWidth).toBeGreaterThan(0);
    expect(dimensions.svgHeight).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}
