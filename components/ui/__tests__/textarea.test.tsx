// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { createRef, useState } from "react";

import { Textarea } from "@/components/ui/textarea";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Textarea", () => {
  describe("rendering", () => {
    it("renders a textarea with data-slot", () => {
      renderWithProviders(<Textarea placeholder="Notes" />);
      const ta = screen.getByPlaceholderText("Notes");
      expect(ta.tagName).toBe("TEXTAREA");
      expect(ta.getAttribute("data-slot")).toBe("textarea");
    });

    it("merges custom className with base classes", () => {
      renderWithProviders(<Textarea className="my-ta" placeholder="x" />);
      const ta = screen.getByPlaceholderText("x");
      expect(ta.className).toContain("my-ta");
      expect(ta.className).toContain("rounded-md");
      expect(ta.className).toContain("min-h-16");
    });

    it("ships the field-sizing-content class for vertical auto-grow", () => {
      renderWithProviders(<Textarea placeholder="g" />);
      const ta = screen.getByPlaceholderText("g");
      expect(ta.className).toContain("field-sizing-content");
    });
  });

  describe("ref forwarding", () => {
    it("forwards a ref to the textarea element", () => {
      const ref = createRef<HTMLTextAreaElement>();
      renderWithProviders(<Textarea ref={ref} placeholder="r" />);
      expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    });
  });

  describe("controlled vs uncontrolled", () => {
    it("uncontrolled: respects defaultValue and updates via user input", () => {
      renderWithProviders(<Textarea defaultValue="hello" placeholder="u" />);
      const ta = screen.getByPlaceholderText("u") as HTMLTextAreaElement;
      expect(ta.value).toBe("hello");
      fireEvent.change(ta, { target: { value: "hello world" } });
      expect(ta.value).toBe("hello world");
    });

    it("controlled: value reflects state and onChange fires", () => {
      function Controlled() {
        const [v, setV] = useState("first");
        return (
          <Textarea
            value={v}
            onChange={(e) => setV(e.target.value)}
            placeholder="c"
          />
        );
      }
      renderWithProviders(<Controlled />);
      const ta = screen.getByPlaceholderText("c") as HTMLTextAreaElement;
      expect(ta.value).toBe("first");
      fireEvent.change(ta, { target: { value: "second" } });
      expect(ta.value).toBe("second");
    });
  });

  describe("disabled", () => {
    it("renders as disabled and surfaces disabled visual treatment", () => {
      renderWithProviders(<Textarea disabled placeholder="d" />);
      const ta = screen.getByPlaceholderText("d") as HTMLTextAreaElement;
      expect(ta.disabled).toBe(true);
      expect(ta.className).toContain("disabled:cursor-not-allowed");
    });
  });

  describe("aria-invalid", () => {
    it("retains aria-invalid for downstream styling", () => {
      renderWithProviders(<Textarea aria-invalid placeholder="e" />);
      const ta = screen.getByPlaceholderText("e");
      expect(ta.getAttribute("aria-invalid")).toBe("true");
    });
  });

  describe("native attribute pass-through", () => {
    it("forwards rows, cols, name, required, maxLength", () => {
      renderWithProviders(
        <Textarea
          name="bio"
          rows={6}
          cols={50}
          maxLength={500}
          required
          placeholder="p"
        />,
      );
      const ta = screen.getByPlaceholderText("p") as HTMLTextAreaElement;
      expect(ta.name).toBe("bio");
      // happy-dom surfaces some integer DOM properties as strings — coerce.
      expect(Number(ta.rows)).toBe(6);
      expect(Number(ta.cols)).toBe(50);
      expect(Number(ta.maxLength)).toBe(500);
      expect(ta.required).toBe(true);
    });
  });

  describe("typing behavior", () => {
    it("fires onInput / onChange across multi-line content", () => {
      const handleChange = vi.fn();
      renderWithProviders(
        <Textarea onChange={handleChange} placeholder="m" />,
      );
      const ta = screen.getByPlaceholderText("m") as HTMLTextAreaElement;
      fireEvent.change(ta, { target: { value: "line one\nline two" } });
      expect(handleChange).toHaveBeenCalledTimes(1);
      expect(ta.value).toBe("line one\nline two");
    });
  });
});
