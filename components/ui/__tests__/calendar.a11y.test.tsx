// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import { Calendar } from "@/components/ui/calendar";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

const FIXED_MONTH = new Date("2024-06-15T00:00:00Z");

describe("Calendar a11y", () => {
  it("default single-mode calendar has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Calendar month={FIXED_MONTH} mode="single" />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("calendar with a selected date has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Calendar
          month={FIXED_MONTH}
          mode="single"
          selected={new Date("2024-06-15T00:00:00Z")}
        />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("range-mode calendar with a selected range has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Calendar
          month={FIXED_MONTH}
          mode="range"
          selected={{
            from: new Date("2024-06-10T00:00:00Z"),
            to: new Date("2024-06-15T00:00:00Z"),
          }}
        />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("calendar with disabled days has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Calendar
          month={FIXED_MONTH}
          mode="single"
          disabled={(date) => date.getUTCDate() % 7 === 0}
        />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("calendar with dropdown caption (month picker) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Calendar
          month={FIXED_MONTH}
          mode="single"
          captionLayout="dropdown"
        />
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
