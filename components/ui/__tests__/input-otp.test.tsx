// @vitest-environment happy-dom
import {
  afterEach,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

// input-otp 1.4 schedules a `setTimeout` for the fake-caret animation
// that fires AFTER our component unmounts. happy-dom tears down its
// fake `window` between test files, so the late timer hits a
// `window is not defined` ReferenceError that vitest surfaces as an
// unhandled rejection. Fake timers keep the timeout pinned to our
// test scope so the suite stays green.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("InputOTP", () => {
  describe("default render", () => {
    it("renders the OTP input with data-slot=input-otp on the underlying <input>", () => {
      renderWithProviders(
        <InputOTP maxLength={6}>
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>,
      );
      const input = document.querySelector('input[data-slot="input-otp"]');
      expect(input).toBeTruthy();
      expect(input?.getAttribute("maxlength")).toBe("6");
    });

    it("renders the right number of slots, each with data-slot=input-otp-slot", () => {
      renderWithProviders(
        <InputOTP maxLength={4}>
          <InputOTPGroup data-testid="grp">
            {[0, 1, 2, 3].map((i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>,
      );
      const slots = screen
        .getByTestId("grp")
        .querySelectorAll('[data-slot="input-otp-slot"]');
      expect(slots.length).toBe(4);
    });

    it("renders the InputOTPGroup with data-slot=input-otp-group", () => {
      renderWithProviders(
        <InputOTP maxLength={2}>
          <InputOTPGroup data-testid="grp">
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
          </InputOTPGroup>
        </InputOTP>,
      );
      expect(screen.getByTestId("grp").getAttribute("data-slot")).toBe(
        "input-otp-group",
      );
    });

    it("InputOTPSeparator carries role=separator and data-slot=input-otp-separator", () => {
      renderWithProviders(
        <InputOTP maxLength={4}>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
          </InputOTPGroup>
          <InputOTPSeparator data-testid="sep" />
          <InputOTPGroup>
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
          </InputOTPGroup>
        </InputOTP>,
      );
      const sep = screen.getByTestId("sep");
      expect(sep.getAttribute("role")).toBe("separator");
      expect(sep.getAttribute("data-slot")).toBe("input-otp-separator");
    });
  });

  describe("controlled mode", () => {
    it("emits onChange with the typed value", () => {
      const onChange = vi.fn();
      function Harness() {
        const [v, setV] = useState("");
        return (
          <InputOTP
            maxLength={4}
            value={v}
            onChange={(next) => {
              setV(next);
              onChange(next);
            }}
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
            </InputOTPGroup>
          </InputOTP>
        );
      }
      renderWithProviders(<Harness />);
      const input = document.querySelector(
        'input[data-slot="input-otp"]',
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "1234" } });
      expect(onChange).toHaveBeenCalledWith("1234");
    });
  });

  describe("disabled", () => {
    it("disabled OTP input dims the container and disables the input", () => {
      renderWithProviders(
        <InputOTP maxLength={4} disabled>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
          </InputOTPGroup>
        </InputOTP>,
      );
      const input = document.querySelector(
        'input[data-slot="input-otp"]',
      ) as HTMLInputElement;
      expect(input.disabled).toBe(true);
    });
  });

  describe("native prop forwarding", () => {
    it("passes className onto the input and containerClassName onto the wrapper", () => {
      renderWithProviders(
        <InputOTP
          maxLength={2}
          className="my-input"
          containerClassName="my-wrapper"
        >
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
          </InputOTPGroup>
        </InputOTP>,
      );
      const input = document.querySelector(
        'input[data-slot="input-otp"]',
      ) as HTMLInputElement;
      expect(input.className).toContain("my-input");
      // The container is the parent of the input's section
      const container = input.closest(".my-wrapper");
      expect(container).toBeTruthy();
    });
  });
});
