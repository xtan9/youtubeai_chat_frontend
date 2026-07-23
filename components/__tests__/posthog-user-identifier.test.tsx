// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    is_anonymous: boolean;
    email?: string;
    user_metadata?: { full_name?: string };
  },
  identify: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({
    identify: state.identify,
    reset: state.reset,
  }),
}));

vi.mock("@/lib/contexts/user-context", () => ({
  useUser: () => ({ user: state.user }),
}));

import { PostHogUserIdentifier } from "../posthog-user-identifier";

beforeEach(() => {
  state.user = null;
  state.identify.mockReset();
  state.reset.mockReset();
});

afterEach(cleanup);

describe("PostHogUserIdentifier", () => {
  it("identifies with non-PII properties and resets when the user logs out", () => {
    state.user = {
      id: "user-1",
      is_anonymous: false,
      email: "private@example.com",
      user_metadata: { full_name: "Private Name" },
    };
    const { rerender } = render(<PostHogUserIdentifier />);

    expect(state.identify).toHaveBeenCalledWith("user-1", {
      account_type: "registered",
    });
    expect(state.reset).not.toHaveBeenCalled();

    state.user = null;
    rerender(<PostHogUserIdentifier />);
    expect(state.reset).toHaveBeenCalledTimes(1);
  });

  it("does not reset an anonymous PostHog visitor during initial auth loading", () => {
    render(<PostHogUserIdentifier />);
    expect(state.reset).not.toHaveBeenCalled();
  });
});
