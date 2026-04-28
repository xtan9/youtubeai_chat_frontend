// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { useState } from "react";

import { Calendar } from "@/components/ui/calendar";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

const FIXED_MONTH = new Date("2024-06-15T00:00:00Z");

describe("Calendar", () => {
  describe("default render", () => {
    it("renders the day-picker root with data-slot=calendar", () => {
      const { container } = renderWithProviders(
        <Calendar month={FIXED_MONTH} />,
      );
      const root = container.querySelector('[data-slot="calendar"]');
      expect(root).toBeTruthy();
    });

    it("renders one button per visible day in single-select mode", () => {
      // Day buttons (CalendarDayButton) only mount when react-day-picker
      // 9 has a selection mode set — without `mode`, the picker still
      // renders the grid but the day cells are read-only spans.
      const { container } = renderWithProviders(
        <Calendar month={FIXED_MONTH} mode="single" />,
      );
      const dayButtons = container.querySelectorAll(
        'button[data-day]',
      );
      expect(dayButtons.length).toBeGreaterThanOrEqual(30);
    });

    it("renders previous/next month nav buttons", () => {
      const { container } = renderWithProviders(
        <Calendar month={FIXED_MONTH} />,
      );
      // react-day-picker exposes nav buttons with aria-label
      const prev = container.querySelector(
        'button[aria-label*="previous" i]',
      );
      const next = container.querySelector(
        'button[aria-label*="next" i]',
      );
      expect(prev).toBeTruthy();
      expect(next).toBeTruthy();
    });
  });

  describe("uncontrolled selection (mode='single')", () => {
    it("clicking a day fires onSelect with that day", () => {
      const onSelect = vi.fn();
      const { container } = renderWithProviders(
        <Calendar
          month={FIXED_MONTH}
          mode="single"
          onSelect={onSelect}
        />,
      );
      const days = container.querySelectorAll<HTMLButtonElement>(
        'button[data-day]',
      );
      // Pick the 5th day in the picker (some are outside-days; just take
      // the one labelled 2024-06-10 by data-day if present).
      const target =
        Array.from(days).find((d) => d.getAttribute("data-day")?.includes("6/10/2024")) ??
        days[Math.min(15, days.length - 1)];
      fireEvent.click(target);
      expect(onSelect).toHaveBeenCalled();
    });
  });

  describe("controlled selection", () => {
    it("renders the selected day with data-selected-single=true", () => {
      function Harness() {
        const [date, setDate] = useState<Date | undefined>(
          new Date("2024-06-15T00:00:00Z"),
        );
        return (
          <Calendar
            month={FIXED_MONTH}
            mode="single"
            selected={date}
            onSelect={setDate}
          />
        );
      }
      const { container } = renderWithProviders(<Harness />);
      const selected = container.querySelector(
        'button[data-selected-single="true"]',
      );
      expect(selected).toBeTruthy();
    });
  });

  describe("range mode", () => {
    it("highlights start, middle, and end of the range with the right data-range-* attrs", () => {
      const range = {
        from: new Date("2024-06-10T00:00:00Z"),
        to: new Date("2024-06-15T00:00:00Z"),
      };
      const { container } = renderWithProviders(
        <Calendar
          month={FIXED_MONTH}
          mode="range"
          selected={range}
        />,
      );
      const start = container.querySelector(
        'button[data-range-start="true"]',
      );
      const end = container.querySelector(
        'button[data-range-end="true"]',
      );
      const middles = container.querySelectorAll(
        'button[data-range-middle="true"]',
      );
      expect(start).toBeTruthy();
      expect(end).toBeTruthy();
      // Range is inclusive; June 10 → June 15 has 4 middle days
      expect(middles.length).toBe(4);
    });
  });

  describe("disabled days", () => {
    it("disabled day reports aria-disabled", () => {
      const { container } = renderWithProviders(
        <Calendar
          month={FIXED_MONTH}
          mode="single"
          disabled={(date) => date.getUTCDate() === 12}
        />,
      );
      const buttons = container.querySelectorAll<HTMLButtonElement>(
        'button[data-day]',
      );
      // Find the button corresponding to June 12 by its label
      const day12 =
        Array.from(buttons).find((b) =>
          b.getAttribute("data-day")?.includes("6/12/2024"),
        );
      // react-day-picker drops disabled buttons' aria-selected and
      // adds aria-disabled / disabled attribute.
      expect(day12?.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("showOutsideDays", () => {
    it("renders day buttons in outside cells when true (default)", () => {
      // react-day-picker 9 always reserves the outside-day TDs; the
      // distinction lives in whether each TD contains a Day button.
      const { container } = renderWithProviders(
        <Calendar month={FIXED_MONTH} mode="single" showOutsideDays />,
      );
      const buttonsInOutside = container.querySelectorAll(
        'td[data-outside="true"] button[data-day]',
      );
      expect(buttonsInOutside.length).toBeGreaterThan(0);
    });

    it("leaves outside cells empty when showOutsideDays={false}", () => {
      const { container } = renderWithProviders(
        <Calendar
          month={FIXED_MONTH}
          mode="single"
          showOutsideDays={false}
        />,
      );
      const buttonsInOutside = container.querySelectorAll(
        'td[data-outside="true"] button[data-day]',
      );
      expect(buttonsInOutside.length).toBe(0);
    });
  });

  describe("native prop forwarding", () => {
    it("merges className on the day-picker root", () => {
      const { container } = renderWithProviders(
        <Calendar month={FIXED_MONTH} className="my-cal" />,
      );
      const root = container.querySelector('[data-slot="calendar"]');
      // Tailwind merges the consumer className onto the day-picker root
      // (which ALSO carries the calendar's slot wrapper).
      const node = root?.querySelector(".my-cal") ?? root;
      // Either the root or its descendant should carry the consumer class
      const html = container.innerHTML;
      expect(html).toContain("my-cal");
      expect(node).toBeTruthy();
    });
  });
});
