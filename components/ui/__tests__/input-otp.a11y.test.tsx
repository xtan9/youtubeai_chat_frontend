// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

// input-otp 1.4 schedules caret-animation `setTimeout(0/10/50)`
// calls inside its useEffect for every render. They normally fire
// during the test, but if happy-dom tears down its window before
// the 50ms timer fires (between test files), the timer hits a
// `window is not defined` unhandled rejection. We can't easily
// flush these timers without disrupting axe (which uses setTimeout
// internally), so we accept the brief delay: each test sleeps 60ms
// before completing so all caret timers fire before teardown.
async function flushOtpTimers() {
  await new Promise((r) => setTimeout(r, 60));
}

describe("InputOTP a11y", () => {
  it("6-digit OTP with a label has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <label htmlFor="otp">One-time code</label>
        <InputOTP id="otp" maxLength={6}>
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
    await flushOtpTimers();
  });

  it("split 3-3 OTP with a separator has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <label htmlFor="otp2">Verify your code</label>
        <InputOTP id="otp2" maxLength={6}>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
    await flushOtpTimers();
  });

  it("disabled OTP has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <label htmlFor="otp3">One-time code (locked)</label>
        <InputOTP id="otp3" maxLength={4} disabled>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
            <InputOTPSlot index={3} />
          </InputOTPGroup>
        </InputOTP>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
    await flushOtpTimers();
  });
});
