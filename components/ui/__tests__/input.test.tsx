// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { createRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Input", () => {
  describe("rendering", () => {
    it("renders an input with data-slot", () => {
      renderWithProviders(<Input placeholder="Email" />);
      const input = screen.getByPlaceholderText("Email");
      expect(input.tagName).toBe("INPUT");
      expect(input.getAttribute("data-slot")).toBe("input");
    });

    it("defaults type when not provided", () => {
      // The Input component does not force a type; native default is text.
      renderWithProviders(<Input placeholder="No type" />);
      const input = screen.getByPlaceholderText("No type") as HTMLInputElement;
      // happy-dom defaults missing type to "text" via the property accessor
      expect(input.type).toBe("text");
    });

    it.each([
      ["text", "text"],
      ["email", "email"],
      ["password", "password"],
      ["number", "number"],
      ["search", "search"],
      ["tel", "tel"],
      ["url", "url"],
    ])("forwards type=%s to the native input", (type, expected) => {
      renderWithProviders(<Input type={type} placeholder="t" />);
      const input = screen.getByPlaceholderText("t") as HTMLInputElement;
      expect(input.type).toBe(expected);
    });

    it("merges custom className with base classes", () => {
      renderWithProviders(<Input className="my-input" placeholder="x" />);
      const input = screen.getByPlaceholderText("x");
      expect(input.className).toContain("my-input");
      expect(input.className).toContain("rounded-md");
    });
  });

  describe("ref forwarding", () => {
    it("forwards a ref to the input element", () => {
      const ref = createRef<HTMLInputElement>();
      renderWithProviders(<Input ref={ref} placeholder="r" />);
      expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });
  });

  describe("controlled vs uncontrolled", () => {
    it("uncontrolled: respects defaultValue and updates via user input", () => {
      renderWithProviders(<Input defaultValue="hello" placeholder="u" />);
      const input = screen.getByPlaceholderText("u") as HTMLInputElement;
      expect(input.value).toBe("hello");
      fireEvent.change(input, { target: { value: "world" } });
      expect(input.value).toBe("world");
    });

    it("controlled: value reflects state and onChange fires", () => {
      function Controlled() {
        const [v, setV] = useState("a");
        return (
          <Input
            value={v}
            onChange={(e) => setV(e.target.value)}
            placeholder="c"
          />
        );
      }
      renderWithProviders(<Controlled />);
      const input = screen.getByPlaceholderText("c") as HTMLInputElement;
      expect(input.value).toBe("a");
      fireEvent.change(input, { target: { value: "abc" } });
      expect(input.value).toBe("abc");
    });
  });

  describe("disabled", () => {
    it("renders as disabled and stays disabled across re-renders", () => {
      const { rerender } = renderWithProviders(
        <Input disabled placeholder="d" />,
      );
      const input = screen.getByPlaceholderText("d") as HTMLInputElement;
      expect(input.disabled).toBe(true);
      // disabled=false should turn it back on
      rerender(<Input placeholder="d" />);
      expect(
        (screen.getByPlaceholderText("d") as HTMLInputElement).disabled,
      ).toBe(false);
    });
  });

  describe("aria-invalid", () => {
    it("retains aria-invalid for downstream styling", () => {
      renderWithProviders(<Input aria-invalid placeholder="e" />);
      const input = screen.getByPlaceholderText("e");
      expect(input.getAttribute("aria-invalid")).toBe("true");
    });
  });

  describe("native attribute pass-through", () => {
    it("forwards required, name, autoComplete, maxLength", () => {
      renderWithProviders(
        <Input
          name="email"
          required
          autoComplete="email"
          maxLength={50}
          placeholder="p"
        />,
      );
      const input = screen.getByPlaceholderText("p") as HTMLInputElement;
      expect(input.name).toBe("email");
      expect(input.required).toBe(true);
      expect(input.autocomplete).toBe("email");
      expect(input.maxLength).toBe(50);
    });
  });
});
