// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    is_anonymous: boolean;
    email?: string;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  },
  identify: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  reset: vi.fn(),
  optIn: vi.fn(),
  optOut: vi.fn(),
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({
    identify: state.identify,
    register: state.register,
    unregister: state.unregister,
    reset: state.reset,
    opt_in_capturing: state.optIn,
    opt_out_capturing: state.optOut,
  }),
}));

vi.mock("@/lib/contexts/user-context", () => ({
  useUser: () => ({ user: state.user }),
}));

import { PostHogUserIdentifier } from "../posthog-user-identifier";
import { setBusinessAnalyticsCaptureSuppressed } from "@/lib/analytics/client";

beforeEach(() => {
  state.user = null;
  state.identify.mockReset();
  state.register.mockReset();
  state.unregister.mockReset();
  state.reset.mockReset();
  state.optIn.mockReset();
  state.optOut.mockReset();
  setBusinessAnalyticsCaptureSuppressed(false);
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

  it("preserves visitor continuity when an anonymous user registers", () => {
    state.user = {
      id: "anonymous-user-1",
      is_anonymous: true,
    };
    const { rerender } = render(<PostHogUserIdentifier />);

    expect(state.identify).not.toHaveBeenCalled();
    expect(state.reset).not.toHaveBeenCalled();
    expect(state.optIn).toHaveBeenCalledWith({ captureEventName: false });

    state.user = {
      id: "registered-user-1",
      is_anonymous: false,
    };
    rerender(<PostHogUserIdentifier />);

    expect(state.reset).not.toHaveBeenCalled();
    expect(state.identify).toHaveBeenCalledTimes(1);
    expect(state.identify).toHaveBeenCalledWith("registered-user-1", {
      account_type: "registered",
    });
  });

  it("resets before identifying a different registered account", () => {
    state.user = {
      id: "registered-user-1",
      is_anonymous: false,
    };
    const { rerender } = render(<PostHogUserIdentifier />);

    state.user = {
      id: "registered-user-2",
      is_anonymous: false,
    };
    rerender(<PostHogUserIdentifier />);

    expect(state.reset).toHaveBeenCalledTimes(1);
    expect(state.identify).toHaveBeenLastCalledWith("registered-user-2", {
      account_type: "registered",
    });
  });

  it("marks and opts out a trusted Smoke Account after identifying it", () => {
    state.user = {
      id: "smoke-user-1",
      is_anonymous: false,
      app_metadata: { is_smoke_account: true },
      user_metadata: { full_name: "Editable label" },
    };

    render(<PostHogUserIdentifier />);

    expect(state.identify).toHaveBeenCalledWith("smoke-user-1", {
      account_type: "registered",
      analytics_subject: "synthetic_smoke_account",
    });
    expect(state.register).toHaveBeenCalledWith({
      analytics_subject: "synthetic_smoke_account",
    });
    expect(state.optOut).toHaveBeenCalledTimes(1);
  });

  it("marks and opts out a trusted anonymous production probe", () => {
    state.user = {
      id: "anonymous-smoke-user-1",
      is_anonymous: true,
      app_metadata: { is_smoke_account: true },
    };

    render(<PostHogUserIdentifier />);

    expect(state.identify).toHaveBeenCalledWith("anonymous-smoke-user-1", {
      account_type: "anonymous",
      analytics_subject: "synthetic_smoke_account",
    });
    expect(state.register).toHaveBeenCalledWith({
      analytics_subject: "synthetic_smoke_account",
    });
    expect(state.optOut).toHaveBeenCalledTimes(1);
    expect(state.optIn).not.toHaveBeenCalled();
  });

  it("does not trust an anonymous user-metadata-only smoke marker", () => {
    state.user = {
      id: "anonymous-human-user-1",
      is_anonymous: true,
      user_metadata: { is_smoke_account: true },
    };

    render(<PostHogUserIdentifier />);

    expect(state.identify).not.toHaveBeenCalled();
    expect(state.optOut).not.toHaveBeenCalled();
    expect(state.optIn).toHaveBeenCalledWith({ captureEventName: false });
  });

  it("does not classify a user-metadata-only marker as Smoke", () => {
    state.user = {
      id: "human-user-1",
      is_anonymous: false,
      user_metadata: { is_smoke_account: true },
    };

    render(<PostHogUserIdentifier />);

    expect(state.optOut).not.toHaveBeenCalled();
    expect(state.optIn).toHaveBeenCalledWith({ captureEventName: false });
    expect(state.identify).toHaveBeenCalledWith("human-user-1", {
      account_type: "registered",
    });
  });

  it("resets synthetic identity and restores capture for a subsequent human", () => {
    state.user = {
      id: "smoke-user-1",
      is_anonymous: false,
      app_metadata: { is_smoke_account: true },
    };
    const { rerender } = render(<PostHogUserIdentifier />);

    state.user = {
      id: "human-user-1",
      is_anonymous: false,
      app_metadata: {},
    };
    rerender(<PostHogUserIdentifier />);

    expect(state.reset).toHaveBeenCalledTimes(1);
    expect(state.unregister).toHaveBeenCalledWith("analytics_subject");
    expect(state.optIn).toHaveBeenCalledWith({ captureEventName: false });
    expect(state.identify).toHaveBeenLastCalledWith("human-user-1", {
      account_type: "registered",
    });
  });

  it("ends the synthetic identity and restores capture on local sign out", () => {
    state.user = {
      id: "smoke-user-1",
      is_anonymous: false,
      app_metadata: { is_smoke_account: true },
    };
    const { rerender } = render(<PostHogUserIdentifier />);

    state.user = null;
    rerender(<PostHogUserIdentifier />);

    expect(state.reset).toHaveBeenCalledTimes(1);
    expect(state.optIn).toHaveBeenCalledWith({ captureEventName: false });
  });
});
